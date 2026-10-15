using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using DualClip.Models;

namespace DualClip.Services;

public class ClipboardListener : IDisposable
{
    private readonly DatabaseService _db;
    private readonly Thread _listenerThread;
    private readonly Thread _captureWorkerThread;
    private readonly BlockingCollection<Action> _captureQueue = new(50);
    private ListenerWindow? _window;
    private readonly uint _currentPid;
    private bool _disposed;
    // C3: checked by the worker between items so shutdown is bounded by the
    // in-flight item instead of abandoning it after a fixed timeout.
    private volatile bool _shutdownRequested;

    // Sequence number of the last clipboard state we successfully read. Touched only on the STA
    // listener thread. Used to drop duplicate WM_CLIPBOARDUPDATE deliveries for the same clipboard
    // state (fast D->X swaps deliver one message per write while the read already sees the newest
    // write).
    private uint _lastCapturedSeq;

    private const uint CF_UNICODETEXT = 13;
    private const uint GMEM_MOVEABLE = 0x0002;

    public const int MaxTextChars = 250_000;

    /// <summary>
    /// Why a clipboard read was refused for size. Carried alongside the human-readable
    /// note so callers never match on message wording (C1) — rewording a diagnostic
    /// string must not silently disable the oversize notification.
    /// </summary>
    public enum OversizeKind
    {
        None,
        /// <summary>Text longer than <see cref="MaxTextChars"/> characters.</summary>
        TextChars,
        /// <summary>Clipboard allocation over <see cref="MaxClipboardAllocBytes"/> bytes.</summary>
        AllocBytes
    }

    /// <summary>Mirror of AppSettings.MaxClips used to trim history during capture.</summary>
    public int MaxClipsLimit { get; private set; } = 500;
    private const int MaxImageDimension = 4096;
    private const long MaxImagePixelArea = 32_000_000; // 32 MP decoded ceiling
    private const int MaxImageBytes = 15 * 1024 * 1024; // 15 MB PNG file ceiling
    private const ulong MaxClipboardAllocBytes = 20 * 1024 * 1024; // 20 MB clipboard allocation ceiling

    /// <summary>
    /// Capture provenance for one clipboard state, resolved synchronously on the STA listener
    /// thread — the clipboard owner is only reachable during the short window in which it still
    /// owns the clipboard. When Wispr Flow dictates, that owner is the Wispr process.
    /// </summary>
    private readonly struct ClipSource
    {
        public ClipSource(IntPtr owner, string proc, string title, uint pid, string? fullPath = null)
        {
            Owner = owner;
            Proc = proc;
            Title = title;
            Pid = pid;
            FullPath = fullPath;
        }

        public IntPtr Owner { get; }
        public string Proc { get; }
        public string Title { get; }
        public uint Pid { get; }
        public string? FullPath { get; }
    }

    public ClipboardListener(DatabaseService db)
    {
        _db = db;
        _currentPid = (uint)Process.GetCurrentProcess().Id;

        // Single FIFO consumer: capture processing must run in clipboard-arrival order, otherwise a
        // Wispr dictation (D) and the restore of the previous clip (X) can persist out of order and
        // land in the wrong slot.
        _captureWorkerThread = new Thread(CaptureWorkerLoop)
        {
            IsBackground = true,
            Name = "DualClip.CaptureWorker"
        };
        _captureWorkerThread.Start();

        _listenerThread = new Thread(RunMessageLoop)
        {
            IsBackground = true,
            Name = "DualClip.ClipboardListenerThread"
        };
        _listenerThread.SetApartmentState(ApartmentState.STA);
        // Above normal shrinks the read window when a tool writes the clipboard and restores the
        // previous content within a few milliseconds.
        _listenerThread.Priority = ThreadPriority.AboveNormal;
        _listenerThread.Start();
    }

    private void CaptureWorkerLoop()
    {
        try
        {
            foreach (var work in _captureQueue.GetConsumingEnumerable())
            {
                if (_shutdownRequested) break;
                try
                {
                    work();
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[CaptureWorker] Error processing clip: {ex.GetType().Name} - {ex.Message}");
                }
            }
        }
        catch (ObjectDisposedException) { }
        catch (InvalidOperationException) { }
    }

    private void NoteQueueDrop()
    {
        long total = Interlocked.Increment(ref _droppedClipCount);
        try { CaptureQueueDropped?.Invoke(total); } catch { }
    }

    private bool EnqueueCapture(Action work, IDisposable? owned = null)
    {
        try
        {
            if (!_captureQueue.TryAdd(work))
            {
                owned?.Dispose();
                System.Diagnostics.Debug.WriteLine("[ClipboardListener] Capture queue full (backpressure); dropping clip update to prevent STA stall.");
                NoteQueueDrop();
                return false;
            }
            return true;
        }
        catch (InvalidOperationException)
        {
            owned?.Dispose();
            NoteQueueDrop();
            return false;
        }
        catch (Exception ex)
        {
            owned?.Dispose();
            System.Diagnostics.Debug.WriteLine($"[ClipboardListener] Failed to enqueue capture: {ex.Message}");
            NoteQueueDrop();
            return false;
        }
    }

    private void RunMessageLoop()
    {
        _window = new ListenerWindow(this);
        System.Windows.Forms.Application.Run();
    }

    public bool CopyText(string text)
    {
        if (text == null) text = string.Empty;

        if (_window == null || _window.IsDisposed)
        {
            return false;
        }

        try
        {
            return (bool)_window.Invoke(new Func<bool>(() =>
            {
                return WriteClipboardWithRetry(text, _window.Handle);
            }));
        }
        catch
        {
            return false;
        }
    }

    public bool CopyRichText(string text, string? richText = null)
    {
        if (string.IsNullOrEmpty(richText))
        {
            return CopyText(text);
        }

        if (text == null) text = string.Empty;

        if (_window == null || _window.IsDisposed)
        {
            return false;
        }

        try
        {
            return (bool)_window.Invoke(new Func<bool>(() =>
            {
                var data = new DataObject();
                data.SetText(text, TextDataFormat.UnicodeText);

                if (richText.StartsWith("rtf:", StringComparison.OrdinalIgnoreCase))
                {
                    data.SetData(DataFormats.Rtf, richText.Substring(4));
                }
                else if (richText.StartsWith("html:", StringComparison.OrdinalIgnoreCase))
                {
                    data.SetData(DataFormats.Html, richText.Substring(5));
                }
                else if (richText.StartsWith("{\\rtf", StringComparison.OrdinalIgnoreCase))
                {
                    data.SetData(DataFormats.Rtf, richText);
                }
                else
                {
                    data.SetData(DataFormats.Html, richText);
                }

                System.Windows.Forms.Clipboard.SetDataObject(data, true);
                return true;
            }));
        }
        catch
        {
            return CopyText(text);
        }
    }

    public static bool TryParseRichPayload(string? raw, out string? richType, out string? richBody)
    {
        richType = null;
        richBody = null;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        if (raw.StartsWith("rtf:", StringComparison.OrdinalIgnoreCase))
        {
            richType = "rtf";
            richBody = raw.Substring(4);
            return true;
        }
        if (raw.StartsWith("html:", StringComparison.OrdinalIgnoreCase))
        {
            richType = "html";
            richBody = raw.Substring(5);
            return true;
        }
        if (raw.StartsWith("{\\rtf", StringComparison.OrdinalIgnoreCase))
        {
            richType = "rtf";
            richBody = raw;
            return true;
        }
        if (raw.Contains("<!--StartFragment-->", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("Version:", StringComparison.OrdinalIgnoreCase))
        {
            richType = "html";
            richBody = raw;
            return true;
        }
        return false;
    }

    public static bool IsGifHeader(byte[]? bytes)
    {
        if (bytes == null || bytes.Length < 6) return false;
        return (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F' &&
                bytes[3] == '8' && (bytes[4] == '7' || bytes[4] == '9') && bytes[5] == 'a');
    }

    public static bool IsMultiFrameGif(Image img, out int frameCount)
    {
        frameCount = 1;
        try
        {
            if (img.FrameDimensionsList != null && img.FrameDimensionsList.Length > 0)
            {
                var dim = new System.Drawing.Imaging.FrameDimension(img.FrameDimensionsList[0]);
                frameCount = img.GetFrameCount(dim);
                return frameCount > 1;
            }
        }
        catch { }
        return false;
    }

    public void ReArmListener()
    {
        try
        {
            if (_window != null && !_window.IsDisposed && _window.IsHandleCreated)
            {
                _window.BeginInvoke(new Action(() =>
                {
                    try
                    {
                        RemoveClipboardFormatListener(_window.Handle);
                    }
                    catch { }
                    try
                    {
                        AddClipboardFormatListener(_window.Handle);
                    }
                    catch { }
                }));
            }
        }
        catch { }
    }

    private bool WriteClipboardWithRetry(string text, IntPtr ownerHwnd)
    {
        int maxAttempts = 10;
        int delayMs = 20; // 10 attempts * 20ms = 200ms maximum retry window

        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            uint seqBefore = GetClipboardSequenceNumber();
            if (OpenClipboard(ownerHwnd))
            {
                try
                {
                    if (!EmptyClipboard())
                    {
                        if (attempt < maxAttempts) Thread.Sleep(delayMs);
                        continue;
                    }

                    int byteCount = (text.Length + 1) * sizeof(char);
                    IntPtr hGlobal = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)byteCount);
                    if (hGlobal == IntPtr.Zero)
                    {
                        return false;
                    }

                    IntPtr targetPtr = GlobalLock(hGlobal);
                    if (targetPtr == IntPtr.Zero)
                    {
                        GlobalFree(hGlobal);
                        return false;
                    }

                    Marshal.Copy(text.ToCharArray(), 0, targetPtr, text.Length);
                    Marshal.WriteInt16(targetPtr, text.Length * sizeof(char), 0);
                    GlobalUnlock(hGlobal);

                    IntPtr setRes = SetClipboardData(CF_UNICODETEXT, hGlobal);
                    if (setRes == IntPtr.Zero)
                    {
                        GlobalFree(hGlobal);
                        if (attempt < maxAttempts) Thread.Sleep(delayMs);
                        continue;
                    }

                    return true;
                }
                finally
                {
                    CloseClipboard();
                    uint seqAfter = GetClipboardSequenceNumber();
                    if (seqBefore != 0 && seqAfter == seqBefore)
                    {
                        System.Diagnostics.Debug.WriteLine("[ClipboardListener] Warning: sequence number did not advance after clipboard write (potential kernel drop or clobber).");
                    }
                }
            }
            else
            {
                if (attempt < maxAttempts) Thread.Sleep(delayMs);
            }
        }

        return false;
    }

    public bool CopySvg(string svgPath, string? svgText = null)
    {
        if (string.IsNullOrEmpty(svgText) && (string.IsNullOrEmpty(svgPath) || !File.Exists(svgPath)))
        {
            return false;
        }
        if (_window == null || _window.IsDisposed)
        {
            return false;
        }

        try
        {
            return (bool)_window.Invoke(new Func<bool>(() =>
            {
                string text = !string.IsNullOrEmpty(svgText) ? svgText : File.ReadAllText(svgPath, Encoding.UTF8);
                var data = new DataObject();
                data.SetText(text, TextDataFormat.UnicodeText);

                byte[] utf8Bytes = Encoding.UTF8.GetBytes(text);
                data.SetData("image/svg+xml", new MemoryStream(utf8Bytes));

                if (!string.IsNullOrEmpty(svgPath) && File.Exists(svgPath))
                {
                    var fileList = new System.Collections.Specialized.StringCollection { svgPath };
                    data.SetFileDropList(fileList);
                }

                System.Windows.Forms.Clipboard.SetDataObject(data, true);
                return true;
            }));
        }
        catch
        {
            return false;
        }
    }

    public bool CopyImage(string imagePath, string? textContent = null)
    {
        if (string.IsNullOrEmpty(imagePath) && string.IsNullOrEmpty(textContent))
        {
            return false;
        }
        if (!string.IsNullOrEmpty(imagePath) && imagePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase))
        {
            return CopySvg(imagePath, textContent);
        }
        if (string.IsNullOrEmpty(imagePath) || !File.Exists(imagePath))
        {
            return false;
        }
        if (_window == null || _window.IsDisposed)
        {
            return false;
        }

        try
        {
            return (bool)_window.Invoke(new Func<bool>(() =>
            {
                using var fs = new FileStream(imagePath, FileMode.Open, FileAccess.Read, FileShare.Read);
                using var bmp = new Bitmap(fs);
                using var cloned = new Bitmap(bmp);
                System.Windows.Forms.Clipboard.SetImage(cloned);
                return true;
            }));
        }
        catch
        {
            return false;
        }
    }

    public bool CopyFileDrop(IReadOnlyList<string> paths, bool wasCut = false)
    {
        if (paths == null || paths.Count == 0)
        {
            return false;
        }
        if (_window == null || _window.IsDisposed)
        {
            return false;
        }

        try
        {
            return (bool)_window.Invoke(new Func<bool>(() =>
            {
                var files = new System.Collections.Specialized.StringCollection();
                foreach (var p in paths)
                {
                    if (File.Exists(p) || Directory.Exists(p))
                    {
                        files.Add(p);
                    }
                }

                var data = new DataObject();
                if (files.Count > 0)
                {
                    data.SetFileDropList(files);
                }
                data.SetText(string.Join(Environment.NewLine, paths), TextDataFormat.UnicodeText);

                if (wasCut && files.Count > 0)
                {
                    byte[] moveEffect = new byte[] { 2, 0, 0, 0 };
                    data.SetData("Preferred DropEffect", new MemoryStream(moveEffect));
                }

                System.Windows.Forms.Clipboard.SetDataObject(data, true);
                return true;
            }));
        }
        catch
        {
            return false;
        }
    }

    public static string FormatFilePreview(IReadOnlyList<string> paths)
    {
        if (paths == null || paths.Count == 0) return "[File]";
        string firstName = Path.GetFileName(paths[0]);
        if (string.IsNullOrWhiteSpace(firstName))
        {
            firstName = paths[0].TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        if (paths.Count == 1)
        {
            return firstName;
        }
        return $"{firstName} +{paths.Count - 1} more";
    }

    public object? GetClipboardSnapshot()
    {
        if (_window == null || _window.IsDisposed) return null;
        try
        {
            return _window.Invoke(new Func<object?>(() =>
            {
                if (System.Windows.Forms.Clipboard.ContainsFileDropList())
                {
                    return System.Windows.Forms.Clipboard.GetFileDropList();
                }
                if (System.Windows.Forms.Clipboard.ContainsText())
                {
                    return System.Windows.Forms.Clipboard.GetText();
                }
                if (System.Windows.Forms.Clipboard.ContainsImage())
                {
                    return System.Windows.Forms.Clipboard.GetImage();
                }
                return null;
            }));
        }
        catch
        {
            return null;
        }
    }

    public void RestoreClipboardSnapshot(object? snapshot)
    {
        if (snapshot == null || _window == null || _window.IsDisposed) return;
        try
        {
            _window.Invoke(new Action(() =>
            {
                if (snapshot is System.Collections.Specialized.StringCollection fileDrop)
                {
                    System.Windows.Forms.Clipboard.SetFileDropList(fileDrop);
                }
                else if (snapshot is string text)
                {
                    WriteClipboardWithRetry(text, _window.Handle);
                }
                else if (snapshot is Image img)
                {
                    System.Windows.Forms.Clipboard.SetImage(img);
                }
            }));
        }
        catch
        {
        }
    }

    private IReadOnlyList<string>? ReadClipboardFileDropList()
    {
        if (_window == null || _window.IsDisposed) return null;
        try
        {
            return (IReadOnlyList<string>?)_window.Invoke(new Func<IReadOnlyList<string>?>(() =>
            {
                if (System.Windows.Forms.Clipboard.ContainsFileDropList())
                {
                    var dropList = System.Windows.Forms.Clipboard.GetFileDropList();
                    if (dropList != null && dropList.Count > 0)
                    {
                        var result = new List<string>(Math.Min(dropList.Count, 100));
                        foreach (string? p in dropList)
                        {
                            if (string.IsNullOrWhiteSpace(p)) continue;
                            if (p.Length > 32768) continue;
                            result.Add(p);
                            if (result.Count >= 100) break;
                        }
                        if (result.Count > 0) return result;
                    }
                }
                return null;
            }));
        }
        catch
        {
            return null;
        }
    }

    private Image? ReadClipboardImage()
    {
        if (_window == null || _window.IsDisposed)
        {
            return null;
        }
        try
        {
            return (Image?)_window.Invoke(new Func<Image?>(() =>
            {
                if (System.Windows.Forms.Clipboard.ContainsImage())
                {
                    return System.Windows.Forms.Clipboard.GetImage();
                }
                return null;
            }));
        }
        catch
        {
            return null;
        }
    }

    public bool IsPaused { get; set; }
    public int MinClipLength { get; set; } = 1;
    public bool IgnoreWhitespaceOnly { get; set; } = true;
    public bool IgnorePasswords { get; set; } = true;
    public bool CaptureImages { get; set; } = true;
    public bool EnableBlocklist { get; set; } = true;
    public bool DoubleCopyOverride { get; set; } = false;
    public HashSet<string> BlocklistedApps { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<AutoSortRuleEntry> AutoSortRules { get; } = new();

    private long _lastExcludedCopyTicks;
    private string? _lastExcludedProc;
    private int _lastExcludedContentHash;

    public bool IsBlocklisted(string proc, int contentHash)
    {
        if (!EnableBlocklist) return false;
        bool inBlocklist = BlocklistedApps.Contains(proc) || BlocklistedApps.Contains(Path.GetFileName(proc));
        if (!inBlocklist) return false;

        if (DoubleCopyOverride)
        {
            long now = Environment.TickCount64;
            bool isRapidSecondCopy = (now - _lastExcludedCopyTicks <= 1200) &&
                                     string.Equals(_lastExcludedProc, proc, StringComparison.OrdinalIgnoreCase) &&
                                     _lastExcludedContentHash == contentHash;

            if (isRapidSecondCopy)
            {
                _lastExcludedCopyTicks = 0;
                _lastExcludedProc = null;
                _lastExcludedContentHash = 0;
                return false; // Override blocklist: intentional double copy!
            }

            _lastExcludedCopyTicks = now;
            _lastExcludedProc = proc;
            _lastExcludedContentHash = contentHash;
        }

        return true; // Excluded
    }

    public event Action<ClipItem, bool>? ClipCaptured;
    public event Action<string, long, long>? OversizedClipDropped;
    /// <summary>
    /// Raised with the running total whenever a clipboard update is dropped because
    /// the capture queue is full or torn down (C2). Debug.WriteLine alone vanishes
    /// from Release builds; this event plus <see cref="DroppedClipCount"/> survive.
    /// </summary>
    public event Action<long>? CaptureQueueDropped;

    private long _droppedClipCount;
    /// <summary>Lifetime count of clipboard updates dropped at enqueue time.</summary>
    public long DroppedClipCount => Interlocked.Read(ref _droppedClipCount);

    public void ApplySettings(AppSettingsData s)
    {
        IsPaused = s.IsPaused;
        MinClipLength = Math.Max(1, s.MinClipLength);
        IgnoreWhitespaceOnly = s.IgnoreWhitespaceOnly;
        IgnorePasswords = s.IgnorePasswords;
        CaptureImages = s.CaptureImages;
        MaxClipsLimit = s.MaxClips > 0 ? s.MaxClips : 500;
        EnableBlocklist = s.EnableBlocklist;
        DoubleCopyOverride = s.DoubleCopyOverride;

        BlocklistedApps.Clear();
        if (s.BlocklistedApps != null)
        {
            foreach (var b in s.BlocklistedApps)
            {
                if (!string.IsNullOrWhiteSpace(b)) BlocklistedApps.Add(b.Trim());
            }
        }

        AutoSortRules.Clear();
        if (s.AutoSortRules != null)
        {
            AutoSortRules.AddRange(s.AutoSortRules);
        }
    }

    internal void OnClipboardUpdate()
    {
        // IMPORTANT: this method runs on the STA listener thread and must return to the message loop
        // as fast as possible — a Wispr Flow dictation writes the transcript and restores the
        // previous clipboard content within a few milliseconds, so any work done here (especially
        // file I/O or DB writes) can make the next update unreadable. Sequence number +
        // payload read only; everything else (filtering, DB, events) goes to the single FIFO worker.
        try
        {
            if (IsPaused || _disposed)
            {
                return;
            }

            uint seq = GetClipboardSequenceNumber();

            if (seq != 0 && seq == _lastCapturedSeq)
            {
                return;
            }

            // Resolve provenance immediately when notification arrives while the writer owns the clipboard
            var source = GetClipboardSourceProcessInfo();
            var capturedSource = source;

            // 1. File drop capture from Explorer (CF_HDROP)
            var filePaths = ReadClipboardFileDropList();
            if (filePaths != null && filePaths.Count > 0)
            {
                if (filePaths.Count == 1 && filePaths[0].EndsWith(".svg", StringComparison.OrdinalIgnoreCase) && File.Exists(filePaths[0]))
                {
                    try
                    {
                        var fi = new FileInfo(filePaths[0]);
                        if (fi.Length <= 2 * 1024 * 1024)
                        {
                            string fileSvg = File.ReadAllText(filePaths[0], Encoding.UTF8);
                            if (TryParseSvg(fileSvg, out _, out string? sanitizedSvg) && sanitizedSvg != null)
                            {
                                _lastCapturedSeq = seq;
                                var capturedSvg = sanitizedSvg;
                                EnqueueCapture(() =>
                                {
                                    ProcessCapturedSvg(capturedSvg, capturedSource, seq);
                                });
                                return;
                            }
                        }
                    }
                    catch { }
                }

                if (filePaths.Count == 1 && filePaths[0].EndsWith(".gif", StringComparison.OrdinalIgnoreCase) && File.Exists(filePaths[0]))
                {
                    try
                    {
                        var fi = new FileInfo(filePaths[0]);
                        if (fi.Length <= MaxImageBytes)
                        {
                            byte[] gifBytes = File.ReadAllBytes(filePaths[0]);
                            if (IsGifHeader(gifBytes))
                            {
                                _lastCapturedSeq = seq;
                                EnqueueCapture(() =>
                                {
                                    ProcessCapturedGifBytes(gifBytes, capturedSource, seq);
                                });
                                return;
                            }
                        }
                    }
                    catch { }
                }

                _lastCapturedSeq = seq;
                var capturedPaths = filePaths;
                EnqueueCapture(() =>
                {
                    ProcessCapturedFiles(capturedPaths, capturedSource, seq);
                });
                return;
            }

            var readSw = Stopwatch.StartNew();
            var (text, sourceUrl, richText, _, oversize) = ReadClipboardText(seq);
            readSw.Stop();

            // C1: switch on the reason, never on message wording — and report the
            // limit that actually refused the clip (chars vs allocation bytes).
            if (oversize == OversizeKind.TextChars)
            {
                OversizedClipDropped?.Invoke("text", 0, MaxTextChars);
            }
            else if (oversize == OversizeKind.AllocBytes)
            {
                OversizedClipDropped?.Invoke("text", 0, (long)MaxClipboardAllocBytes);
            }

            // Remember the state we actually observed so extra WM_CLIPBOARDUPDATE deliveries for the same
            // clipboard state are not processed twice. A failed read leaves it unset so the
            // next delivery retries instead of silently skipping a real capture.
            // If the clipboard sequence changed mid-read (postSeq != seq), do not advance _lastCapturedSeq
            // to postSeq with the older read payload, ensuring the upcoming WM_CLIPBOARDUPDATE for postSeq
            // is captured cleanly.
            if (text != null)
            {
                _lastCapturedSeq = seq;
            }

            if (!string.IsNullOrEmpty(text))
            {
                if (IgnoreWhitespaceOnly && string.IsNullOrWhiteSpace(text))
                {
                    return;
                }
                if (text.Length < MinClipLength)
                {
                    return;
                }

                if (TryParseSvg(text, out _, out string? sanitizedSvg) && sanitizedSvg != null)
                {
                    var capturedSvg = sanitizedSvg;
                    EnqueueCapture(() =>
                    {
                        ProcessCapturedSvg(capturedSvg, capturedSource, seq);
                    });
                    return;
                }

                var captured = text;
                var capturedUrl = sourceUrl;
                var capturedRich = richText;
                double readMs = readSw.Elapsed.TotalMilliseconds;
                EnqueueCapture(() =>
                {
                    ProcessCapturedText(captured, capturedSource, capturedUrl, capturedRich, seq, readMs);
                });
                return;
            }

            if (!CaptureImages)
            {
                return;
            }

            var img = ReadClipboardImage();
            if (img != null)
            {
                if ((long)img.Width * img.Height > MaxImagePixelArea)
                {
                    long pixelCount = (long)img.Width * img.Height;
                    img.Dispose();
                    OversizedClipDropped?.Invoke("image", pixelCount, MaxImagePixelArea);
                    return;
                }
                _lastCapturedSeq = seq;
                var capturedImg = img;
                EnqueueCapture(() =>
                {
                    ProcessCapturedImage(capturedImg, capturedSource, seq);
                }, capturedImg);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ClipboardListener] OnClipboardUpdate exception: {ex.GetType().Name} - {ex.Message}");
        }
    }

    private void ProcessCapturedFiles(IReadOnlyList<string> paths, ClipSource source, uint seq)
    {
        try
        {
            if (paths == null || paths.Count == 0) return;

            var (proc, title, pid) = (source.Proc, source.Title, source.Pid);

            // Suppress self-copies from DualClip
            if (pid == _currentPid || string.Equals(proc, "DualClip.exe", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            string fullText = string.Join("\n", paths);

            // Blocklist check (supports double-copy override)
            if (IsBlocklisted(proc, fullText.GetHashCode(StringComparison.Ordinal)))
            {
                return;
            }

            string preview = FormatFilePreview(paths);
            string targetCol = ResolveAutoSortCollection(fullText, proc, title, null);

            var (id, isNew) = _db.AddOrBump(fullText, "file", proc, title, targetCol, preview);

            if (isNew) _db.EnforceMaxClipsIfNeeded(MaxClipsLimit);

            if (id > 0)
            {
                var clip = _db.GetClipById(id);
                if (clip != null)
                {
                    ClipCaptured?.Invoke(clip, isNew);
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ClipboardListener] ProcessCapturedFiles error: {ex.Message}");
        }
    }

    private static string Trim(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        return value.Length <= max ? value : value.Substring(0, max) + "...";
    }

    private void ProcessCapturedText(string text, ClipSource source, string? sourceUrl, string? richText, uint seq, double readMs = 0)
    {
        try
        {
            if (text.Length > MaxTextChars)
            {
                OversizedClipDropped?.Invoke("text", text.Length, MaxTextChars);
                return;
            }

            var (proc, title, pid) = (source.Proc, source.Title, source.Pid);

            // Suppress self-copies from DualClip
            if (pid == _currentPid || string.Equals(proc, "DualClip.exe", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            // Password vault exclusion
            if (IgnorePasswords && IsVaultProcess(proc, title, source.FullPath))
            {
                return;
            }

            // Blocklist check (supports double-copy override)
            if (IsBlocklisted(proc, text != null ? text.GetHashCode(StringComparison.Ordinal) : 0))
            {
                return;
            }

            // Auto-sort rule matching
            string targetCol = ResolveAutoSortCollection(text, proc, title, sourceUrl);

            bool isVoice = proc.Contains("wispr", StringComparison.OrdinalIgnoreCase) ||
                           title.Contains("wispr", StringComparison.OrdinalIgnoreCase);
            string track = isVoice ? "voice" : "manual";

            var dbSw = Stopwatch.StartNew();
            var (id, isNew) = _db.AddOrBump(text, track, proc, title, targetCol, previewOverride: null, richText: richText);
            dbSw.Stop();

            // Keep history within MaxClips during normal capture, not only when the
            // setting is changed. The check is amortized inside the service.
            if (isNew) _db.EnforceMaxClipsIfNeeded(MaxClipsLimit);

            if (id > 0)
            {
                var clip = _db.GetClipById(id);
                if (clip != null)
                {
                    ClipCaptured?.Invoke(clip, isNew);
                }
            }
        }
        catch
        {
        }
    }

    private void ProcessCapturedImage(Image img, ClipSource source, uint seq)
    {
        try
        {
            using (img)
            {
                if ((long)img.Width * img.Height > MaxImagePixelArea)
                {
                    OversizedClipDropped?.Invoke("image", (long)img.Width * img.Height, MaxImagePixelArea);
                    return; // Drop excessively large pixel images
                }

                if (IsMultiFrameGif(img, out int _))
                {
                    try
                    {
                        using var gifMs = new MemoryStream();
                        img.Save(gifMs, ImageFormat.Gif);
                        byte[] gifBytes = gifMs.ToArray();
                        if (gifBytes.Length <= MaxImageBytes && IsGifHeader(gifBytes))
                        {
                            ProcessCapturedGifBytes(gifBytes, source, seq);
                            return;
                        }
                    }
                    catch { }
                }

                Image effective = img;
                Image? clamped = null;
                try
                {
                    clamped = ClampImageIfNeeded(img);
                    if (clamped != null) effective = clamped;

                    var (proc, title, pid) = (source.Proc, source.Title, source.Pid);

                    // Suppress self-copies from DualClip
                    if (pid == _currentPid || string.Equals(proc, "DualClip.exe", StringComparison.OrdinalIgnoreCase))
                    {
                        return;
                    }

                    // Password vault exclusion
                    if (IgnorePasswords && IsVaultProcess(proc, title, source.FullPath))
                    {
                        return;
                    }

                    // Blocklist check (supports double-copy override)
                    if (IsBlocklisted(proc, effective.Width ^ (effective.Height << 16)))
                    {
                        return;
                    }

                    byte[] pngBytes;
                    using (var ms = new MemoryStream())
                    {
                        effective.Save(ms, ImageFormat.Png);
                        pngBytes = ms.ToArray();
                    }

                    if (pngBytes.Length > MaxImageBytes)
                    {
                        OversizedClipDropped?.Invoke("image", pngBytes.Length, MaxImageBytes);
                        return; // Drop if encoded PNG exceeds limit
                    }

                    var hash = Convert.ToHexString(SHA256.HashData(pngBytes));
                    int width = effective.Width;
                    int height = effective.Height;
                    string dims = $"{width} × {height}";

                    string sizeStr;
                    if (pngBytes.Length < 1024 * 1024)
                    {
                        sizeStr = $"{Math.Max(1, pngBytes.Length / 1024)} KB PNG";
                    }
                    else
                    {
                        sizeStr = $"{((double)pngBytes.Length / (1024 * 1024)):F1} MB PNG";
                    }

                    string thumbnailData = GenerateThumbnailDataUri(effective, 240, 160);

                    var imagesDir = PathHelper.GetImagesFolder();
                    var imageFilePath = Path.Combine(imagesDir, $"{hash}.png");
                    if (!File.Exists(imageFilePath))
                    {
                        File.WriteAllBytes(imageFilePath, pngBytes);
                    }
                    else
                    {
                        try { File.SetCreationTimeUtc(imageFilePath, DateTime.UtcNow); } catch { }
                    }

                    // Auto-sort rule matching
                    string targetCol = ResolveAutoSortCollection(null, proc, title);

                    string track = "manual";
                    // Exclude window title for screenshots/images, preserving source process
                    var (id, isNew) = _db.AddOrBumpImage(hash, imageFilePath, thumbnailData, dims, sizeStr, track, proc, null, targetCol);
                    if (isNew) _db.EnforceMaxClipsIfNeeded(MaxClipsLimit);
                    if (id > 0)
                    {
                        var clip = _db.GetClipById(id);
                        if (clip != null)
                        {
                            ClipCaptured?.Invoke(clip, isNew);
                        }
                    }
                }
                finally
                {
                    clamped?.Dispose();
                }
            }
        }
        catch
        {
        }
    }

    private void ProcessCapturedGifBytes(byte[] gifBytes, ClipSource source, uint seq)
    {
        try
        {
            if (gifBytes == null || gifBytes.Length == 0) return;
            if (gifBytes.Length > MaxImageBytes)
            {
                OversizedClipDropped?.Invoke("image", gifBytes.Length, MaxImageBytes);
                return;
            }

            var (proc, title, pid) = (source.Proc, source.Title, source.Pid);
            if (pid == _currentPid || string.Equals(proc, "DualClip.exe", StringComparison.OrdinalIgnoreCase)) return;
            if (IgnorePasswords && IsVaultProcess(proc, title, source.FullPath)) return;
            if (IsBlocklisted(proc, gifBytes.Length ^ (gifBytes[0] << 16))) return;

            using var ms = new MemoryStream(gifBytes);
            using var img = Image.FromStream(ms);

            if ((long)img.Width * img.Height > MaxImagePixelArea) return;

            int width = img.Width;
            int height = img.Height;
            string dims = $"{width} × {height}";

            string sizeStr = gifBytes.Length < 1024 * 1024
                ? $"{Math.Max(1, gifBytes.Length / 1024)} KB GIF"
                : $"{((double)gifBytes.Length / (1024 * 1024)):F1} MB GIF";

            string thumbnailData = GenerateThumbnailDataUri(img, 240, 160);
            var hash = Convert.ToHexString(SHA256.HashData(gifBytes));

            var imagesDir = PathHelper.GetImagesFolder();
            var imageFilePath = Path.Combine(imagesDir, $"{hash}.gif");
            if (!File.Exists(imageFilePath))
            {
                File.WriteAllBytes(imageFilePath, gifBytes);
            }
            else
            {
                try { File.SetCreationTimeUtc(imageFilePath, DateTime.UtcNow); } catch { }
            }

            string targetCol = ResolveAutoSortCollection(null, proc, title);
            string track = "manual";
            // Exclude window title for screenshots/images, preserving source process
            var (id, isNew) = _db.AddOrBumpImage(hash, imageFilePath, thumbnailData, dims, sizeStr, track, proc, null, targetCol);
            if (isNew) _db.EnforceMaxClipsIfNeeded(MaxClipsLimit);
            if (id > 0)
            {
                var clip = _db.GetClipById(id);
                if (clip != null)
                {
                    ClipCaptured?.Invoke(clip, isNew);
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ClipboardListener] ProcessCapturedGifBytes error: {ex.Message}");
        }
    }

    private void ProcessCapturedSvg(string svgMarkup, ClipSource source, uint seq)
    {
        try
        {
            var (proc, title, pid) = (source.Proc, source.Title, source.Pid);

            // Suppress self-copies from DualClip
            if (pid == _currentPid || string.Equals(proc, "DualClip.exe", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            // Password vault exclusion
            if (IgnorePasswords && IsVaultProcess(proc, title, source.FullPath))
            {
                return;
            }

            // Blocklist check (supports double-copy override)
            if (IsBlocklisted(proc, svgMarkup.GetHashCode(StringComparison.Ordinal)))
            {
                return;
            }

            byte[] svgBytes = Encoding.UTF8.GetBytes(svgMarkup);
            if (svgBytes.Length > MaxImageBytes)
            {
                return;
            }

            var hash = Convert.ToHexString(SHA256.HashData(svgBytes));

            TryParseSvg(svgMarkup, out string dims, out _);

            string sizeStr;
            if (svgBytes.Length < 1024)
            {
                sizeStr = $"{svgBytes.Length} B SVG";
            }
            else if (svgBytes.Length < 1024 * 1024)
            {
                sizeStr = $"{Math.Max(1, svgBytes.Length / 1024)} KB SVG";
            }
            else
            {
                sizeStr = $"{((double)svgBytes.Length / (1024 * 1024)):F1} MB SVG";
            }

            string thumbnailData = $"data:image/svg+xml;base64,{Convert.ToBase64String(svgBytes)}";

            var imagesDir = PathHelper.GetImagesFolder();
            var imageFilePath = Path.Combine(imagesDir, $"{hash}.svg");
            if (!File.Exists(imageFilePath))
            {
                File.WriteAllBytes(imageFilePath, svgBytes);
            }
            else
            {
                try { File.SetCreationTimeUtc(imageFilePath, DateTime.UtcNow); } catch { }
            }

            // Auto-sort rule matching
            string targetCol = ResolveAutoSortCollection(svgMarkup, proc, title);

            string track = "manual";
            // Exclude window title for screenshots/images, preserving source process
            var (id, isNew) = _db.AddOrBumpSvg(hash, svgMarkup, imageFilePath, thumbnailData, dims, sizeStr, track, proc, null, targetCol);
            if (isNew) _db.EnforceMaxClipsIfNeeded(MaxClipsLimit);
            if (id > 0)
            {
                var clip = _db.GetClipById(id);
                if (clip != null)
                {
                    ClipCaptured?.Invoke(clip, isNew);
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ClipboardListener] ProcessCapturedSvg error: {ex.Message}");
        }
    }

    public static bool TryParseSvg(string? text, out string dims, out string? sanitizedSvg)
    {
        dims = "Vector SVG";
        sanitizedSvg = null;

        if (string.IsNullOrWhiteSpace(text)) return false;
        if (text.Length > 2_000_000) return false;

        string trimmed = text.Trim();
        int svgOpenIdx = trimmed.IndexOf("<svg", StringComparison.OrdinalIgnoreCase);
        if (svgOpenIdx < 0) return false;
        int svgCloseIdx = trimmed.LastIndexOf("</svg>", StringComparison.OrdinalIgnoreCase);
        if (svgCloseIdx < 0 && !trimmed.EndsWith("/>", StringComparison.Ordinal)) return false;

        try
        {
            var settings = new System.Xml.XmlReaderSettings
            {
                DtdProcessing = System.Xml.DtdProcessing.Prohibit,
                XmlResolver = null,
                IgnoreComments = true,
                IgnoreWhitespace = true,
                MaxCharactersInDocument = 2_000_000
            };

            using var sr = new StringReader(trimmed);
            using var reader = System.Xml.XmlReader.Create(sr, settings);
            var doc = System.Xml.Linq.XDocument.Load(reader);
            var root = doc.Root;

            if (root == null || !string.Equals(root.Name.LocalName, "svg", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            string? width = root.Attribute("width")?.Value;
            string? height = root.Attribute("height")?.Value;
            string? viewBox = root.Attribute("viewBox")?.Value;

            dims = FormatSvgDimensions(width, height, viewBox);

            // Strip potentially malicious executable elements
            doc.Descendants().Where(e =>
                string.Equals(e.Name.LocalName, "script", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(e.Name.LocalName, "foreignObject", StringComparison.OrdinalIgnoreCase)
            ).ToList().ForEach(e => e.Remove());

            // Strip dangerous inline event handlers and javascript: URLs
            foreach (var el in root.DescendantsAndSelf())
            {
                el.Attributes().Where(a =>
                    a.Name.LocalName.StartsWith("on", StringComparison.OrdinalIgnoreCase) ||
                    a.Value.TrimStart().StartsWith("javascript:", StringComparison.OrdinalIgnoreCase)
                ).ToList().ForEach(a => a.Remove());
            }

            sanitizedSvg = doc.ToString(System.Xml.Linq.SaveOptions.DisableFormatting);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string FormatSvgDimensions(string? width, string? height, string? viewBox)
    {
        string? cleanW = CleanSvgDimension(width);
        string? cleanH = CleanSvgDimension(height);

        if (!string.IsNullOrEmpty(cleanW) && !string.IsNullOrEmpty(cleanH))
        {
            return $"{cleanW} × {cleanH}";
        }

        if (!string.IsNullOrWhiteSpace(viewBox))
        {
            var parts = viewBox.Split(new[] { ' ', ',', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 4)
            {
                string vbW = CleanSvgDimension(parts[2]) ?? parts[2];
                string vbH = CleanSvgDimension(parts[3]) ?? parts[3];
                return $"{vbW} × {vbH}";
            }
        }

        return "Vector SVG";
    }

    private static string? CleanSvgDimension(string? dim)
    {
        if (string.IsNullOrWhiteSpace(dim)) return null;
        dim = dim.Trim().ToLowerInvariant();
        if (dim.EndsWith("px", StringComparison.OrdinalIgnoreCase)) dim = dim.Substring(0, dim.Length - 2).Trim();
        if (double.TryParse(dim, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double val))
        {
            return Math.Round(val).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        return dim;
    }

    private static Image? ClampImageIfNeeded(Image src)
    {
        int w = src.Width, h = src.Height;
        if (w <= MaxImageDimension && h <= MaxImageDimension) return null;

        double ratioX = (double)MaxImageDimension / w;
        double ratioY = (double)MaxImageDimension / h;
        double ratio = Math.Min(ratioX, ratioY);
        int dstW = Math.Max(1, (int)(w * ratio));
        int dstH = Math.Max(1, (int)(h * ratio));
        var dst = new Bitmap(dstW, dstH);
        using (var g = Graphics.FromImage(dst))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, dstW, dstH);
        }
        return dst;
    }

    internal static string GenerateThumbnailDataUri(Image img, int maxW, int maxH)
    {
        try
        {
            int srcW = img.Width;
            int srcH = img.Height;
            if (srcW <= 0 || srcH <= 0) return string.Empty;

            double ratioX = (double)maxW / srcW;
            double ratioY = (double)maxH / srcH;
            double ratio = Math.Min(ratioX, ratioY);
            if (ratio > 1.0) ratio = 1.0;

            int dstW = (int)Math.Max(1, srcW * ratio);
            int dstH = (int)Math.Max(1, srcH * ratio);

            using var thumb = new Bitmap(dstW, dstH);
            using (var g = Graphics.FromImage(thumb))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                g.DrawImage(img, 0, 0, dstW, dstH);
            }

            using var ms = new MemoryStream();
            thumb.Save(ms, ImageFormat.Jpeg);
            var base64 = Convert.ToBase64String(ms.ToArray());
            return $"data:image/jpeg;base64,{base64}";
        }
        catch
        {
            return string.Empty;
        }
    }

    public const int MaxRichTextBytes = 500 * 1024; // 500 KB limit for rich text streams

    /// <summary>
    /// Reads CF_UNICODETEXT as fast as possible so a tool that writes the clipboard and restores
    /// the previous content within a few milliseconds still gets captured. Retries are gated on the
    /// clipboard sequence number: if the clipboard changes while we are waiting for the lock, the
    /// content we were woken for is already gone - abandon the stale read and let the newer
    /// WM_CLIPBOARDUPDATE message handle the new state instead of mis-attributing it.
    /// Also extracts SourceURL and rich text formats (RTF/HTML) while the clipboard is locked.
    /// </summary>
    private static (string? text, string? sourceUrl, string? richText, string? note, OversizeKind oversize) ReadClipboardText(uint seqAtArrival)
    {
        const int maxAttempts = 6;

        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            if (OpenClipboard(IntPtr.Zero))
            {
                try
                {
                    var hGlobal = GetClipboardData(CF_UNICODETEXT);
                    if (hGlobal == IntPtr.Zero)
                    {
                        return (null, null, null, "clipboard has no CF_UNICODETEXT", OversizeKind.None);
                    }

                    ulong allocBytes = GlobalSize(hGlobal).ToUInt64();
                    if (allocBytes == 0)
                    {
                        return (null, null, null, "zero size allocation", OversizeKind.None);
                    }
                    if (allocBytes > MaxClipboardAllocBytes)
                    {
                        return (null, null, null, $"clipboard allocation too large ({allocBytes} bytes)", OversizeKind.AllocBytes);
                    }

                    var ptr = GlobalLock(hGlobal);
                    if (ptr == IntPtr.Zero)
                    {
                        return (null, null, null, "GlobalLock failed", OversizeKind.None);
                    }

                    string? extractedText = null;
                    try
                    {
                        int maxCharsInAlloc = (int)(allocBytes / sizeof(char));
                        int limit = Math.Min(maxCharsInAlloc, MaxTextChars + 1);
                        unsafe
                        {
                            char* p = (char*)ptr;
                            int len = 0;
                            while (len < limit && p[len] != '\0')
                            {
                                len++;
                            }
                            if (len > MaxTextChars)
                            {
                                return (null, null, null, "text length exceeds MaxTextChars limit", OversizeKind.TextChars);
                            }
                            extractedText = new string(p, 0, len);
                        }
                    }
                    finally
                    {
                        GlobalUnlock(hGlobal);
                    }

                    // Extract SourceURL and rich text stream (RTF / HTML) while clipboard is open
                    var (richText, sourceUrl) = ExtractRichAndSourceUrlFromOpenClipboard();

                    return (extractedText, sourceUrl, richText, null, OversizeKind.None);
                }
                finally
                {
                    CloseClipboard();
                }
            }

            int err = Marshal.GetLastWin32Error();
            uint nowSeq = GetClipboardSequenceNumber();

            if (nowSeq != 0 && seqAtArrival != 0 && nowSeq != seqAtArrival)
            {
                // The clipboard changed while we waited for the lock: the content this message was
                // posted for is already gone. Do not keep retrying - the newer state has its own
                // WM_CLIPBOARDUPDATE message, and reporting it here would mis-attribute it.
                return (null, null, null, $"superseded by seq {nowSeq} after {attempt} attempt(s), OpenClipboard err={err}", OversizeKind.None);
            }

            // Keep the wait sub-millisecond on the first attempts: every millisecond spent here is a
            // millisecond in which a fast writer can restore the previous clipboard content.
            if (attempt > 3) Thread.Sleep(1);
            else Thread.Yield();
        }

        return (null, null, null, $"OpenClipboard timeout after {maxAttempts} attempts", OversizeKind.None);
    }

    private static (string? richText, string? sourceUrl) ExtractRichAndSourceUrlFromOpenClipboard()
    {
        string? richText = null;
        string? sourceUrl = null;

        try
        {
            // 1. Try RTF (Rich Text Format)
            if (CF_RTF != 0)
            {
                var hRtf = GetClipboardData(CF_RTF);
                if (hRtf != IntPtr.Zero)
                {
                    ulong allocBytes = GlobalSize(hRtf).ToUInt64();
                    if (allocBytes > 0 && allocBytes <= (ulong)MaxRichTextBytes)
                    {
                        var ptr = GlobalLock(hRtf);
                        if (ptr != IntPtr.Zero)
                        {
                            try
                            {
                                int len = (int)allocBytes;
                                byte[] buffer = new byte[len];
                                Marshal.Copy(ptr, buffer, 0, len);
                                int realLen = Array.IndexOf(buffer, (byte)0);
                                if (realLen < 0) realLen = len;
                                string rtfStr = Encoding.UTF8.GetString(buffer, 0, realLen);
                                if (rtfStr.StartsWith("{\\rtf", StringComparison.OrdinalIgnoreCase))
                                {
                                    richText = "rtf:" + rtfStr;
                                }
                            }
                            catch { }
                            finally
                            {
                                GlobalUnlock(hRtf);
                            }
                        }
                    }
                }
            }

            // 2. Try HTML Format (also extracts SourceURL if present)
            if (CF_HTML != 0)
            {
                var hHtml = GetClipboardData(CF_HTML);
                if (hHtml != IntPtr.Zero)
                {
                    ulong allocBytes = GlobalSize(hHtml).ToUInt64();
                    if (allocBytes > 0 && allocBytes <= 10 * 1024 * 1024)
                    {
                        var ptr = GlobalLock(hHtml);
                        if (ptr != IntPtr.Zero)
                        {
                            try
                            {
                                int copyLen = (int)Math.Min(allocBytes, 10 * 1024 * 1024UL);
                                byte[] buffer = new byte[copyLen];
                                Marshal.Copy(ptr, buffer, 0, copyLen);
                                int realLen = Array.IndexOf(buffer, (byte)0);
                                if (realLen < 0) realLen = copyLen;
                                string htmlText = Encoding.UTF8.GetString(buffer, 0, realLen);

                                var match = Regex.Match(htmlText, @"(?im)^SourceURL:\s*(https?://[^\r\n]+)", RegexOptions.CultureInvariant);
                                if (match.Success)
                                {
                                    var url = match.Groups[1].Value.Trim();
                                    if (!string.IsNullOrWhiteSpace(url))
                                    {
                                        sourceUrl = url;
                                    }
                                }

                                if (richText == null && copyLen <= MaxRichTextBytes &&
                                    (htmlText.Contains("<!--StartFragment-->", StringComparison.OrdinalIgnoreCase) ||
                                     htmlText.StartsWith("Version:", StringComparison.OrdinalIgnoreCase) ||
                                     htmlText.Contains("<html", StringComparison.OrdinalIgnoreCase)))
                                {
                                    richText = "html:" + htmlText;
                                }
                            }
                            catch { }
                            finally
                            {
                                GlobalUnlock(hHtml);
                            }
                        }
                    }
                }
            }
        }
        catch { }

        return (richText, sourceUrl);
    }

    /// <summary>
    /// Resolves the writer of the current clipboard state. GetClipboardOwner() is the process that
    /// actually set the data (e.g. "Wispr Flow" during dictation); the foreground window is only a
    /// fallback, because by the time a paste lands the foreground app is the paste target.
    /// </summary>
    private static ClipSource GetClipboardSourceProcessInfo(bool allowForegroundFallback = true)
    {
        IntPtr ownerHwnd = GetClipboardOwner();
        string proc = "unknown";
        string title = "";
        uint pid = 0;
        string? fullPath = null;

        if (ownerHwnd != IntPtr.Zero)
        {
            (proc, title, pid, fullPath) = GetProcessInfoFromHwnd(ownerHwnd);
        }

        // If clipboard owner is missing or has an empty window title (e.g. Chrome/Edge internal message window),
        // enrich the window title and process from the active foreground window.
        if (allowForegroundFallback && (string.IsNullOrWhiteSpace(proc) || string.Equals(proc, "unknown", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(title)))
        {
            var (fgProc, fgTitle, fgPid, fgFullPath) = GetForegroundProcessInfo();
            if (string.IsNullOrWhiteSpace(proc) || string.Equals(proc, "unknown", StringComparison.OrdinalIgnoreCase))
            {
                proc = fgProc;
                pid = fgPid;
                fullPath = fgFullPath;
            }
            if (string.IsNullOrWhiteSpace(title) && !string.IsNullOrWhiteSpace(fgTitle))
            {
                title = fgTitle;
            }
        }

        return new ClipSource(ownerHwnd, proc, title, pid, fullPath);
    }

    private static (string proc, string title, uint pid, string? fullPath) GetProcessInfoFromHwnd(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return ("unknown", "", 0, null);

        GetWindowThreadProcessId(hwnd, out var pid);

        var titleSb = new StringBuilder(256);
        GetWindowText(hwnd, titleSb, 256);
        var title = titleSb.ToString();

        string proc = "unknown";
        string? fullPath = null;
        if (pid > 0)
        {
            var hProc = OpenProcess(0x1000 | 0x0400, false, (int)pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (hProc != IntPtr.Zero)
            {
                try
                {
                    var procSb = new StringBuilder(1024);
                    int size = procSb.Capacity;
                    if (QueryFullProcessImageName(hProc, 0, procSb, ref size))
                    {
                        fullPath = procSb.ToString();
                        proc = System.IO.Path.GetFileName(fullPath);
                    }
                }
                finally
                {
                    CloseHandle(hProc);
                }
            }
        }

        if (!string.IsNullOrEmpty(fullPath) && !string.IsNullOrEmpty(proc) && !string.Equals(proc, "unknown", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                AppIconStore.QueueExtract(proc, fullPath);
            }
            catch { }
        }

        return (proc, title, pid, fullPath);
    }

    private static (string proc, string title, uint pid, string? fullPath) GetForegroundProcessInfo()
    {
        var hwnd = GetForegroundWindow();
        return GetProcessInfoFromHwnd(hwnd);
    }

    private static bool IsVaultProcess(string proc, string title, string? fullPath = null)
    {
        var p = proc.ToLowerInvariant();
        var t = title.ToLowerInvariant();
        var f = (fullPath ?? string.Empty).ToLowerInvariant();

        bool Matches(string s) =>
            s.Contains("bitwarden") || s.Contains("1password") || s.Contains("keepass") ||
            s.Contains("lastpass") || s.Contains("dashlane") || s.Contains("enpass") ||
            s.Contains("proton pass") || s.Contains("protonpass") || s.Contains("nordpass") ||
            s.Contains("roboform") || s.Contains("authenticator") || s.Contains("keepassxc") ||
            s.Contains("keeper") || s.Contains("stickypass") || s.Contains("stickypassword") ||
            s.Contains("passwordsafe") || s.Contains("pwsafe") || s.Contains("pleasant") ||
            s.Contains("zoho vault") || s.Contains("zohovault") || s.Contains("myki") ||
            s.Contains("msecure") || s.Contains("vault");

        return Matches(p) || Matches(t) || Matches(f);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        // 1. Unregister listener window
        try
        {
            if (_window != null && !_window.IsDisposed)
            {
                if (_window.IsHandleCreated)
                {
                    _window.Invoke(new Action(() =>
                    {
                        _window.Close();
                        _window.Dispose();
                    }));
                }
                else
                {
                    _window.Dispose();
                }
            }
        }
        catch { }

        // 2. Mark queue as complete
        try
        {
            _shutdownRequested = true;
            _captureQueue.CompleteAdding();
        }
        catch { }

        // 3. Gracefully join the worker thread so in-flight captures persist
        try
        {
            if (_captureWorkerThread.IsAlive)
            {
                _captureWorkerThread.Join(2000);
            }
        }
        catch { }

        // 4. Release the queue's semaphores and wait handles (C3: genuine
        // handle leak on every exit before this).
        try
        {
            _captureQueue.Dispose();
        }
        catch { }
    }

    private class ListenerWindow : Form
    {
        private readonly ClipboardListener _parent;
        private const int WM_CLIPBOARDUPDATE = 0x031D;

        public ListenerWindow(ClipboardListener parent)
        {
            _parent = parent;
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            Size = new System.Drawing.Size(0, 0);
            Location = new System.Drawing.Point(-32000, -32000);
            AddClipboardFormatListener(Handle);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_CLIPBOARDUPDATE)
            {
                _parent.OnClipboardUpdate();
            }
            base.WndProc(ref m);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            RemoveClipboardFormatListener(Handle);
            base.OnFormClosing(e);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool AddClipboardFormatListener(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr hWndNewOwner);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

    [DllImport("user32.dll")]
    private static extern IntPtr GetClipboardData(uint uFormat);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern uint RegisterClipboardFormat(string lpszFormat);

    private static readonly uint CF_HTML = RegisterClipboardFormat("HTML Format");
    private static readonly uint CF_RTF = RegisterClipboardFormat("Rich Text Format");

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern UIntPtr GlobalSize(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    private string ResolveAutoSortCollection(string? text, string proc, string title, string? sourceUrl = null)
    {
        if (AutoSortRules == null || AutoSortRules.Count == 0) return "all";

        var urlRules = new List<AutoSortRuleEntry>();
        var titleRules = new List<AutoSortRuleEntry>();
        var procRules = new List<AutoSortRuleEntry>();

        foreach (var r in AutoSortRules)
        {
            var type = r.GetEffectiveType();
            if (type == "url" || type == "url_domain" || type == "domain" || type == "website")
                urlRules.Add(r);
            else if (type == "title" || type == "window" || type == "window_title")
                titleRules.Add(r);
            else
                procRules.Add(r);
        }

        // 1. Priority 1: URL / Domain match on browser Address Bar / Source URL (site the text was copied from)
        if (urlRules.Count > 0 && !string.IsNullOrEmpty(sourceUrl))
        {
            foreach (var r in urlRules)
            {
                var pat = r.GetEffectivePattern();
                if (string.IsNullOrEmpty(pat)) continue;

                if (MatchUrlPattern(sourceUrl, pat))
                {
                    return r.Collection;
                }
            }
        }

        // 2. Priority 2: URL / Domain match on copied text content (e.g. copying a link or domain directly)
        if (urlRules.Count > 0 && !string.IsNullOrEmpty(text))
        {
            foreach (var r in urlRules)
            {
                var pat = r.GetEffectivePattern();
                if (string.IsNullOrEmpty(pat)) continue;

                if (MatchUrlPattern(text, pat))
                {
                    return r.Collection;
                }
            }
        }

        // 3. Priority 3: Window / Tab title match (explicit title rules take precedence over broad browser title matches)
        if (titleRules.Count > 0 && !string.IsNullOrEmpty(title))
        {
            foreach (var r in titleRules)
            {
                var pat = r.GetEffectivePattern();
                if (string.IsNullOrEmpty(pat)) continue;
                if (MatchWildcard(title, pat))
                {
                    return r.Collection;
                }
            }
        }

        // 4. Priority 4: URL / Domain match on active browser window title (e.g. browsing a website whose domain is in the window title)
        if (urlRules.Count > 0 && !string.IsNullOrEmpty(title))
        {
            foreach (var r in urlRules)
            {
                var pat = r.GetEffectivePattern();
                if (string.IsNullOrEmpty(pat)) continue;

                if (MatchUrlPattern(title, pat))
                {
                    return r.Collection;
                }
            }
        }

        // 4. Priority 4: Process name match
        if (procRules.Count > 0 && !string.IsNullOrEmpty(proc))
        {
            var procName = Path.GetFileName(proc);
            foreach (var r in procRules)
            {
                var pat = r.GetEffectivePattern();
                if (string.IsNullOrEmpty(pat)) continue;
                if (string.Equals(pat, proc, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(pat, procName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(pat + ".exe", procName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(pat, Path.GetFileNameWithoutExtension(procName), StringComparison.OrdinalIgnoreCase))
                {
                    return r.Collection;
                }
            }
        }

        return "all";
    }

    private static bool MatchUrlPattern(string input, string pattern)
    {
        if (string.IsNullOrWhiteSpace(input) || string.IsNullOrWhiteSpace(pattern)) return false;
        var cleanPat = pattern.Trim();

        // 1. Wildcard rules: strict wildcard evaluation
        if (cleanPat.Contains('*') || cleanPat.Contains('?'))
        {
            if (MatchWildcard(input, cleanPat)) return true;
        }

        // 2. Normalize pattern: remove protocol (https://, http://) and leading www.
        var normPat = cleanPat;
        if (normPat.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            normPat = normPat.Substring(8);
        else if (normPat.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            normPat = normPat.Substring(7);
        if (normPat.StartsWith("www.", StringComparison.OrdinalIgnoreCase))
            normPat = normPat.Substring(4);
        normPat = normPat.TrimEnd('/');

        // 3. Direct substring match
        if (input.Contains(cleanPat, StringComparison.OrdinalIgnoreCase) ||
            (!string.IsNullOrEmpty(normPat) && input.Contains(normPat, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        // 4. URL Host / Domain matching if input is a valid URL (e.g. SourceURL)
        if (Uri.TryCreate(input, UriKind.Absolute, out var uri))
        {
            var host = uri.Host;
            var targetHost = normPat;

            // Strip any path segment from targetHost if user typed domain/path
            int slashIdx = targetHost.IndexOf('/');
            if (slashIdx >= 0) targetHost = targetHost.Substring(0, slashIdx);

            if (string.Equals(host, targetHost, StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith("." + targetHost, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        else
        {
            // 5. If input is a window title (e.g. "My Document - Notion - Google Chrome"),
            // match the brand name from the domain pattern (e.g. "notion" from "app.notion.com")
            var coreDomain = cleanPat.Trim('*', '?', ' ', '/', '\\');
            if (coreDomain.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                coreDomain = coreDomain.Substring(8);
            else if (coreDomain.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                coreDomain = coreDomain.Substring(7);
            if (coreDomain.StartsWith("www.", StringComparison.OrdinalIgnoreCase))
                coreDomain = coreDomain.Substring(4);

            var domainParts = coreDomain.Split(new[] { '.', '/' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in domainParts)
            {
                if (part.Length < 3 ||
                    part.Equals("com", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("net", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("org", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("app", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("www", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("api", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("co", StringComparison.OrdinalIgnoreCase) ||
                    part.Equals("io", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (input.Contains(part, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool MatchWildcard(string text, string pattern)
    {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(pattern)) return false;
        var cleanPattern = pattern.Trim();

        if (!cleanPattern.Contains('*') && !cleanPattern.Contains('?'))
        {
            return text.Contains(cleanPattern, StringComparison.OrdinalIgnoreCase);
        }

        var regexPattern = "^" + Regex.Escape(cleanPattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
        try
        {
            return Regex.IsMatch(text, regexPattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }
        catch
        {
            return text.Contains(cleanPattern.Replace("*", "").Replace("?", ""), StringComparison.OrdinalIgnoreCase);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalFree(IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [DllImport("user32.dll")]
    private static extern IntPtr GetClipboardOwner();

    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    internal static bool IsFullscreenForeground()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return false;
            if (!GetWindowRect(hwnd, out var rect)) return false;
            var screen = System.Windows.Forms.Screen.FromHandle(hwnd);
            var bounds = screen.Bounds;
            return rect.Left <= bounds.Left && rect.Top <= bounds.Top
                && rect.Right >= bounds.Right && rect.Bottom >= bounds.Bottom;
        }
        catch
        {
            return false;
        }
    }

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr hProcess, int flags, StringBuilder lpExeName, ref int lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
