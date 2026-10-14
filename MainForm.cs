using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using System.Drawing.Imaging;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using DualClip.Models;
using DualClip.Services;

namespace DualClip;

public partial class MainForm : Form
{
    private readonly WebView2 _webView;
    private readonly DatabaseService _db;
    // get_clips background worker: each keystroke cancels the previous scan.
    // _getClipsSeq mirrors the UI clipFetchSeq — stale completions answer
    // { stale: true } so no slow scan can clobber newer results.
    private CancellationTokenSource? _getClipsCts;
    private readonly object _getClipsCtsGate = new();
    private long _getClipsSeq;
    private readonly ClipboardListener _listener;
    // Highest queue-drop threshold already surfaced to the user (C2). Keeps a
    // sustained capture backlog from posting one toast per dropped update.
    private long _captureDropWarnedAt;
    private readonly HotkeyService _hotkeys;
    private readonly TrayService _tray;

    // Early startup pending event buffer (FIFO queue, max 50 events)
    private readonly List<string> _pendingEventsQueue = new();
    private readonly object _pendingEventsLock = new();
    private static long _pasteSequenceToken = 0;
    private static readonly SemaphoreSlim _pasteExecutionLock = new(1, 1);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern uint RegisterWindowMessage(string lpString);

    private static readonly uint WM_TASKBARCREATED = RegisterWindowMessage("TaskbarCreated");
    public static readonly uint WM_SHOW_DUALCLIP = RegisterWindowMessage("DualClip_ShowInstance");

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ChangeWindowMessageFilter(uint message, uint dwFlag);
    private const uint MSGFLT_ADD = 1;

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    private const uint INPUT_KEYBOARD = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const uint WDA_NONE = 0x00000000;
    private const uint WDA_MONITOR = 0x00000001;
    private const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;
    private const int SM_REMOTESESSION = 0x1000;

    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private const int WM_ACTIVATE = 0x0006;
    private const int WM_MOUSEACTIVATE = 0x0021;
    private const int WA_INACTIVE = 0;
    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    private const int HTLEFT = 10;
    private const int HTRIGHT = 11;
    private const int HTTOP = 12;
    private const int HTTOPLEFT = 13;
    private const int HTTOPRIGHT = 14;
    private const int HTBOTTOM = 15;
    private const int HTBOTTOMLEFT = 16;
    private const int HTBOTTOMRIGHT = 17;
    private const int WM_GETMINMAXINFO = 0x24;
    // Strict minimum window size so the UI never breaks when drag-resized.
    private const int MIN_WINDOW_WIDTH = 300;
    private const int MIN_WINDOW_HEIGHT = 240;
    // Default preset dimensions (matches applyWindowSizePreset 'default' in settings-appearance.js).
    // Used when Remember Window Size is OFF so every show reverts to a known size.
    private const int DEFAULT_WINDOW_WIDTH = 970;
    private const int DEFAULT_WINDOW_HEIGHT = 730;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUND = 2;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_SHIFT = 0x10;
    private const byte VK_V = 0x56;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int VK_MENU = 0x12; // Alt
    private const uint KEYEVENTF_KEYUP = 0x0002;

    private System.Windows.Forms.Timer? _modifierReleaseTimer;
    private System.Windows.Forms.Timer? _foregroundTrackerTimer;
    private System.Threading.Timer? _timedPauseTimer;
    private DateTime? _timedPauseEndTime;

    private IntPtr _lastActiveHwnd = IntPtr.Zero;
    private bool _allowVisible = true;
    private bool _modifiersHeld = false;
    private bool _suppressResizeSave = false;
    private System.Windows.Forms.Timer? _morphTimer;
    private readonly Stopwatch _morphStopwatch = new();
    private int _morphTickCount = 0;
    private double _lastMorphTickMs = 0;
    private const double MorphDurationMs = 180.0;
    // Settings opens the shared OS window at its own fixed size. That size is TRANSIENT
    // and must never be written to AppSettings.WindowWidth/WindowHeight, otherwise
    // ShowWindow would restore the Settings size on the next summon and History would
    // come back larger than the active view mode's preset. Set by set_window_size's
    // `persist` argument; cleared by any persisting resize.
    private bool _transientSize = false;
    private Size _transientSizeValue = Size.Empty;
    // True while any WebView2 dialog (preview, edit, or modal) is open, pushed
    // by the frontend's set_modal_open RPC. While set, blur (outside click)
    // does not auto-hide: the dialog stays up, the bare main list still hides.
    private bool _modalOpen = false;
    private bool _userPinned = false;
    private bool _morphPersistOnComplete = true;
    private Point _morphFromLoc;
    private Size _morphFromSize;
    private Point _morphToLoc;
    private Size _morphToSize;
    private volatile bool _inSequentialPaste = false;
    private DateTime _lastShowTime = DateTime.MinValue;
    private DateTime _lastCycleTime = DateTime.MinValue;
    private const double SummonDebounceMs = HotkeyTogglePolicy.DefaultSummonDebounceMs;
    private const double CycleDebounceMs = HotkeyTogglePolicy.DefaultCycleDebounceMs;

    private bool IsDualClipHwnd(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || hwnd == Handle) return true;
        GetWindowThreadProcessId(hwnd, out var pid);
        return pid == (uint)Environment.ProcessId;
    }

    protected override void SetVisibleCore(bool value)
    {
        if (!_allowVisible)
        {
            value = false;
            if (!IsHandleCreated) CreateHandle();
        }
        base.SetVisibleCore(value);
    }private void EnsureOnScreen()
    {
        try
        {
            var size = new Size(Width, Height);
            var rect = new Rectangle(Left, Top, size.Width, size.Height);

            // IntersectsWith alone counted a one-pixel sliver as "on screen", which let the
            // popup open essentially off the edge of a display. Require a usable footprint.
            var areas = Screen.AllScreens.Select(s => s.WorkingArea).ToList();
            if (WindowPlacement.IsPositionUsable(rect, areas)) return;

            // Anchor to whichever display the pointer is on so the popup reappears where the
            // user is looking, falling back to primary when that display is gone.
            var target = Screen.FromPoint(Cursor.Position).WorkingArea;
            if (!WindowPlacement.IsMeaningfullyVisible(rect, target))
            {
                target = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
            }

            var p = WindowPlacement.ClampToWorkingArea(
                WindowPlacement.CenterIn(size, target), size, target);
            Left = p.X;
            Top = p.Y;
        }
        catch { }
    }

    private bool _sessionEndingHandled;

    private void PerformCleanExitFlush()
    {
        if (_sessionEndingHandled) return;
        _sessionEndingHandled = true;
        try
        {
            var s = AppSettings.Load();
            AppSettings.Save(s);
        }
        catch { }
        try { _db?.MarkSessionCleanExit(); } catch { }
        try { _db?.ShutdownMaintenance(); } catch { }
    }

    private void SystemEvents_SessionEnding(object? sender, Microsoft.Win32.SessionEndingEventArgs e)
    {
        PerformCleanExitFlush();
    }

    private void SystemEvents_PowerModeChanged(object? sender, Microsoft.Win32.PowerModeChangedEventArgs e)
    {
        if (e.Mode == Microsoft.Win32.PowerModes.Suspend)
        {
            // Flush WAL before a potential power loss so less history lives only in -wal.
            try { _db?.CheckpointWal(); } catch { }
            try
            {
                if (IsHandleCreated && !IsDisposed) BeginInvoke(new Action(() => HideWindow()));
                else HideWindow();
            }
            catch { }
        }
        else if (e.Mode == Microsoft.Win32.PowerModes.Resume)
        {
            try { _listener?.ReArmListener(); } catch { }
        }
    }

    private void SystemEvents_SessionSwitch(object? sender, Microsoft.Win32.SessionSwitchEventArgs e)
    {
        if (e.Reason == Microsoft.Win32.SessionSwitchReason.SessionLock ||
            e.Reason == Microsoft.Win32.SessionSwitchReason.SessionLogoff)
        {
            try
            {
                if (IsHandleCreated && !IsDisposed) BeginInvoke(new Action(() => HideWindow()));
                else HideWindow();
            }
            catch { }
        }
        else if (e.Reason == Microsoft.Win32.SessionSwitchReason.SessionUnlock ||
                 e.Reason == Microsoft.Win32.SessionSwitchReason.RemoteConnect ||
                 e.Reason == Microsoft.Win32.SessionSwitchReason.RemoteDisconnect)
        {
            try { _listener?.ReArmListener(); } catch { }
            try { ApplyScreenCaptureProtection(AppSettings.Load().PreventScreenCapture); } catch { }
        }
    }

    private void ApplyScreenCaptureProtection(bool enable)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => ApplyScreenCaptureProtection(enable)));
            return;
        }

        try
        {
            if (!IsHandleCreated || IsDisposed) return;

            if (enable)
            {
                // Safety guard: Never apply capture affinity over RDP
                int isRemote = GetSystemMetrics(SM_REMOTESESSION);
                if (isRemote != 0)
                {
                    Debug.WriteLine("[Privacy] Remote Desktop session detected; screen capture protection suspended.");
                    SetWindowDisplayAffinity(Handle, WDA_NONE);
                    return;
                }

                // Try modern EXCLUDEFROMCAPTURE first (Win10 2004+ / Win11); fallback to WDA_MONITOR
                if (!SetWindowDisplayAffinity(Handle, WDA_EXCLUDEFROMCAPTURE))
                {
                    SetWindowDisplayAffinity(Handle, WDA_MONITOR);
                }
            }
            else
            {
                SetWindowDisplayAffinity(Handle, WDA_NONE);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Privacy] ApplyScreenCaptureProtection failed: {ex.Message}");
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (_hotkeys != null && !IsDisposed && IsHandleCreated)
        {
            _hotkeys.ReRegister(Handle);
        }
    }

    private const int WM_EXITSIZEMOVE = 0x0232;

    private void SaveCurrentWindowSize()
    {
        if (_suppressResizeSave) return;
        if (_transientSize) return;
        try
        {
            if (Width >= MIN_WINDOW_WIDTH && Height >= MIN_WINDOW_HEIGHT)
            {
                var s = AppSettings.Load(forceReload: true);
                bool isCompact = string.Equals(s.LayoutPreset, "compact", StringComparison.OrdinalIgnoreCase);
                if (isCompact)
                {
                    s.CompactWidth = Width;
                    s.CompactHeight = Height;
                }
                else
                {
                    s.StandardWidth = Width;
                    s.StandardHeight = Height;
                    s.WindowWidth = Width;
                    s.WindowHeight = Height;
                }
                s.LastWindowWidth = Width;
                s.LastWindowHeight = Height;
                AppSettings.Save(s);
            }
        }
        catch { }
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e);
        SaveCurrentWindowSize();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideWindow();
            return;
        }

        try { Microsoft.Win32.SystemEvents.SessionEnding -= SystemEvents_SessionEnding; } catch { }
        try { Microsoft.Win32.SystemEvents.PowerModeChanged -= SystemEvents_PowerModeChanged; } catch { }
        try { Microsoft.Win32.SystemEvents.SessionSwitch -= SystemEvents_SessionSwitch; } catch { }
        try { _listener?.Dispose(); } catch { }
        try { _tray?.Dispose(); } catch { }
        try { _hotkeys?.Dispose(); } catch { }
        try { _modifierReleaseTimer?.Dispose(); } catch { }
        try { _foregroundTrackerTimer?.Dispose(); } catch { }
        try { _timedPauseTimer?.Dispose(); } catch { }
        PerformCleanExitFlush();

        base.OnFormClosing(e);
    }

    public MainForm(bool startHidden = false)
    {
        PathHelper.CleanupTempFolders();

        if (startHidden)
        {
            _allowVisible = false;
        }

        try { Microsoft.Win32.SystemEvents.SessionEnding += SystemEvents_SessionEnding; } catch { }
        try { Microsoft.Win32.SystemEvents.PowerModeChanged += SystemEvents_PowerModeChanged; } catch { }
        try { Microsoft.Win32.SystemEvents.SessionSwitch += SystemEvents_SessionSwitch; } catch { }

        if (WM_SHOW_DUALCLIP != 0)
        {
            try { ChangeWindowMessageFilter(WM_SHOW_DUALCLIP, MSGFLT_ADD); } catch { }
        }
        if (WM_TASKBARCREATED != 0)
        {
            try { ChangeWindowMessageFilter(WM_TASKBARCREATED, MSGFLT_ADD); } catch { }
        }

        PurgeStaleDragTempFiles();

        Text = "DualClip";
        Width = 970;
        Height = 730;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(8, 9, 12);
        ShowInTaskbar = false;
        KeyPreview = true;
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);
        UpdateStyles();

        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "app.ico");
        if (File.Exists(iconPath))
        {
            try { Icon = new Icon(iconPath); } catch { }
        }

        try
        {
            int preference = DWMWCP_ROUND;
            DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref preference, sizeof(int));
        }
        catch { }

        _db = new DatabaseService();
        _listener = new ClipboardListener(_db);
        _listener.ClipCaptured += OnClipCaptured;
        _listener.OversizedClipDropped += OnOversizedClipDropped;
        _listener.CaptureQueueDropped += OnCaptureQueueDropped;

        _hotkeys = new HotkeyService(Handle);
        _hotkeys.HotkeyPressed += () =>
        {
            try
            {
                if (AppSettings.Load().SuppressInFullscreen && Services.ClipboardListener.IsFullscreenForeground()) return;
            }
            catch { }
            if (InvokeRequired)
            {
                BeginInvoke(new Action(ToggleWindow));
            }
            else
            {
                ToggleWindow();
            }
        };

        var settings = AppSettings.Load();
        _listener.ApplySettings(settings);
        // Size the form from the pure show-time policy instead of the Remember-only branch,
        // so a cold start already sits at the active preset's dimensions (mirrored from the
        // frontend) before its first paint — no reveal-then-resize race.
        var startupArea = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
        var (startW, startH) = WindowSizePolicy.Resolve(
            settings.LayoutPreset,
            settings.StandardWidth, settings.StandardHeight,
            settings.CompactWidth, settings.CompactHeight,
            settings.LastWindowWidth, settings.LastWindowHeight,
            startupArea, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
        Width = startW;
        Height = startH;
        ShowInTaskbar = settings.ShowTaskbar;
        ApplyScreenCaptureProtection(settings.PreventScreenCapture);

        if (settings.HotkeyWin || settings.HotkeyAlt || !settings.HotkeyCtrl || !settings.HotkeyShift || settings.HotkeyVk != 0x56)
        {
            // Startup must honour the failure result exactly like the set_hotkey RPC does. Dropping
            // it left the app silently running Ctrl+Shift+V while settings.json and the Settings UI
            // kept advertising a binding that was never registered.
            // (K3 in docs/audits/keyboard-hotkeys-audit-2026-10-05.md)
            bool hotkeyRegistered = _hotkeys.UpdateCustomHotkey(settings.HotkeyWin, settings.HotkeyCtrl, settings.HotkeyAlt, settings.HotkeyShift, settings.HotkeyVk);
            if (!hotkeyRegistered)
            {
                var fallback = AppSettings.Load();
                fallback.HotkeyWin = false;
                fallback.HotkeyCtrl = true;
                fallback.HotkeyAlt = false;
                fallback.HotkeyShift = true;
                fallback.HotkeyVk = (int)Keys.V;
                AppSettings.Save(fallback);
                PostEventToJs("onToast", new { message = "Your saved shortcut is already used by another app. Using Ctrl + Shift + V instead." });
                try { _tray?.ShowNotification("DualClip", "Saved shortcut unavailable — using Ctrl + Shift + V.", ToolTipIcon.Warning); } catch { }
            }
        }

        _tray = new TrayService();
        _tray.SetTheme(settings.TrayTheme);
        if (settings.IsPaused && settings.PausedUntilUtc.HasValue)
        {
            var remaining = settings.PausedUntilUtc.Value - DateTime.UtcNow;
            if (remaining > TimeSpan.Zero)
            {
                int remainingMinutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));
                _timedPauseEndTime = settings.PausedUntilUtc.Value;
                _tray.SetPaused(true, $"{remainingMinutes}m", remainingMinutes);
                _timedPauseTimer = new System.Threading.Timer(_ =>
                {
                    BeginInvoke(() =>
                    {
                        _timedPauseTimer?.Dispose();
                        _timedPauseTimer = null;
                        _timedPauseEndTime = null;
                        _listener.IsPaused = false;
                        _tray.SetPaused(false);
                        var cur = AppSettings.Load();
                        cur.IsPaused = false;
                        cur.PausedUntilUtc = null;
                        AppSettings.Save(cur);
                        PostEventToJs("onPauseChanged", new { paused = false });
                        PostEventToJs("onCaptureStateChanged", new { paused = false, is_timed = false, remaining_seconds = 0 });
                    });
                }, null, remaining, Timeout.InfiniteTimeSpan);
            }
            else
            {
                settings.IsPaused = false;
                settings.PausedUntilUtc = null;
                _listener.IsPaused = false;
                AppSettings.Save(settings);
                _tray.SetPaused(false);
            }
        }
        else
        {
            _tray.SetPaused(settings.IsPaused);
        }
        _tray.ToggleRequested += () => ToggleWindow(true);

        _tray.PauseIndefiniteRequested += () =>
        {
            _timedPauseTimer?.Dispose();
            _timedPauseTimer = null;
            _timedPauseEndTime = null;
            _listener.IsPaused = true;
            _tray.SetPaused(true, "Until Resumed");
            var cur = AppSettings.Load();
            cur.IsPaused = true;
            cur.PausedUntilUtc = null;
            AppSettings.Save(cur);
            PostEventToJs("onPauseChanged", new { paused = true });
            PostEventToJs("onCaptureStateChanged", new { paused = true, is_timed = false, remaining_seconds = 0 });
        };

        _tray.TimedPauseRequested += (minutes) =>
        {
            _timedPauseTimer?.Dispose();
            _timedPauseEndTime = DateTime.UtcNow.AddMinutes(minutes);
            _listener.IsPaused = true;
            _tray.SetPaused(true, $"{minutes}m", minutes);
            var cur = AppSettings.Load();
            cur.IsPaused = true;
            cur.PausedUntilUtc = _timedPauseEndTime;
            AppSettings.Save(cur);

            _timedPauseTimer = new System.Threading.Timer(_ =>
            {
                BeginInvoke(() =>
                {
                    _timedPauseTimer?.Dispose();
                    _timedPauseTimer = null;
                    _timedPauseEndTime = null;
                    _listener.IsPaused = false;
                    _tray.SetPaused(false);
                    var cur2 = AppSettings.Load();
                    cur2.IsPaused = false;
                    cur2.PausedUntilUtc = null;
                    AppSettings.Save(cur2);
                    PostEventToJs("onPauseChanged", new { paused = false });
                    PostEventToJs("onCaptureStateChanged", new { paused = false, is_timed = false, remaining_seconds = 0 });
                });
            }, null, TimeSpan.FromMinutes(minutes), Timeout.InfiniteTimeSpan);

            PostEventToJs("onPauseChanged", new { paused = true });
            PostEventToJs("onCaptureStateChanged", new { paused = true, is_timed = true, remaining_seconds = minutes * 60 });
        };

        _tray.ResumeRequested += () =>
        {
            _timedPauseTimer?.Dispose();
            _timedPauseTimer = null;
            _timedPauseEndTime = null;
            _listener.IsPaused = false;
            _tray.SetPaused(false);
            var cur = AppSettings.Load();
            cur.IsPaused = false;
            cur.PausedUntilUtc = null;
            AppSettings.Save(cur);
            PostEventToJs("onPauseChanged", new { paused = false });
            PostEventToJs("onCaptureStateChanged", new { paused = false, is_timed = false, remaining_seconds = 0 });
        };

        _tray.ClearOlderThanRequested += (days) =>
        {
            Task.Run(() =>
            {
                try
                {
                    bool ok = _db.ClearHistoryAdvanced(olderThanDays: days, keepPinned: true, keepStarred: true, keepCustomCollections: true);
                    if (!ok)
                    {
                        SendToast("Clear canceled: " + (_db.LastBackupError ?? "backup failed"));
                        return;
                    }
                    PostEventToJs("refreshClips", new { });
                }
                catch
                {
                }
            });
        };
        _tray.ClearExceptOrganizedRequested += () =>
        {
            Task.Run(() =>
            {
                try
                {
                    bool ok = _db.ClearHistoryAdvanced(olderThanDays: null, keepPinned: true, keepStarred: true, keepCustomCollections: true);
                    if (!ok)
                    {
                        SendToast("Clear canceled: " + (_db.LastBackupError ?? "backup failed"));
                        return;
                    }
                    PostEventToJs("refreshClips", new { });
                }
                catch
                {
                }
            });
        };
        _tray.ClearImagesOnlyRequested += () =>
        {
            Task.Run(() =>
            {
                try
                {
                    bool ok = _db.ClearHistoryAdvanced(olderThanDays: null, keepPinned: true, keepStarred: true, keepCustomCollections: true, onlyImages: true);
                    if (!ok)
                    {
                        SendToast("Clear canceled: " + (_db.LastBackupError ?? "backup failed"));
                        return;
                    }
                    PostEventToJs("refreshClips", new { });
                }
                catch
                {
                }
            });
        };
        _tray.ExitRequested += () =>
        {
            _tray.Dispose();
            _listener.Dispose();
            _hotkeys.Dispose();
            System.Windows.Forms.Application.Exit();
        };

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(8, 9, 12)
        };
        Controls.Add(_webView);

        AllowDrop = true;

        DragEnter += HandleFormDragEnter;
        DragOver += HandleFormDragOver;
        DragLeave += HandleFormDragLeave;
        DragDrop += HandleFormDragDrop;

        _webView.DragEnter += HandleFormDragEnter;
        _webView.DragOver += HandleFormDragOver;
        _webView.DragLeave += HandleFormDragLeave;
        _webView.DragDrop += HandleFormDragDrop;

        KeyDown += (s, e) =>
        {
            if (e.KeyCode == Keys.Escape)
            {
                HideWindow();
                e.Handled = true;
            }
        };

        Deactivate += (s, e) =>
        {
            if (_inSequentialPaste)
            {
                return;
            }
            if ((DateTime.UtcNow - _lastShowTime).TotalMilliseconds < 250)
            {
                return;
            }
            var fg = GetForegroundWindow();
            if (fg != IntPtr.Zero && !IsDualClipHwnd(fg))
            {
                _lastActiveHwnd = fg;
            }
            // Stay visible while focus is inside our own windows (e.g. the
            // detached preview); only auto-hide when focus leaves the app.
            // A dialog (preview/edit/modal) pins the window: outside clicks
            // leave it up, the bare main list still auto-hides.
            if (!TopMost && !_modalOpen && Visible && (fg == IntPtr.Zero || !IsDualClipHwnd(fg)))
            {
                HideWindow();
            }
        };

        _foregroundTrackerTimer = new System.Windows.Forms.Timer { Interval = 500 };
        _foregroundTrackerTimer.Tick += (s, e) =>
        {
            var fg = GetForegroundWindow();
            if (fg != IntPtr.Zero && !IsDualClipHwnd(fg))
            {
                _lastActiveHwnd = fg;
            }
        };
        _foregroundTrackerTimer.Start();

        InitWebViewAsync();

        if (!startHidden)
        {
            ShowWindow();
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_GETMINMAXINFO)
        {
            try
            {
                var mmi = (MINMAXINFO)Marshal.PtrToStructure(m.LParam, typeof(MINMAXINFO))!;
                mmi.ptMinTrackSize.x = MIN_WINDOW_WIDTH;
                mmi.ptMinTrackSize.y = MIN_WINDOW_HEIGHT;
                Marshal.StructureToPtr(mmi, m.LParam, true);
            }
            catch { }
        }
        else if (m.Msg == WM_EXITSIZEMOVE)
        {
            SaveCurrentWindowSize();
        }
        if (m.Msg == WM_ACTIVATE)
        {
            int wa = (int)(m.WParam.ToInt64() & 0xFFFF);
            if (wa != WA_INACTIVE)
            {
                IntPtr prev = m.LParam;
                if (prev != IntPtr.Zero && !IsDualClipHwnd(prev))
                {
                    _lastActiveHwnd = prev;
                }
                else
                {
                    var fg = GetForegroundWindow();
                    if (fg != IntPtr.Zero && !IsDualClipHwnd(fg))
                    {
                        _lastActiveHwnd = fg;
                    }
                }
            }
        }
        else if (m.Msg == WM_MOUSEACTIVATE)
        {
            var fg = GetForegroundWindow();
            if (fg != IntPtr.Zero && !IsDualClipHwnd(fg))
            {
                _lastActiveHwnd = fg;
            }
        }
        else if (WM_TASKBARCREATED != 0 && (uint)m.Msg == WM_TASKBARCREATED)
        {
            _tray?.RecreateIcon();
        }
        else if (WM_SHOW_DUALCLIP != 0 && (uint)m.Msg == WM_SHOW_DUALCLIP)
        {
            ShowWindow();
        }
        else if (m.Msg == 0x007E /* WM_DISPLAYCHANGE */ || m.Msg == 0x02E0 /* WM_DPICHANGED */)
        {
            EnsureOnScreen();
            // H6: nudge layout so the Dock.Fill WebView2 re-evaluates scale after DPI/RDP changes
            try
            {
                if (IsHandleCreated && !IsDisposed && Visible)
                {
                    BeginInvoke(new Action(() =>
                    {
                        _suppressResizeSave = true;
                        try
                        {
                            var s = Size;
                            Size = new Size(s.Width + 1, s.Height);
                            Size = s;
                        }
                        catch { }
                        finally
                        {
                            _suppressResizeSave = false;
                        }
                    }));
                }
            }
            catch { }
        }
        else if (m.Msg == 0x0011 /* WM_QUERYENDSESSION */ || m.Msg == 0x0016 /* WM_ENDSESSION */)
        {
            PerformCleanExitFlush();
        }

        _hotkeys?.ProcessHotkeyMessage(ref m);
        base.WndProc(ref m);
    }

    private bool AreAnyModifiersHeld()
    {
        bool winDown = (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
        bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_LCONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_RCONTROL) & 0x8000) != 0;
        bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0 || (GetAsyncKeyState(VK_LSHIFT) & 0x8000) != 0 || (GetAsyncKeyState(VK_RSHIFT) & 0x8000) != 0;
        bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
        return winDown || ctrlDown || shiftDown || altDown;
    }

    private void ToggleWindow() => ToggleWindow(false);

    private void ToggleWindow(bool fromTray)
    {
        var fgToggle = GetForegroundWindow();
        bool isForeground = fgToggle == Handle || IsDualClipHwnd(fgToggle);
        double elapsedSinceShow = (DateTime.UtcNow - _lastShowTime).TotalMilliseconds;
        double elapsedSinceCycle = (DateTime.UtcNow - _lastCycleTime).TotalMilliseconds;
        var settings = AppSettings.Load();

        var action = HotkeyTogglePolicy.Evaluate(
            isVisible: Visible,
            isForeground: isForeground,
            elapsedSinceShowMs: elapsedSinceShow,
            elapsedSinceCycleMs: elapsedSinceCycle,
            smartShortcuts: settings.SmartShortcuts,
            modifiersHeld: _modifiersHeld && AreAnyModifiersHeld(),
            fromTray: fromTray,
            summonDebounceMs: SummonDebounceMs,
            cycleDebounceMs: CycleDebounceMs);

        switch (action)
        {
            case HotkeyAction.Show:
            case HotkeyAction.RepositionAndBringToFront:
                // Summon requested: ensures window is placed at active cursor on active monitor,
                // brought cleanly to front, and debounced against rapid bounces.
                ShowWindow(fromTray);
                if (!fromTray)
                {
                    StartModifierReleaseTracker();
                }
                break;

            case HotkeyAction.IgnoreBounce:
                // Rapid repeat / bounce buffer: absorbs accidental multi-taps, key repeats,
                // or queued hotkey messages under system stress.
                break;

            case HotkeyAction.CycleNext:
                _lastCycleTime = DateTime.UtcNow;
                PostEventToJs("onCycleNext", new { });
                StartModifierReleaseTracker();
                break;

            case HotkeyAction.IgnoreCycleCooldown:
                // Cycle repeat cooldown to prevent runaway stepping
                break;

            case HotkeyAction.Hide:
                HideWindow();
                break;
        }
    }

    private void StartModifierReleaseTracker()
    {
        _modifiersHeld = true;
        if (_modifierReleaseTimer == null)
        {
            _modifierReleaseTimer = new System.Windows.Forms.Timer { Interval = 25 };
            _modifierReleaseTimer.Tick += OnModifierTimerTick;
        }
        _modifierReleaseTimer.Stop();
        _modifierReleaseTimer.Start();
    }

    private void StopModifierReleaseTracker()
    {
        _modifiersHeld = false;
        _modifierReleaseTimer?.Stop();
    }

    private void OnModifierTimerTick(object? sender, EventArgs e)
    {
        if (!Visible)
        {
            StopModifierReleaseTracker();
            return;
        }

        if (!AreAnyModifiersHeld())
        {
            StopModifierReleaseTracker();
            PostEventToJs("onWinReleased", new { });
        }
    }

    private void ShowWindow(bool fromTray = false)
    {
        var popupSw = Stopwatch.StartNew();
        _allowVisible = true;
        Opacity = 1.0;
        if (WindowState == FormWindowState.Minimized)
        {
            WindowState = FormWindowState.Normal;
        }
        var fg = GetForegroundWindow();
        if (fg != IntPtr.Zero && fg != Handle)
        {
            _lastActiveHwnd = fg;
        }

        var settings = AppSettings.Load();
        int x, y;
        var cursor = Cursor.Position;
        var screen = Screen.FromPoint(cursor).WorkingArea;
        if (_transientSize && _transientSizeValue != Size.Empty)
        {
            // Settings is still open on this hidden window: re-apply the transient size instead
            // of the remembered History size, so the open Settings view is not shown at the
            // wrong (History) dimensions.
            if (Width != _transientSizeValue.Width || Height != _transientSizeValue.Height)
            {
                _suppressResizeSave = true;
                try
                {
                    Size = _transientSizeValue;
                }
                finally
                {
                    _suppressResizeSave = false;
                }
            }
        }
        else
        {
            // Resolve the summon size synchronously BEFORE Show(): Remember ON replays the
            // persisted size; Remember OFF replays the frontend's last applied preset size
            // (LastWindow* mirror) instead of hard-resetting to 960x720. This is what kills
            // the show-then-shrink flicker: the OS window is composited at the correct bounds
            // on its very first frame, with no onWindowShow round-trip and no morph.
            var (showW, showH) = WindowSizePolicy.Resolve(
                settings.LayoutPreset,
                settings.StandardWidth, settings.StandardHeight,
                settings.CompactWidth, settings.CompactHeight,
                settings.LastWindowWidth, settings.LastWindowHeight,
                screen, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
            if (Width != showW || Height != showH)
            {
                _suppressResizeSave = true;
                try
                {
                    Size = new Size(showW, showH);
                }
                finally
                {
                    _suppressResizeSave = false;
                }
            }
        }
        var mode = fromTray ? (settings.TrayPositionMode ?? "center") : (settings.WindowPositionMode ?? "near");
        mode = (mode ?? "").Trim().ToLowerInvariant();

        if (mode == "near_above" || mode == "above" || mode == "centered_above")
        {
            // "Near Cursor (Centered Above)": horizontally centered above the pointer (legacy behavior).
            x = cursor.X - (Width / 2);
            y = cursor.Y - 50;
        }
        else if (mode == "tray" || mode == "corner")
        {
            x = WindowPlacement.BottomRight(new Size(Width, Height), screen).X;
            y = WindowPlacement.BottomRight(new Size(Width, Height), screen).Y;
        }
        else if (mode == "center")
        {
            var c = WindowPlacement.CenterIn(new Size(Width, Height), screen);
            x = c.X;
            y = c.Y;
        }
        else if (mode == "last" && settings.WindowX.HasValue && settings.WindowY.HasValue)
        {
            x = settings.WindowX.Value;
            y = settings.WindowY.Value;
            // The saved position is only usable if a meaningful slice of the window is still
            // on an attached display; otherwise the monitor may have been disconnected.
            var lastRect = new Rectangle(x, y, Width, Height);
            var areas = Screen.AllScreens.Select(s => s.WorkingArea).ToList();
            if (!WindowPlacement.IsPositionUsable(lastRect, areas))
            {
                var c = WindowPlacement.CenterIn(new Size(Width, Height), screen);
                x = c.X;
                y = c.Y;
            }
        }
        else
        {
            // "near" / "cursor": window's top-left corner pinned just off the pointer (menu-style).
            x = cursor.X + 8;
            y = cursor.Y + 4;
        }

        // Every mode funnels through the same clamp so a popup can never open off-screen or
        // under a taskbar, whichever mode produced the candidate position.
        var clamped = WindowPlacement.ClampToWorkingArea(new Point(x, y), new Size(Width, Height), screen);
        x = clamped.X;
        y = clamped.Y;

        Location = new Point(x, y);
        EnsureOnScreen(); // H4: guarantee every show path lands on-screen
        _lastShowTime = DateTime.UtcNow;
        Show();
        Activate();
        ForceForegroundWindow();
        try { _webView?.Focus(); } catch { }
        try { ApplyScreenCaptureProtection(settings.PreventScreenCapture); } catch { }

        popupSw.Stop();
        PostEventToJs("onWindowShow", new { });
    }

    private void ForceForegroundWindow()
    {
        try
        {
            SetWindowPos(Handle, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            BringWindowToTop(Handle);

            // Fast direct activation: registering the hotkey grants foreground transfer rights in Windows
            if (SetForegroundWindow(Handle))
            {
                return;
            }

            // Harmless null key input unlocks Windows foreground lock without tying thread input queues
            keybd_event(0, 0, 0, UIntPtr.Zero);
            if (SetForegroundWindow(Handle))
            {
                return;
            }

            var fg = GetForegroundWindow();
            uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out _) : 0;
            uint curThread = GetCurrentThreadId();

            if (fgThread != 0 && fgThread != curThread)
            {
                AttachThreadInput(curThread, fgThread, true);
                try
                {
                    BringWindowToTop(Handle);
                    SetForegroundWindow(Handle);
                }
                finally
                {
                    AttachThreadInput(curThread, fgThread, false);
                }
            }
            else
            {
                BringWindowToTop(Handle);
                SetForegroundWindow(Handle);
            }
        }
        catch
        {
        }
    }

    private static Point CalculateInPlaceTargetLocation(Point currentLoc, Size currentSize, Size targetSize, Rectangle workingArea)
    {
        int currentCenterX = currentLoc.X + currentSize.Width / 2;
        int currentCenterY = currentLoc.Y + currentSize.Height / 2;

        int targetX = currentCenterX - targetSize.Width / 2;
        int targetY = currentCenterY - targetSize.Height / 2;

        int minX = workingArea.X + WindowPlacement.EdgeMargin;
        int maxX = workingArea.Right - targetSize.Width - WindowPlacement.EdgeMargin;
        int minY = workingArea.Y + WindowPlacement.EdgeMargin;
        int maxY = workingArea.Bottom - targetSize.Height - WindowPlacement.EdgeMargin;

        int clampedX = maxX >= minX ? Math.Clamp(targetX, minX, maxX) : minX;
        int clampedY = maxY >= minY ? Math.Clamp(targetY, minY, maxY) : minY;

        return new Point(clampedX, clampedY);
    }

    /// <summary>
    /// Smooth ~180ms ease-out tween of window bounds.
    /// Grows/shrinks anchored symmetrically on the current window center.
    /// </summary>
    private void StartBoundsMorph(Size targetSize, bool centerInPlace = true, bool persistOnComplete = true)
    {
        // Guard 1: If already actively morphing to this exact target size, do not interrupt and restart
        if (_morphTimer != null && _morphTimer.Enabled && _morphToSize == targetSize)
        {
            DebugLogger.Log("Backend:Morph", $"StartBoundsMorph IGNORED: already morphing to {targetSize.Width}x{targetSize.Height}");
            return;
        }

        // Guard 2: If the window is already at the target size, skip replaying an empty bounds animation
        if (Size == targetSize)
        {
            DebugLogger.Log("Backend:Morph", $"StartBoundsMorph SKIPPED: window is already at {targetSize.Width}x{targetSize.Height}");
            return;
        }

        try { _morphTimer?.Stop(); } catch { }
        try
        {
            var area = Screen.FromControl(this).WorkingArea;
            _morphFromLoc = Location;
            _morphFromSize = Size;
            _morphToSize = targetSize;
            _morphToLoc = centerInPlace
                ? CalculateInPlaceTargetLocation(_morphFromLoc, _morphFromSize, targetSize, area)
                : _morphFromLoc;
            _suppressResizeSave = true;
            _morphPersistOnComplete = persistOnComplete;
            _morphTickCount = 0;
            _lastMorphTickMs = 0;
            _morphStopwatch.Restart();
            DebugLogger.Log("Backend:Morph", $"StartBoundsMorph: from {_morphFromSize.Width}x{_morphFromSize.Height} at ({_morphFromLoc.X},{_morphFromLoc.Y}) -> to {targetSize.Width}x{targetSize.Height} at ({_morphToLoc.X},{_morphToLoc.Y}), inPlace={centerInPlace}, persist={persistOnComplete}");
            _morphTimer ??= new System.Windows.Forms.Timer { Interval = 16 };
            _morphTimer.Tick -= MorphTimerTick;
            _morphTimer.Tick += MorphTimerTick;
            _morphTimer.Start();
        }
        catch (Exception ex)
        {
            DebugLogger.Log("Backend:Morph", $"StartBoundsMorph ERROR: {ex.Message}");
            _suppressResizeSave = false;
        }
    }

    private void MorphTimerTick(object? sender, EventArgs e)
    {
        try
        {
            _morphTickCount++;
            double elapsed = _morphStopwatch.Elapsed.TotalMilliseconds;
            double delta = elapsed - _lastMorphTickMs;
            _lastMorphTickMs = elapsed;
            double t = Math.Min(1.0, elapsed / MorphDurationMs);
            // Smooth ease-in-out curve to prevent first-frame snapping and stutter
            double k = t < 0.5 ? 2.0 * t * t : 1.0 - Math.Pow(-2.0 * t + 2.0, 2) / 2.0;
            int curX = (int)Math.Round(_morphFromLoc.X + (_morphToLoc.X - _morphFromLoc.X) * k);
            int curY = (int)Math.Round(_morphFromLoc.Y + (_morphToLoc.Y - _morphFromLoc.Y) * k);
            int curW = (int)Math.Round(_morphFromSize.Width + (_morphToSize.Width - _morphFromSize.Width) * k);
            int curH = (int)Math.Round(_morphFromSize.Height + (_morphToSize.Height - _morphFromSize.Height) * k);
            SetBounds(curX, curY, curW, curH, BoundsSpecified.All);
            DebugLogger.Log("Backend:Morph", $"Tick #{_morphTickCount}: delta={delta:F1}ms, elapsed={elapsed:F1}ms, bounds=({curX},{curY},{curW}x{curH}), t={t:F2}");
            if (t >= 1.0)
            {
                try { _morphTimer?.Stop(); } catch { }
                _morphStopwatch.Stop();
                _suppressResizeSave = false;
                DebugLogger.Log("Backend:Morph", $"Morph FINISHED in {elapsed:F1}ms across {_morphTickCount} ticks.");
                // Only a persisting morph may write the remembered size; a transient one
                // (Settings) must leave AppSettings untouched.
                if (_morphPersistOnComplete)
                {
                    var s = AppSettings.Load();
                    if (s.RememberWindowSize)
                    {
                        s.WindowWidth = Size.Width;
                        s.WindowHeight = Size.Height;
                    }
                    // Mirror the settled bounds so the next summon (Remember OFF) restores
                    // this preset size directly — no show-then-morph flicker.
                    s.LastWindowWidth = Size.Width;
                    s.LastWindowHeight = Size.Height;
                    AppSettings.Save(s);
                }
            }
        }
        catch (Exception ex)
        {
            DebugLogger.Log("Backend:Morph", $"MorphTimerTick ERROR: {ex.Message}");
            try { _morphTimer?.Stop(); } catch { }
            _morphStopwatch.Stop();
            _suppressResizeSave = false;
        }
    }

    private void HideWindow()
    {
        var hideSw = Stopwatch.StartNew();
        StopModifierReleaseTracker();
        // Explicit hide always drops the dialog pin (onWindowHide dismisses
        // the dialogs themselves); the next blur starts unpinned.
        _modalOpen = false;
        TopMost = _userPinned;

        // H8: capture geometry on the UI thread, hide immediately, persist async
        int hx = -10001, hy = -10001, hw = 0, hh = 0;
        try
        {
            hx = Location.X; hy = Location.Y; hw = Width; hh = Height;
        }
        catch { }
        bool shouldPersist = hx > -10000 && hy > -10000;
        // Read the transient flag on the UI thread; the persist below runs on a worker.
        bool wasTransient = _transientSize;

        try { Hide(); } catch { }
        hideSw.Stop();
        try { PostEventToJs("onWindowHide", new { }); } catch { }

        if (shouldPersist)
        {
            int sx = hx, sy = hy, sw = hw, sh = hh;
            Task.Run(() =>
            {
                try
                {
                    var cur = AppSettings.Load();
                    cur.WindowX = sx;
                    cur.WindowY = sy;
                    // HideWindow also persists size. While Settings is open the window carries a
                    // transient size, so persisting it here would leak the Settings size into the
                    // next summon regardless of how the user left the view.
                    if (!wasTransient && sw >= MIN_WINDOW_WIDTH && sh >= MIN_WINDOW_HEIGHT)
                    {
                        bool isCompact = string.Equals(cur.LayoutPreset, "compact", StringComparison.OrdinalIgnoreCase);
                        if (isCompact)
                        {
                            cur.CompactWidth = sw;
                            cur.CompactHeight = sh;
                        }
                        else
                        {
                            cur.StandardWidth = sw;
                            cur.StandardHeight = sh;
                            cur.WindowWidth = sw;
                            cur.WindowHeight = sh;
                        }
                        cur.LastWindowWidth = sw;
                        cur.LastWindowHeight = sh;
                    }
                    AppSettings.Save(cur);
                }
                catch { }
            });
        }
    }

    private async void InitWebViewAsync()
    {
        var initSw = Stopwatch.StartNew();
        try
        {
            var userDataFolder = PathHelper.GetWebView2UserDataFolder();
            // Privacy-first: silence Edge/Chromium background networking, component
            // updates, sync, SmartScreen, domain reliability, and telemetry.
            var envOptions = new CoreWebView2EnvironmentOptions(
                "--disable-background-networking " +
                "--disable-component-update " +
                "--disable-sync " +
                "--disable-features=EdgeSmartScreen " +
                "--disable-domain-reliability " +
                "--disable-telemetry " +
                "--disable-background-timer-throttling " +
                "--disable-backgrounding-occluded-windows " +
                "--disable-renderer-backgrounding " +
                "--disable-ipc-flooding-protection");
            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
            await _webView.EnsureCoreWebView2Async(env);

            try
            {
                uint browserPid = _webView.CoreWebView2.BrowserProcessId;
                if (browserPid > 0)
                {
                    using var browserProc = Process.GetProcessById((int)browserPid);
                    browserProc.PriorityClass = ProcessPriorityClass.High;
                }
            }
            catch { }

            var settings = _webView.CoreWebView2.Settings;
            settings.IsStatusBarEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.IsPasswordAutosaveEnabled = false;
            settings.IsZoomControlEnabled = false;
            settings.IsSwipeNavigationEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;

#if !DEBUG
            settings.AreDevToolsEnabled = false;
#endif

            // Controller-level external drop guard & accelerator blocking
            try
            {
                var controllerProp = _webView.GetType().GetProperty("CoreWebView2Controller");
                var controller = controllerProp?.GetValue(_webView) as Microsoft.Web.WebView2.Core.CoreWebView2Controller;
                if (controller != null)
                {
                    try { controller.AllowExternalDrop = true; } catch { }
                    try
                    {
                        controller.AcceleratorKeyPressed += (s, e) =>
                        {
                            if (e.VirtualKey == (uint)Keys.F5 ||
                                (e.VirtualKey == (uint)Keys.R && (Control.ModifierKeys & Keys.Control) != 0))
                            {
                                e.Handled = true;
                            }
                        };
                    }
                    catch { }
                }
            }
            catch { }

            _webView.CoreWebView2.PermissionRequested += (s, e) =>
            {
                e.State = Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Deny;
                e.Handled = true;
            };

            _webView.CoreWebView2.NavigationStarting += (s, e) =>
            {
                if (string.IsNullOrEmpty(e.Uri)) return;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var navUri))
                {
                    if (string.Equals(navUri.Host, "appassets.example", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(navUri.Host, "images.example", StringComparison.OrdinalIgnoreCase) ||
                        navUri.Scheme == "about" || navUri.Scheme == "data")
                    {
                        return;
                    }

                    e.Cancel = true;
                    if (navUri.Scheme == Uri.UriSchemeHttp || navUri.Scheme == Uri.UriSchemeHttps)
                    {
                        try { Process.Start(new ProcessStartInfo(navUri.AbsoluteUri) { UseShellExecute = true }); } catch { }
                    }
                }
            };

            _webView.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                try
                {
                    if (!string.IsNullOrEmpty(e.Uri) && Uri.TryCreate(e.Uri, UriKind.Absolute, out var parsedUri))
                    {
                        if (parsedUri.Scheme == Uri.UriSchemeHttp || parsedUri.Scheme == Uri.UriSchemeHttps)
                        {
                            Process.Start(new ProcessStartInfo(parsedUri.AbsoluteUri) { UseShellExecute = true });
                        }
                    }
                }
                catch { }
            };

            _webView.WebMessageReceived += OnWebMessageReceived;

            var imagesFolder = PathHelper.GetImagesFolder();
            Directory.CreateDirectory(imagesFolder);
            _webView.CoreWebView2.SetVirtualHostNameToFolderMapping("images.example", imagesFolder, CoreWebView2HostResourceAccessKind.Allow);

            var uiFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui");
            if (Directory.Exists(uiFolder))
            {
                _webView.CoreWebView2.SetVirtualHostNameToFolderMapping("appassets.example", uiFolder, CoreWebView2HostResourceAccessKind.Allow);
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                _webView.Source = new Uri($"https://appassets.example/index.html?t={timestamp}");
            }
            else
            {
                _webView.NavigateToString("<html><body style='background:#08090C;color:#E2E4E9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;'><h2>DualClip</h2></body></html>");
            }
            initSw.Stop();
        }
        catch (Exception ex)
        {
            try
            {
                if (IsHandleCreated && !IsDisposed)
                {
                    BeginInvoke(() =>
                    {
                        MessageBox.Show(
                            "Failed to initialize Microsoft Edge WebView2 runtime.\n\n" +
                            "Please ensure the WebView2 Evergreen Runtime is installed.\n\n" +
                            "Error: " + ex.Message,
                            "DualClip - Initialization Error",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                    });
                }
            }
            catch { }

            try
            {
                _webView?.NavigateToString("<html><body style='background:#08090C;color:#E2E4E9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;'><h2>DualClip - WebView2 Initialization Error</h2></body></html>");
            }
            catch { }
        }
    }

    private void OnClipCaptured(ClipItem clip, bool isNew)
    {
        BeginInvoke(() =>
        {
            try
            {
                var payload = FormatClipForJs(clip);
                PostEventToJs(isNew ? "onClipAdded" : "onClipUpdated", payload);
            }
            catch
            {
            }
        });
    }

    private void OnOversizedClipDropped(string type, long actualSize, long maxSize)
    {
        BeginInvoke(() =>
        {
            try
            {
                // Unconditional: the NotifyOversizedClips toggle was removed (B1) because
                // no Settings control ever existed for it, so it could only be changed by
                // hand-editing settings.json. Skipped items are worth reporting.
                string title = "DualClip — Item Skipped";
                string message = type == "text"
                    ? $"Copied text exceeds the safety limit ({Services.ClipboardListener.MaxTextChars:N0} chars) and was not saved."
                    : "Copied image exceeds the maximum supported size limit and was not saved.";

                _tray?.ShowNotification(title, message, ToolTipIcon.Warning);
                PostEventToJs("onToast", new { message = $"Copied {type} exceeded limit (skipped)", type = "warning" });
            }
            catch
            {
            }
        });
    }

    private void OnCaptureQueueDropped(long runningTotal)
    {
        try
        {
            // Raised on the listener thread for every dropped clipboard update, so a
            // flood would post one BeginInvoke per drop. Warn on the first drop, then
            // re-warn only when the running total crosses the next power-of-ten.
            long threshold = 1;
            while (runningTotal > threshold * 10) threshold *= 10;
            if (Interlocked.Exchange(ref _captureDropWarnedAt, threshold) >= threshold) return;

            BeginInvoke(() =>
            {
                try
                {
                    string title = "DualClip — Clipboard Backlog";
                    string message = runningTotal == 1
                        ? "A clipboard update was dropped while DualClip was busy saving. That copy was not saved."
                        : $"{runningTotal:N0} clipboard updates have been dropped while DualClip was busy saving. Some copies were not saved.";

                    _tray?.ShowNotification(title, message, ToolTipIcon.Warning);
                    PostEventToJs("onToast", new
                    {
                        message = runningTotal == 1
                            ? "Clipboard busy — 1 copy was not saved"
                            : $"Clipboard busy — {runningTotal:N0} copies were not saved",
                        type = "warning"
                    });
                }
                catch
                {
                }
            });
        }
        catch
        {
        }
    }

    private void HandleGetClips(long rpcId, JsonElement args)
    {
        string collection = "all";
        string query = "";
        try
        {
            if (args.ValueKind == JsonValueKind.Array)
            {
                // RPC Contract: get_clips(collection:0, filterType:1, filterApp:2, filterTime:3, query:4, sort:5, limit:6, offset:7, fuzzyEnabled:8)
                // Mirrors ui/js/core/rpc-contracts.js
                collection = args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String ? args[0].GetString() ?? "all" : "all";
                string filterType = args.GetArrayLength() > 1 && args[1].ValueKind == JsonValueKind.String ? args[1].GetString() ?? "all" : "all";
                string filterApp = args.GetArrayLength() > 2 && args[2].ValueKind == JsonValueKind.String ? args[2].GetString() ?? "all" : "all";
                string filterTime = args.GetArrayLength() > 3 && args[3].ValueKind == JsonValueKind.String ? args[3].GetString() ?? "any" : "any";
                query = args.GetArrayLength() > 4 && args[4].ValueKind == JsonValueKind.String ? args[4].GetString() ?? "" : "";
                string sort = args.GetArrayLength() > 5 && args[5].ValueKind == JsonValueKind.String ? args[5].GetString() ?? "default" : "default";
                int limit = args.GetArrayLength() > 6 && args[6].ValueKind == JsonValueKind.Number ? args[6].GetInt32() : SearchConstants.DefaultLimit;
                int offset = args.GetArrayLength() > 7 && args[7].ValueKind == JsonValueKind.Number ? args[7].GetInt32() : 0;
                bool fuzzyEnabled = false;
                if (args.GetArrayLength() > 8)
                {
                    if (args[8].ValueKind == JsonValueKind.True) fuzzyEnabled = true;
                    else if (args[8].ValueKind == JsonValueKind.False) fuzzyEnabled = false;
                    else if (args[8].ValueKind == JsonValueKind.String)
                        fuzzyEnabled = args[8].GetString() == "1" || string.Equals(args[8].GetString(), "true", StringComparison.OrdinalIgnoreCase);
                }

                string track = collection switch
                {
                    "transcriptions" => "voice",
                    "pins" => "pins",
                    _ => "all"
                };

                CancellationToken ct;
                long mySeq;
                lock (_getClipsCtsGate)
                {
                    try { _getClipsCts?.Cancel(); } catch { }
                    try { _getClipsCts?.Dispose(); } catch { }
                    _getClipsCts = new CancellationTokenSource();
                    ct = _getClipsCts.Token;
                    mySeq = Interlocked.Increment(ref _getClipsSeq);
                }
                _ = RunGetClipsAsync(rpcId, mySeq, ct, track, collection, filterType, filterApp, filterTime, query, sort, limit, offset, fuzzyEnabled);
                return;
            }
        }
        catch
        {
        }
        SendRpcResponse(rpcId, new { ok = false, clips = new List<object>(), data = new List<object>() });
    }

    private async Task RunGetClipsAsync(long rpcId, long mySeq, CancellationToken ct,
        string track, string collection, string filterType, string filterApp, string filterTime,
        string query, string sort, int limit, int offset, bool fuzzyEnabled)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var raw = await _db.GetClipsAsync(track, query, limit, offset, collection, filterType, filterApp, filterTime, sort, fuzzyEnabled, ct).ConfigureAwait(false);
            sw.Stop();
            if (mySeq != Interlocked.Read(ref _getClipsSeq))
            {
                SendRpcResponse(rpcId, new { ok = true, stale = true, clips = new List<object>(), data = new List<object>() });
                return;
            }
            var formatted = raw.Select(c => FormatClipForJs(c, truncateLargeText: true)).ToList();
            SendRpcResponse(rpcId, new { ok = true, clips = formatted, data = formatted, gen = _db.DataGeneration });
        }
        catch (OperationCanceledException)
        {
            SendRpcResponse(rpcId, new { ok = true, stale = true, clips = new List<object>(), data = new List<object>() });
        }
        catch
        {
            SendRpcResponse(rpcId, new { ok = false, clips = new List<object>(), data = new List<object>() });
        }
    }

    private IntPtr CapturePasteTarget()
    {
        var targetHwnd = _lastActiveHwnd;
        IntPtr currentFg = GetForegroundWindow();
        if (currentFg != IntPtr.Zero && currentFg != Handle && IsWindow(currentFg))
        {
            targetHwnd = currentFg;
        }
        return targetHwnd;
    }

    private void HandlePasteClip(long rpcId, JsonElement args)
    {
        try
        {
            if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long id))
            {
                // args[1] stayOpen (Shift+Enter sequential paste): skip HideWindow
                // and restore DualClip to the foreground after pasting.
                bool stayOpen = args.GetArrayLength() > 1 && TryGetBool(args[1], out bool stayOpenVal) && stayOpenVal;
                if (stayOpen) _inSequentialPaste = true;
                var clip = _db.GetClipById(id);
                if (clip != null)
                {
                    var targetHwnd = CapturePasteTarget();

                    if (!TopMost && !stayOpen)
                    {
                        HideWindow();
                    }

                    bool shouldRestore = AppSettings.Load().RestoreClipboard;
                    long currentPasteToken = Interlocked.Increment(ref _pasteSequenceToken);

                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        _pasteExecutionLock.Wait();
                        object? prevSnapshot = null;
                        try
                        {
                            prevSnapshot = shouldRestore ? _listener.GetClipboardSnapshot() : null;
                            bool writeOk;
                            if (clip.IsImage)
                            {
                                writeOk = _listener.CopyImage(clip.ImagePath);
                            }
                            else if (string.Equals(clip.Track, "file", StringComparison.OrdinalIgnoreCase))
                            {
                                var paths = (clip.Text ?? "").Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                                writeOk = _listener.CopyFileDrop(paths);
                            }
                            else
                            {
                                writeOk = _listener.CopyRichText(clip.Text, clip.RichText);
                            }

                            if (!writeOk)
                            {
                                if (stayOpen) RestoreWindowForSequentialPaste();
                                else ReturnFocusIfPinned();
                                return;
                            }

                            _db.MarkUsed(id);

                            Thread.Sleep(30);
                            bool focusOk = true;
                            if (targetHwnd != IntPtr.Zero && targetHwnd != Handle)
                            {
                                focusOk = ForceForegroundWindow(targetHwnd);
                            }
                            Thread.Sleep(60);
                            bool pasteLanded = focusOk || GetForegroundWindow() == targetHwnd;
                            if (pasteLanded)
                            {
                                SimulatePaste();
                            }
                            else
                            {
                                NotifyElevatedPasteFallback();
                            }

                            if (pasteLanded && shouldRestore && prevSnapshot != null)
                            {
                                Thread.Sleep(300);
                                if (Interlocked.Read(ref _pasteSequenceToken) == currentPasteToken)
                                {
                                    _listener.RestoreClipboardSnapshot(prevSnapshot);
                                }
                            }

                            if (stayOpen) RestoreWindowForSequentialPaste();
                            else ReturnFocusIfPinned();
                        }
                        catch
                        {
                        }
                        finally
                        {
                            _pasteExecutionLock.Release();
                            if (prevSnapshot is IDisposable disposable)
                            {
                                try { disposable.Dispose(); } catch { }
                            }
                        }
                    });

                    SendRpcResponse(rpcId, new { ok = true });
                    return;
                }
            }
        }
        catch
        {
        }
        SendRpcResponse(rpcId, new { ok = false });
    }

    private void HandlePasteText(long rpcId, JsonElement args)
    {
        try
        {
            if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
            {
                string text = args[0].GetString() ?? "";
                if (!string.IsNullOrEmpty(text))
                {
                    var targetHwnd = CapturePasteTarget();

                    if (!TopMost)
                    {
                        HideWindow();
                    }

                    bool shouldRestore = AppSettings.Load().RestoreClipboard;
                    long currentPasteToken = Interlocked.Increment(ref _pasteSequenceToken);

                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        _pasteExecutionLock.Wait();
                        object? prevSnapshot = null;
                        try
                        {
                            prevSnapshot = shouldRestore ? _listener.GetClipboardSnapshot() : null;
                            bool writeOk = _listener.CopyText(text);
                            if (!writeOk)
                            {
                                ReturnFocusIfPinned();
                                return;
                            }

                            Thread.Sleep(30);
                            bool focusOk = true;
                            if (targetHwnd != IntPtr.Zero && targetHwnd != Handle)
                            {
                                focusOk = ForceForegroundWindow(targetHwnd);
                            }
                            Thread.Sleep(60);
                            bool pasteLanded = focusOk || GetForegroundWindow() == targetHwnd;
                            if (pasteLanded)
                            {
                                SimulatePaste();
                            }
                            else
                            {
                                NotifyElevatedPasteFallback();
                            }

                            if (pasteLanded && shouldRestore && prevSnapshot != null)
                            {
                                Thread.Sleep(300);
                                if (Interlocked.Read(ref _pasteSequenceToken) == currentPasteToken)
                                {
                                    _listener.RestoreClipboardSnapshot(prevSnapshot);
                                }
                            }

                            ReturnFocusIfPinned();
                        }
                        catch
                        {
                        }
                        finally
                        {
                            _pasteExecutionLock.Release();
                            if (prevSnapshot is IDisposable disposable)
                            {
                                try { disposable.Dispose(); } catch { }
                            }
                        }
                    });

                    SendRpcResponse(rpcId, new { ok = true });
                    return;
                }
            }
        }
        catch
        {
        }
        SendRpcResponse(rpcId, new { ok = false });
    }

    private void HandlePasteDelete(long rpcId, JsonElement args)
    {
        try
        {
            if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long id))
            {
                var clip = _db.GetClipById(id);
                if (clip != null)
                {
                    var targetHwnd = CapturePasteTarget();
                    if (!TopMost)
                    {
                        HideWindow();
                    }

                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        _pasteExecutionLock.Wait();
                        try
                        {
                            bool writeOk = clip.IsImage
                                ? _listener.CopyImage(clip.ImagePath)
                                : _listener.CopyRichText(clip.Text, clip.RichText);

                            if (!writeOk)
                            {
                                ReturnFocusIfPinned();
                                return;
                            }

                            _db.DeleteClip(id);

                            Thread.Sleep(30);
                            bool focusOk = true;
                            if (targetHwnd != IntPtr.Zero && targetHwnd != Handle)
                            {
                                focusOk = ForceForegroundWindow(targetHwnd);
                            }
                            Thread.Sleep(60);
                            bool pasteLanded = focusOk || GetForegroundWindow() == targetHwnd;
                            if (pasteLanded)
                            {
                                SimulatePaste();
                            }
                            else
                            {
                                NotifyElevatedPasteFallback();
                            }
                            ReturnFocusIfPinned();
                        }
                        catch
                        {
                        }
                        finally
                        {
                            _pasteExecutionLock.Release();
                        }
                    });

                    SendRpcResponse(rpcId, new { ok = true });
                    return;
                }
            }
        }
        catch
        {
        }
        SendRpcResponse(rpcId, new { ok = false });
    }

    private void HandlePasteMulti(long rpcId, JsonElement args)
    {
        try
        {
            if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
            {
                var idList = new List<long>();
                if (args[0].ValueKind == JsonValueKind.Array)
                {
                    foreach (var elem in args[0].EnumerateArray())
                    {
                        if (TryGetClipId(elem, out var cid)) idList.Add(cid);
                    }
                }
                var texts = new List<string>();
                var validTextIds = new List<long>();
                int imageCount = 0;
                string? firstImagePath = null;
                long? firstImageId = null;

                foreach (var id in idList)
                {
                    var clip = _db.GetClipById(id);
                    if (clip != null)
                    {
                        if (clip.IsImage && !string.IsNullOrEmpty(clip.ImagePath))
                        {
                            imageCount++;
                            if (firstImagePath == null)
                            {
                                firstImagePath = clip.ImagePath;
                                firstImageId = id;
                            }
                        }
                        else if (!clip.IsImage && !string.IsNullOrEmpty(clip.Text))
                        {
                            texts.Add(clip.Text);
                            validTextIds.Add(id);
                        }
                    }
                }

                if (texts.Count > 0 || !string.IsNullOrEmpty(firstImagePath))
                {
                    // args[1] stayOpen (Shift+Enter sequential paste): see HandlePasteClip.
                    bool stayOpen = args.GetArrayLength() > 1 &&
                        (args[1].ValueKind == JsonValueKind.True ||
                         (args[1].ValueKind == JsonValueKind.String &&
                          (args[1].GetString() == "1" || string.Equals(args[1].GetString(), "true", StringComparison.OrdinalIgnoreCase))));
                    if (stayOpen) _inSequentialPaste = true;
                    var targetHwnd = CapturePasteTarget();

                    if (!TopMost && !stayOpen)
                    {
                        HideWindow();
                    }

                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        _pasteExecutionLock.Wait();
                        try
                        {
                            bool writeOk = false;
                            var pastedIds = new List<long>();

                            if (texts.Count > 0)
                            {
                                string combined = string.Join(Environment.NewLine, texts);
                                writeOk = _listener.CopyText(combined);
                                if (writeOk)
                                {
                                    pastedIds.AddRange(validTextIds);
                                }
                                if (imageCount > 0)
                                {
                                    SendToast($"Pasted {texts.Count} text clips ({imageCount} image clip(s) skipped; multi-paste joins text only)");
                                }
                            }
                            else if (!string.IsNullOrEmpty(firstImagePath))
                            {
                                writeOk = _listener.CopyImage(firstImagePath);
                                if (writeOk && firstImageId.HasValue)
                                {
                                    pastedIds.Add(firstImageId.Value);
                                }
                                if (imageCount > 1)
                                {
                                    SendToast($"Pasted 1 image ({imageCount - 1} additional image(s) skipped)");
                                }
                            }

                            if (!writeOk)
                            {
                                if (stayOpen) RestoreWindowForSequentialPaste();
                                else ReturnFocusIfPinned();
                                return;
                            }

                            foreach (var id in pastedIds)
                            {
                                _db.MarkUsed(id);
                            }

                            Thread.Sleep(30);
                            bool focusOk = true;
                            if (targetHwnd != IntPtr.Zero && targetHwnd != Handle)
                            {
                                focusOk = ForceForegroundWindow(targetHwnd);
                            }
                            Thread.Sleep(60);
                            bool pasteLanded = focusOk || GetForegroundWindow() == targetHwnd;
                            if (pasteLanded)
                            {
                                SimulatePaste();
                            }
                            else
                            {
                                NotifyElevatedPasteFallback();
                            }
                            if (stayOpen) RestoreWindowForSequentialPaste();
                            else ReturnFocusIfPinned();
                        }
                        catch
                        {
                        }
                        finally
                        {
                            _pasteExecutionLock.Release();
                        }
                    });

                    SendRpcResponse(rpcId, new { ok = true });
                    return;
                }
            }
        }
        catch
        {
        }
        SendRpcResponse(rpcId, new { ok = false });
    }

    private void HandleCopyClip(long rpcId, JsonElement args)
    {
        try
        {
            if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
            {
                if (args[0].ValueKind == JsonValueKind.Number && TryGetClipId(args[0], out long id))
                {
                    var clip = _db.GetClipById(id);
                    if (clip != null)
                    {
                        bool writeOk;
                        if (clip.IsImage)
                        {
                            writeOk = _listener.CopyImage(clip.ImagePath);
                        }
                        else if (string.Equals(clip.Track, "file", StringComparison.OrdinalIgnoreCase))
                        {
                            var paths = (clip.Text ?? "").Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                            writeOk = _listener.CopyFileDrop(paths);
                        }
                        else
                        {
                            writeOk = _listener.CopyRichText(clip.Text, clip.RichText);
                        }
                        SendRpcResponse(rpcId, new { ok = writeOk });
                        return;
                    }
                }
                else if (args[0].ValueKind == JsonValueKind.String)
                {
                    string text = args[0].GetString() ?? "";
                    bool writeTextOk = _listener.CopyText(text);
                    SendRpcResponse(rpcId, new { ok = writeTextOk });
                    return;
                }
                else if (args[0].ValueKind == JsonValueKind.Object && TryGetClipId(args[0], out long objId))
                {
                    var clip = _db.GetClipById(objId);
                    if (clip != null)
                    {
                        bool writeOk;
                        if (clip.IsImage)
                        {
                            writeOk = _listener.CopyImage(clip.ImagePath);
                        }
                        else if (string.Equals(clip.Track, "file", StringComparison.OrdinalIgnoreCase))
                        {
                            var paths = (clip.Text ?? "").Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                            writeOk = _listener.CopyFileDrop(paths);
                        }
                        else
                        {
                            writeOk = _listener.CopyRichText(clip.Text, clip.RichText);
                        }
                        SendRpcResponse(rpcId, new { ok = writeOk });
                        return;
                    }
                }
            }
        }
        catch
        {
        }
        SendRpcResponse(rpcId, new { ok = false });
    }

    private static bool ForceForegroundWindow(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;

        IntPtr fgHwnd = GetForegroundWindow();
        if (fgHwnd == hWnd) return true;

        uint fgThreadId = GetWindowThreadProcessId(fgHwnd, out _);
        uint targetThreadId = GetWindowThreadProcessId(hWnd, out _);
        uint currentThreadId = GetCurrentThreadId();

        bool attachedFg = false;
        bool attachedTarget = false;

        try
        {
            if (fgThreadId != targetThreadId && fgThreadId != 0)
            {
                attachedFg = AttachThreadInput(currentThreadId, fgThreadId, true);
            }
            if (targetThreadId != currentThreadId && targetThreadId != 0)
            {
                attachedTarget = AttachThreadInput(currentThreadId, targetThreadId, true);
            }

            // Release any modifier keys that might be held
            keybd_event(0x5B, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Left Win
            keybd_event(0x5C, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Right Win
            keybd_event(0x10, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Shift
            keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Alt
            keybd_event(0x11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Ctrl

            if (IsIconic(hWnd))
            {
                ShowWindow(hWnd, 9); // SW_RESTORE only when minimized
            }
            BringWindowToTop(hWnd);
            return SetForegroundWindow(hWnd);
        }
        catch
        {
            return false;
        }
        finally
        {
            if (attachedFg)
            {
                AttachThreadInput(currentThreadId, fgThreadId, false);
            }
            if (attachedTarget)
            {
                AttachThreadInput(currentThreadId, targetThreadId, false);
            }
        }
    }

    private static void SimulatePaste()
    {
        // Atomic batch: Ctrl down, V down/up, Ctrl up in one SendInput call so
        // physical keys cannot interleave. Ctrl is pressed only when the user
        // is not already holding it, and only keys we pressed are released.
        bool ctrlHeld = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
        var inputs = new List<INPUT>();
        void Key(ushort vk, bool down)
        {
            inputs.Add(new INPUT
            {
                type = INPUT_KEYBOARD,
                U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = down ? 0u : KEYEVENTF_KEYUP } }
            });
        }
        if (!ctrlHeld) Key(VK_CONTROL, true);
        Key(VK_V, true);
        Key(VK_V, false);
        if (!ctrlHeld) Key(VK_CONTROL, false);
        try
        {
            if (inputs.Count > 0)
            {
                uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>());
                if (sent == 0)
                {
                    // Fallback to keybd_event if SendInput fails for any reason
                    if (!ctrlHeld) keybd_event((byte)VK_CONTROL, 0, 0, UIntPtr.Zero);
                    keybd_event((byte)VK_V, 0, 0, UIntPtr.Zero);
                    keybd_event((byte)VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                    if (!ctrlHeld) keybd_event((byte)VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            }
        }
        catch { }
    }

    /// <summary>H3: elevated/UAC/unfocused target — synthetic Ctrl+V is blocked
    /// by UIPI. Leave the clip on the system clipboard and tell the user to
    /// paste manually instead of failing silently.</summary>
    private void NotifyElevatedPasteFallback()
    {
        try
        {
            BeginInvoke(new Action(() =>
            {
                try { _tray.ShowNotification("DualClip", "Clip copied to clipboard. Press Ctrl+V manually in Administrator windows.", ToolTipIcon.Info); } catch { }
            }));
        }
        catch { }
    }

    private void ReturnFocusIfPinned()
    {
        if (TopMost && Visible)
        {
            Thread.Sleep(150);
            if (TopMost && Visible)
            {
                ForceForegroundWindow(Handle);
                BeginInvoke(() =>
                {
                    try { _webView?.Focus(); } catch { }
                });
            }
        }
    }

    /// <summary>Shift+Enter sequential paste: re-show DualClip (it was never
    /// hidden) and pull it back to the foreground so the next clip is one
    /// Enter away. Runs on the UI thread via BeginInvoke (called from the
    /// paste worker). ShowWindow re-captures _lastActiveHwnd from the current
    /// foreground window, preserving the paste target across pastes.</summary>
    private void RestoreWindowForSequentialPaste()
    {
        try
        {
            BeginInvoke(new Action(() =>
            {
                try
                {
                    _allowVisible = true;
                    if (!Visible) Visible = true;
                    Opacity = 1.0;
                    ForceForegroundWindow(Handle);
                    _webView?.Focus();
                }
                catch { }
                finally
                {
                    Task.Delay(400).ContinueWith(_ => _inSequentialPaste = false);
                }
            }));
        }
        catch
        {
            _inSequentialPaste = false;
        }
    }

    private void SendToast(string message)
    {
        PostEventToJs("onToast", new { message });
        try
        {
            _tray?.ShowNotification("DualClip", message, ToolTipIcon.Info);
        }
        catch
        {
        }
    }

    private void PostEventToJs(string eventName, object data)
    {
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke(new Action(() => PostEventToJs(eventName, data)));
            }
            catch
            {
            }
            return;
        }

        try
        {
            var json = JsonSerializer.Serialize(new { @event = eventName, data = data });
            if (_webView?.CoreWebView2 == null)
            {
                lock (_pendingEventsLock)
                {
                    if (_pendingEventsQueue.Count >= 50)
                    {
                        _pendingEventsQueue.RemoveAt(0); // Bounded drop-oldest FIFO
                    }
                    _pendingEventsQueue.Add(json);
                }
                return;
            }
            _webView.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch
        {
        }
    }

    private void FlushPendingEventsToJs()
    {
        if (InvokeRequired)
        {
            try { BeginInvoke(new Action(FlushPendingEventsToJs)); } catch { }
            return;
        }

        if (_webView?.CoreWebView2 == null) return;

        List<string> toDrain;
        lock (_pendingEventsLock)
        {
            if (_pendingEventsQueue.Count == 0) return;
            toDrain = new List<string>(_pendingEventsQueue);
            _pendingEventsQueue.Clear();
        }

        foreach (var json in toDrain)
        {
            try
            {
                _webView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch
            {
            }
        }
    }

    private void SendRpcResponse(long rpcId, object result)
    {
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke(new Action(() => SendRpcResponse(rpcId, result)));
            }
            catch { }
            return;
        }

        try
        {
            if (_webView?.CoreWebView2 == null) return;
            var json = JsonSerializer.Serialize(new
            {
                __rpc_response_id = rpcId,
                result = result
            });
            _webView.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch { }
    }

    private static string SafeTruncateString(string text, int maxLength)
    {
        if (string.IsNullOrEmpty(text) || text.Length <= maxLength) return text;
        int len = maxLength;
        if (char.IsHighSurrogate(text[len - 1]))
        {
            len--; // Don't split a surrogate pair
        }
        return text.Substring(0, len);
    }

    private static object FormatClipForJs(ClipItem c, bool truncateLargeText = false)
    {
        string col = !string.IsNullOrEmpty(c.Collection) ? c.Collection : "all";

        string fullImageUrl = "";
        if (c.IsImage && !string.IsNullOrEmpty(c.ImagePath))
        {
            fullImageUrl = $"https://images.example/{Uri.EscapeDataString(Path.GetFileName(c.ImagePath))}";
        }

        string? appIcon = AppIconStore.GetCachedOrQueueExtract(c.Process);

        var nowLocal = DateTime.Now;
        var lastUsedLocal = c.LastUsedAt.ToLocalTime();
        var lastUsedUtc = c.LastUsedAt.ToUniversalTime();
        var diffDays = (nowLocal.Date - lastUsedLocal.Date).TotalDays;
        string timeGroup = diffDays <= 0 ? "today" : (diffDays <= 1 ? "yesterday" : "older");

        string ageLabel;
        var elapsed = DateTime.UtcNow - lastUsedUtc;
        if (elapsed.TotalSeconds < 60) ageLabel = "Just now";
        else if (elapsed.TotalMinutes < 60) ageLabel = $"{(int)elapsed.TotalMinutes}m ago";
        else if (elapsed.TotalHours < 24 && diffDays <= 0) ageLabel = $"{(int)elapsed.TotalHours}h ago";
        else if (diffDays <= 1) ageLabel = "Yesterday";
        else if (diffDays < 7) ageLabel = $"{(int)diffDays}d ago";
        else ageLabel = lastUsedLocal.ToString("MMM d");

        return new
        {
            id = c.Id,
            title = string.IsNullOrEmpty(c.Title) ? (c.IsImage ? "Screenshot" : c.Process) : c.Title,
            is_image = c.IsImage,
            image_data = !string.IsNullOrEmpty(fullImageUrl) ? fullImageUrl : c.ThumbnailData,
            thumbnail_data = c.ThumbnailData,
            img_dims = c.ImgDims,
            img_size = c.ImgSize,
            text_content = truncateLargeText && c.Text.Length > 4000 ? SafeTruncateString(c.Text, 4000) : c.Text,
            preview = c.Preview,
            char_count = c.Text.Length,
            created_at = c.CreatedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"),
            last_used_at = lastUsedUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            time_group = timeGroup,
            age_label = ageLabel,
            pinned = c.Pinned ? 1 : 0,
            favorite = c.Favorite ? 1 : 0,
            nickname = c.Nickname,
            custom_title = c.CustomTitle ?? "",
            tags = c.Tags ?? new List<string>(),
            track = c.Track,
            use_count = c.UseCount,
            sort_rank = c.SortRank,
            image_path = c.ImagePath,
            collection = col,
            src_process = c.Process,
            app_icon = appIcon,
            meta_json = JsonSerializer.Serialize(new { src_process = c.Process, src_title = c.Title, app_icon = appIcon })
        };
    }

    private static bool TryGetClipId(JsonElement elem, out long id)
    {
        id = 0;
        if (elem.ValueKind == JsonValueKind.Number)
        {
            return elem.TryGetInt64(out id);
        }
        if (elem.ValueKind == JsonValueKind.String)
        {
            return long.TryParse(elem.GetString(), out id);
        }
        return false;
    }

    private static bool TryGetBool(JsonElement elem, out bool value)
    {
        value = false;
        if (elem.ValueKind == JsonValueKind.True) { value = true; return true; }
        if (elem.ValueKind == JsonValueKind.False) { value = false; return true; }
        if (elem.ValueKind == JsonValueKind.String)
        {
            var str = elem.GetString();
            if (string.Equals(str, "true", StringComparison.OrdinalIgnoreCase) || str == "1")
            {
                value = true;
                return true;
            }
            if (string.Equals(str, "false", StringComparison.OrdinalIgnoreCase) || str == "0")
            {
                value = false;
                return true;
            }
        }
        if (elem.ValueKind == JsonValueKind.Number)
        {
            if (elem.TryGetInt64(out var num))
            {
                value = num != 0;
                return true;
            }
        }
        return false;
    }

    private static bool TryGetInt(JsonElement elem, out int value)
    {
        value = 0;
        if (elem.ValueKind == JsonValueKind.Number)
        {
            return elem.TryGetInt32(out value);
        }
        if (elem.ValueKind == JsonValueKind.String)
        {
            return int.TryParse(elem.GetString(), out value);
        }
        return false;
    }

    private static bool IsGifBytes(byte[] bytes)
    {
        if (bytes == null || bytes.Length < 6) return false;
        return bytes[0] == (byte)'G' && bytes[1] == (byte)'I' && bytes[2] == (byte)'F' &&
               bytes[3] == (byte)'8' && (bytes[4] == (byte)'7' || bytes[4] == (byte)'9') && bytes[5] == (byte)'a';
    }

    private static bool ValidatePngHeader(byte[] headerBytes, out int width, out int height)
    {
        width = 0;
        height = 0;
        if (headerBytes == null || headerBytes.Length < 24) return false;

        // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
        if (headerBytes[0] != 0x89 || headerBytes[1] != 0x50 || headerBytes[2] != 0x4E || headerBytes[3] != 0x47 ||
            headerBytes[4] != 0x0D || headerBytes[5] != 0x0A || headerBytes[6] != 0x1A || headerBytes[7] != 0x0A)
        {
            return false;
        }

        // Check IHDR chunk type at index 12..15: 'I', 'H', 'D', 'R'
        if (headerBytes[12] != (byte)'I' || headerBytes[13] != (byte)'H' || headerBytes[14] != (byte)'D' || headerBytes[15] != (byte)'R')
        {
            return false;
        }

        // Width (big-endian 32-bit int) at 16..19
        width = (headerBytes[16] << 24) | (headerBytes[17] << 16) | (headerBytes[18] << 8) | headerBytes[19];
        // Height (big-endian 32-bit int) at 20..23
        height = (headerBytes[20] << 24) | (headerBytes[21] << 16) | (headerBytes[22] << 8) | headerBytes[23];

        if (width <= 0 || height <= 0) return false;
        if (width > 8192 || height > 8192) return false;
        if ((long)width * height > 33554432) return false; // 32 MP limit

        return true;
    }

    private static ClipItem ParseClipFromJsonElement(JsonElement el)
    {
        var item = new ClipItem();
        if (el.TryGetProperty("id", out var pId) && TryGetClipId(pId, out var idVal)) item.Id = idVal;
        if (el.TryGetProperty("text_content", out var pText) && pText.ValueKind == JsonValueKind.String) item.Text = pText.GetString() ?? "";
        else if (el.TryGetProperty("text", out var pText2) && pText2.ValueKind == JsonValueKind.String) item.Text = pText2.GetString() ?? "";

        if (el.TryGetProperty("preview", out var pPrev) && pPrev.ValueKind == JsonValueKind.String) item.Preview = pPrev.GetString() ?? "";
        if (el.TryGetProperty("is_image", out var pIsImg) && TryGetBool(pIsImg, out var isImgVal)) item.IsImage = isImgVal;
        if (el.TryGetProperty("image_path", out var pImgPath) && pImgPath.ValueKind == JsonValueKind.String) item.ImagePath = pImgPath.GetString() ?? "";
        if (el.TryGetProperty("thumbnail_data", out var pThumb) && pThumb.ValueKind == JsonValueKind.String) item.ThumbnailData = pThumb.GetString() ?? "";
        if (el.TryGetProperty("img_dims", out var pDims) && pDims.ValueKind == JsonValueKind.String) item.ImgDims = pDims.GetString() ?? "";
        if (el.TryGetProperty("img_size", out var pSize) && pSize.ValueKind == JsonValueKind.String) item.ImgSize = pSize.GetString() ?? "";
        if (el.TryGetProperty("src_process", out var pProc) && pProc.ValueKind == JsonValueKind.String) item.Process = pProc.GetString() ?? "";
        else if (el.TryGetProperty("process", out var pProc2) && pProc2.ValueKind == JsonValueKind.String) item.Process = pProc2.GetString() ?? "";
        if (el.TryGetProperty("src_title", out var pTitle) && pTitle.ValueKind == JsonValueKind.String) item.Title = pTitle.GetString() ?? "";
        else if (el.TryGetProperty("title", out var pTitle2) && pTitle2.ValueKind == JsonValueKind.String) item.Title = pTitle2.GetString() ?? "";
        if (el.TryGetProperty("pinned", out var pPin) && TryGetBool(pPin, out var pinVal)) item.Pinned = pinVal;
        if (el.TryGetProperty("favorite", out var pFav) && TryGetBool(pFav, out var favVal)) item.Favorite = favVal;
        if (el.TryGetProperty("nickname", out var pNick) && pNick.ValueKind == JsonValueKind.String) item.Nickname = pNick.GetString() ?? "";
        if (el.TryGetProperty("custom_title", out var pCustom) && pCustom.ValueKind == JsonValueKind.String) item.CustomTitle = pCustom.GetString();
        if (el.TryGetProperty("rich_text", out var pRich) && pRich.ValueKind == JsonValueKind.String) item.RichText = pRich.GetString();
        if (el.TryGetProperty("collection", out var pCol) && pCol.ValueKind == JsonValueKind.String) item.Collection = pCol.GetString() ?? "all";
        if (el.TryGetProperty("track", out var pTrack) && pTrack.ValueKind == JsonValueKind.String) item.Track = pTrack.GetString() ?? "manual";
        if (el.TryGetProperty("use_count", out var pCount) && TryGetInt(pCount, out var countVal)) item.UseCount = countVal;
        if (el.TryGetProperty("sort_rank", out var pRank) && TryGetClipId(pRank, out var rankVal)) item.SortRank = rankVal;
        if (el.TryGetProperty("created_at", out var pCreated))
        {
            if (pCreated.ValueKind == JsonValueKind.String && DateTime.TryParse(pCreated.GetString(), out var dt)) item.CreatedAt = dt.ToUniversalTime();
            else if (pCreated.ValueKind == JsonValueKind.Number) item.CreatedAt = DateTimeOffset.FromUnixTimeSeconds(pCreated.GetInt64()).UtcDateTime;
        }
        if (el.TryGetProperty("last_used_at", out var pUsed))
        {
            if (pUsed.ValueKind == JsonValueKind.String && DateTime.TryParse(pUsed.GetString(), out var dt)) item.LastUsedAt = dt.ToUniversalTime();
            else if (pUsed.ValueKind == JsonValueKind.Number) item.LastUsedAt = DateTimeOffset.FromUnixTimeSeconds(pUsed.GetInt64()).UtcDateTime;
        }
        if (el.TryGetProperty("tags", out var pTags) && pTags.ValueKind == JsonValueKind.Array)
        {
            foreach (var t in pTags.EnumerateArray())
            {
                var s = t.GetString();
                if (!string.IsNullOrWhiteSpace(s)) item.Tags.Add(s.Trim());
            }
        }
        if (el.TryGetProperty("image", out var pImgObj) && pImgObj.ValueKind == JsonValueKind.Object)
        {
            item.IsImage = true;
            string imgMedia = "";
            if (pImgObj.TryGetProperty("media_type", out var pMedia) && pMedia.ValueKind == JsonValueKind.String)
            {
                imgMedia = pMedia.GetString() ?? "";
            }
            if (pImgObj.TryGetProperty("file", out var pFile) && pFile.ValueKind == JsonValueKind.String)
            {
                item.ImagePath = pFile.GetString() ?? "";
            }
            if (pImgObj.TryGetProperty("sha256", out var pSha) && pSha.ValueKind == JsonValueKind.String)
            {
                if (string.IsNullOrEmpty(item.ImagePath))
                {
                    // D2: keep the real container — v1 packages only ever had .png.
                    string shaExt = imgMedia.Contains("gif", StringComparison.OrdinalIgnoreCase) ? "gif" : "png";
                    item.ImagePath = $"images/{pSha.GetString()}.{shaExt}";
                }
            }
            if (pImgObj.TryGetProperty("width", out var pW) && pImgObj.TryGetProperty("height", out var pH))
            {
                if (TryGetInt(pW, out int w) && TryGetInt(pH, out int h))
                {
                    item.ImgDims = $"{w} × {h}";
                }
            }
            if (pImgObj.TryGetProperty("byte_size", out var pBytes) && TryGetInt(pBytes, out int bCount))
            {
                string sizeKind = imgMedia.Contains("gif", StringComparison.OrdinalIgnoreCase) ? "GIF" : "PNG";
                if (bCount < 1024 * 1024)
                    item.ImgSize = $"{Math.Max(1, bCount / 1024)} KB {sizeKind}";
                else
                    item.ImgSize = $"{((double)bCount / (1024 * 1024)):F1} MB {sizeKind}";
            }
        }
        return item;
    }

    private void HandleBrowseApplication(long rpcId)
    {
        try
        {
            using var dlg = new OpenFileDialog
            {
                Filter = "Executable Files (*.exe)|*.exe|All Files (*.*)|*.*",
                Title = "Select Application"
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                var exe = Path.GetFileName(dlg.FileName);
                var name = Path.GetFileNameWithoutExtension(dlg.FileName);
                SendRpcResponse(rpcId, new { ok = true, path = dlg.FileName, process = exe, name = name });
            }
            else
            {
                SendRpcResponse(rpcId, new { ok = false });
            }
        }
        catch (Exception ex)
        {
            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
        }
    }

    private void HandleExportClips(long rpcId, string scopeJson)
    {
        try
        {
            bool all = true;
            bool unorganized = false;
            var collections = new List<string>();
            var colPinned = new List<string>();
            var colStarred = new List<string>();
            bool pinnedOnly = false;
            bool starredOnly = false;
            bool includeImages = false;
            bool includeText = true;

            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(scopeJson) ? "{}" : scopeJson);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object)
                {
                    if (root.TryGetProperty("all", out var allProp) && (allProp.ValueKind == JsonValueKind.True || allProp.ValueKind == JsonValueKind.False))
                        all = allProp.GetBoolean();
                    if (root.TryGetProperty("unorganized", out var unorgProp) && (unorgProp.ValueKind == JsonValueKind.True || unorgProp.ValueKind == JsonValueKind.False))
                        unorganized = unorgProp.GetBoolean();
                    if (root.TryGetProperty("collections", out var colsProp) && colsProp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var c in colsProp.EnumerateArray())
                        {
                            var s = c.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) collections.Add(s.Trim());
                        }
                    }
                    foreach (var key in new[] { "colPinned", "col_pinned" })
                    {
                        if (root.TryGetProperty(key, out var cpProp) && cpProp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var c in cpProp.EnumerateArray())
                            {
                                var s = c.GetString();
                                if (!string.IsNullOrWhiteSpace(s)) colPinned.Add(s.Trim());
                            }
                        }
                    }
                    foreach (var key in new[] { "colStarred", "col_starred" })
                    {
                        if (root.TryGetProperty(key, out var csProp) && csProp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var c in csProp.EnumerateArray())
                            {
                                var s = c.GetString();
                                if (!string.IsNullOrWhiteSpace(s)) colStarred.Add(s.Trim());
                            }
                        }
                    }
                    if (root.TryGetProperty("pinnedOnly", out var pinProp) && pinProp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        pinnedOnly = pinProp.GetBoolean();
                    if (root.TryGetProperty("starredOnly", out var starProp) && starProp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        starredOnly = starProp.GetBoolean();
                    if (root.TryGetProperty("includeImages", out var imgProp) && imgProp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        includeImages = imgProp.GetBoolean();
                    if (root.TryGetProperty("includeText", out var txtProp) && txtProp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        includeText = txtProp.GetBoolean();
                }
            }
            catch { }

            using var dlg = new SaveFileDialog
            {
                Filter = "DualClip Package (*.dualclip)|*.dualclip|ZIP Archive (*.zip)|*.zip|All Files (*.*)|*.*",
                FileName = "dualclip-export.dualclip",
                DefaultExt = "dualclip",
                AddExtension = true,
                Title = "Export Clips"
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                string targetPath = dlg.FileName;
                bool scopeAll = all;
                bool scopeUnorg = unorganized;
                var scopeCols = new List<string>(collections);
                var scopeColPinned = new List<string>(colPinned);
                var scopeColStarred = new List<string>(colStarred);
                bool scopePinned = pinnedOnly;
                bool scopeStarred = starredOnly;
                bool scopeIncludeImages = includeImages;
                bool scopeIncludeText = includeText;

                Task.Run(() =>
                {
                    string tmpPath = targetPath + ".tmp";
                    try
                    {
                        var clips = _db.GetClipsForExport(scopeAll, scopeUnorg, scopeCols, scopePinned, scopeStarred, scopeIncludeText, scopeIncludeImages, scopeColPinned, scopeColStarred);
                        if (clips.Count == 0)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = "No clips match the selected export criteria" });
                            return;
                        }

                        // .dualclip / .zip package export
                        try { if (File.Exists(tmpPath)) File.Delete(tmpPath); } catch { }

                        var dir = Path.GetDirectoryName(targetPath);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                        var collectionsList = _db.GetCollections();
                        int exportedImages = 0;
                        int missingImages = 0;
                        // D2: keyed by sha; carries the real container so GIFs survive the round-trip.
                        var imagesToExport = new Dictionary<string, (byte[] bytes, string ext, string mediaType)>(StringComparer.OrdinalIgnoreCase);

                        using (var zipFs = new FileStream(tmpPath, FileMode.Create, FileAccess.ReadWrite, FileShare.None, 65536, useAsync: false))
                        using (var zip = new ZipArchive(zipFs, ZipArchiveMode.Create, leaveOpen: false))
                        {
                            // 1. Write collections.json
                            var colEntry = zip.CreateEntry("collections.json", CompressionLevel.Optimal);
                            using (var colStream = colEntry.Open())
                            using (var writer = new Utf8JsonWriter(colStream, new JsonWriterOptions { Indented = true }))
                            {
                                writer.WriteStartArray();
                                foreach (var c in collectionsList)
                                {
                                    writer.WriteStartObject();
                                    writer.WriteString("id", c.Id);
                                    writer.WriteString("name", c.Name);
                                    writer.WriteNumber("sort_order", c.SortOrder);
                                    writer.WriteBoolean("pinned", c.Pinned);
                                    // D3: nesting link — absent in v1 packages (import preserves live parents then).
                                    if (string.IsNullOrWhiteSpace(c.ParentId)) writer.WriteNull("parent_id");
                                    else writer.WriteString("parent_id", c.ParentId);
                                    writer.WriteEndObject();
                                }
                                writer.WriteEndArray();
                            }

                            // 2. Write clips.json and stage image payloads (imagesToExport declared above)
                            var clipEntry = zip.CreateEntry("clips.json", CompressionLevel.Optimal);
                            using (var clipStream = clipEntry.Open())
                            using (var writer = new Utf8JsonWriter(clipStream, new JsonWriterOptions { Indented = true }))
                            {
                                writer.WriteStartArray();
                                foreach (var c in clips)
                                {
                                    writer.WriteStartObject();
                                    writer.WriteString("text_content", c.Text);
                                    writer.WriteString("preview", c.Preview);

                                    string clipHash = "";
                                    if (c.IsImage)
                                    {
                                        clipHash = Path.GetFileNameWithoutExtension(c.ImagePath).ToLowerInvariant();
                                    }
                                    else
                                    {
                                        clipHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(c.Text)));
                                    }
                                    writer.WriteString("content_hash", clipHash);
                                    writer.WriteString("collection", c.Collection);
                                    writer.WriteBoolean("pinned", c.Pinned);
                                    writer.WriteBoolean("favorite", c.Favorite);
                                    writer.WriteString("nickname", c.Nickname);
                                    writer.WriteString("track", c.Track);
                                    writer.WriteString("src_process", c.Process);
                                    writer.WriteString("src_title", c.Title);
                                    writer.WriteNumber("created_at", new DateTimeOffset(c.CreatedAt).ToUnixTimeSeconds());
                                    writer.WriteNumber("last_used_at", new DateTimeOffset(c.LastUsedAt).ToUnixTimeSeconds());
                                    writer.WriteNumber("use_count", c.UseCount);
                                    writer.WriteNumber("sort_rank", c.SortRank);
                                    // D1/D4: rename + rich text — null when absent (v1 readers ignore them).
                                    if (string.IsNullOrWhiteSpace(c.CustomTitle)) writer.WriteNull("custom_title");
                                    else writer.WriteString("custom_title", c.CustomTitle);
                                    if (string.IsNullOrWhiteSpace(c.RichText)) writer.WriteNull("rich_text");
                                    else writer.WriteString("rich_text", c.RichText);

                                    writer.WriteStartArray("tags");
                                    foreach (var t in c.Tags)
                                    {
                                        writer.WriteStringValue(t);
                                    }
                                    writer.WriteEndArray();

                                    writer.WriteBoolean("is_image", c.IsImage);

                                    if (c.IsImage)
                                    {
                                        string imgPath = c.ImagePath;
                                        if (!File.Exists(imgPath))
                                        {
                                            var candidate = Path.Combine(PathHelper.GetImagesFolder(), Path.GetFileName(imgPath));
                                            if (File.Exists(candidate)) imgPath = candidate;
                                        }

                                        if (File.Exists(imgPath))
                                        {
                                            var fileBytes = File.ReadAllBytes(imgPath);
                                            var fileSha = Convert.ToHexString(SHA256.HashData(fileBytes)).ToLowerInvariant();

                                            // D2: preserve the real container — GIF bytes relabeled .png
                                            // were skipped on import and the animation was lost for good.
                                            bool isGif = IsGifBytes(fileBytes) || imgPath.EndsWith(".gif", StringComparison.OrdinalIgnoreCase);
                                            string imgExt = isGif ? "gif" : "png";
                                            string imgMedia = isGif ? "image/gif" : "image/png";

                                            int w = 0, h = 0;
                                            if (isGif || !ValidatePngHeader(fileBytes, out w, out h))
                                            {
                                                try
                                                {
                                                    using var ms = new MemoryStream(fileBytes);
                                                    using var img = Image.FromStream(ms);
                                                    w = img.Width;
                                                    h = img.Height;
                                                }
                                                catch { }
                                            }

                                            writer.WriteStartObject("image");
                                            writer.WriteString("file", $"images/{fileSha}.{imgExt}");
                                            writer.WriteNumber("width", w);
                                            writer.WriteNumber("height", h);
                                            writer.WriteNumber("byte_size", fileBytes.Length);
                                            writer.WriteString("media_type", imgMedia);
                                            writer.WriteString("sha256", fileSha);
                                            writer.WriteEndObject();

                                            if (!imagesToExport.ContainsKey(fileSha))
                                            {
                                                imagesToExport[fileSha] = (fileBytes, imgExt, imgMedia);
                                            }
                                        }
                                        else
                                        {
                                            missingImages++;
                                        }
                                    }

                                    writer.WriteEndObject();
                                }
                                writer.WriteEndArray();
                            }

                            // 3. Write image entries cleanly (after clips.json entry stream is closed)
                            foreach (var kvp in imagesToExport)
                            {
                                var imgEntry = zip.CreateEntry($"images/{kvp.Key}.{kvp.Value.ext}", CompressionLevel.Fastest);
                                using (var entryStream = imgEntry.Open())
                                {
                                    entryStream.Write(kvp.Value.bytes, 0, kvp.Value.bytes.Length);
                                }
                                exportedImages++;
                            }

                            // 3. Write manifest.json
                            var manifestEntry = zip.CreateEntry("manifest.json", CompressionLevel.Optimal);
                            using (var manStream = manifestEntry.Open())
                            using (var writer = new Utf8JsonWriter(manStream, new JsonWriterOptions { Indented = true }))
                            {
                                writer.WriteStartObject();
                                writer.WriteString("format", "com.dualclip.export");
                                writer.WriteNumber("format_version", 2);
                                writer.WriteNumber("minimum_reader_version", 1);
                                writer.WriteString("app_version", "1.0.0");
                                writer.WriteNumber("created_at", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
                                writer.WriteNumber("clip_count", clips.Count);
                                writer.WriteNumber("image_count", exportedImages);
                                writer.WriteNumber("collection_count", collectionsList.Count);
                                writer.WriteString("hash_algorithm", "sha256");
                                writer.WriteString("content_encoding", "utf-8");
                                writer.WriteEndObject();
                            }
                        }

                        // Safe move to destination with retry backoff: overwrite in place without premature file deletion
                        bool moveOk = false;
                        for (int attempt = 0; attempt < 3; attempt++)
                        {
                            try
                            {
                                File.Move(tmpPath, targetPath, overwrite: true);
                                moveOk = true;
                                break;
                            }
                            catch
                            {
                                if (attempt < 2) Thread.Sleep(100 * (attempt + 1));
                            }
                        }

                        if (!moveOk)
                        {
                            try { if (File.Exists(tmpPath)) File.Delete(tmpPath); } catch { }
                            SendRpcResponse(rpcId, new { ok = false, error = "Failed to finalize export file (locked by another process)" });
                            return;
                        }

                        SendRpcResponse(rpcId, new
                        {
                            ok = true,
                            path = targetPath,
                            count = clips.Count,
                            image_count = exportedImages,
                            missing_images = missingImages
                        });
                    }
                    catch (Exception ex)
                    {
                        try { if (File.Exists(tmpPath)) File.Delete(tmpPath); } catch { }
                        SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
                    }
                });
                return;
            }
            SendRpcResponse(rpcId, new { ok = false, canceled = true });
        }
        catch (Exception ex)
        {
            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
        }
    }

    private void HandleImportIntoCollection(long rpcId, string collection)
    {
        try
        {
            using var dlg = new OpenFileDialog
            {
                Filter = "All Supported (*.dualclip;*.zip)|*.dualclip;*.zip|DualClip Package (*.dualclip)|*.dualclip|ZIP Archive (*.zip)|*.zip|All Files (*.*)|*.*",
                Title = "Import Clips"
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                string filePath = dlg.FileName;
                Task.Run(() => ExecutePackageImport(filePath, collection, rpcId));
                return;
            }
            SendRpcResponse(rpcId, new { ok = false, canceled = true });
        }
        catch (Exception ex)
        {
            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
        }
    }

    public static bool ValidateArchiveMagic(byte[] magic)
    {
        if (magic == null || magic.Length < 4) return false;
        return magic[0] == 0x50 && magic[1] == 0x4B && ((magic[2] == 0x03 && magic[3] == 0x04) || (magic[2] == 0x05 && magic[3] == 0x06));
    }

    public static bool IsSupportedArchiveExtension(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext == ".dualclip" || ext == ".zip";
    }

    public static bool TryGetSingleArchiveDropFile(DragEventArgs e, out string filePath)
    {
        filePath = "";
        if (e.Data == null || !e.Data.GetDataPresent(DataFormats.FileDrop))
            return false;

        if (e.Data.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0)
        {
            foreach (var f in files)
            {
                if (IsSupportedArchiveExtension(f))
                {
                    filePath = f;
                    return true;
                }
            }
        }
        return false;
    }

    private void HandleFormDragEnter(object? sender, DragEventArgs e)
    {
        try
        {
            if (TryGetSingleArchiveDropFile(e, out _))
            {
                e.Effect = DragDropEffects.Copy;
                PostEventToJs("onDropZoneShow", new { });
            }
            else
            {
                e.Effect = DragDropEffects.None;
            }
        }
        catch
        {
            e.Effect = DragDropEffects.None;
        }
    }

    private void HandleFormDragOver(object? sender, DragEventArgs e)
    {
        try
        {
            if (TryGetSingleArchiveDropFile(e, out _))
            {
                e.Effect = DragDropEffects.Copy;
            }
            else
            {
                e.Effect = DragDropEffects.None;
            }
        }
        catch
        {
            e.Effect = DragDropEffects.None;
        }
    }

    private void HandleFormDragLeave(object? sender, EventArgs e)
    {
        try
        {
            PostEventToJs("onDropZoneHide", new { });
        }
        catch { }
    }

    private void HandleFormDragDrop(object? sender, DragEventArgs e)
    {
        try
        {
            PostEventToJs("onDropZoneHide", new { });
            if (TryGetSingleArchiveDropFile(e, out string filePath))
            {
                Task.Run(() => ExecutePackageImport(filePath, "all", 0));
            }
            else
            {
                SendToast("Dropped file is not a supported .dualclip or .zip archive");
            }
        }
        catch (Exception ex)
        {
            SendToast($"Import failed: {ex.Message}");
        }
    }

    public static byte[]? ReadBoundedEntryStream(ZipArchiveEntry entry, long maxBytes)
    {
        if (entry == null) return null;
        using var stream = entry.Open();
        using var ms = new MemoryStream();
        byte[] buffer = new byte[8192];
        long totalRead = 0;
        int bytesRead;
        while ((bytesRead = stream.Read(buffer, 0, buffer.Length)) > 0)
        {
            totalRead += bytesRead;
            if (totalRead > maxBytes) return null;
            ms.Write(buffer, 0, bytesRead);
        }
        return ms.ToArray();
    }

    public static byte[]? DecodePackageBase64(string base64, int maxBytes = 64 * 1024 * 1024)
    {
        if (string.IsNullOrWhiteSpace(base64)) return null;
        try
        {
            byte[] bytes = Convert.FromBase64String(base64);
            if (bytes.Length > maxBytes) return null;
            return bytes;
        }
        catch
        {
            return null;
        }
    }

    private void HandleImportPackageBase64(long rpcId, string fileName, string base64Data)
    {
        string? stagingDir = null;
        try
        {
            byte[]? bytes = DecodePackageBase64(base64Data);
            if (bytes == null || bytes.Length == 0)
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Invalid or oversized Base64 archive payload" });
                else SendToast("Import failed: invalid or oversized archive data");
                return;
            }

            stagingDir = Path.Combine(PathHelper.GetTempFolder(), "b64import_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stagingDir);
            string safeName = Path.GetFileName(fileName);
            if (string.IsNullOrWhiteSpace(safeName) || (!safeName.EndsWith(".dualclip", StringComparison.OrdinalIgnoreCase) && !safeName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)))
            {
                safeName = "import.dualclip";
            }
            string tempFilePath = Path.Combine(stagingDir, safeName);
            File.WriteAllBytes(tempFilePath, bytes);

            ExecutePackageImport(tempFilePath, "all", rpcId);
        }
        catch (Exception ex)
        {
            if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
            else SendToast($"Import failed: {ex.Message}");
        }
        finally
        {
            try
            {
                if (stagingDir != null && Directory.Exists(stagingDir))
                {
                    Directory.Delete(stagingDir, true);
                }
            }
            catch { }
        }
    }

    private void ExecutePackageImport(string filePath, string collection, long rpcId)
    {
        string stagingDir = Path.Combine(PathHelper.GetTempFolder(), "import_" + Guid.NewGuid().ToString("N"));
        try
        {
            var fi = new FileInfo(filePath);
            if (!fi.Exists)
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "File not found" });
                else SendToast("Import failed: File not found");
                return;
            }

            // Max file size 512 MB
            if (fi.Length > 512 * 1024 * 1024)
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Archive exceeds maximum file size limit (512 MB)" });
                else SendToast("Import failed: Archive exceeds maximum size limit (512 MB)");
                return;
            }

            // Sniff file format: check for ZIP magic bytes PK\x03\x04
            byte[] magic = new byte[4];
            using (var fs = File.OpenRead(filePath))
            {
                int read = fs.Read(magic, 0, 4);
                if (read < 4)
                {
                    if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Invalid or truncated file" });
                    else SendToast("Import failed: Invalid or truncated file");
                    return;
                }
            }

            if (!ValidateArchiveMagic(magic))
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Unsupported file format: import a .dualclip or .zip package" });
                else SendToast("Import failed: Unsupported file format (expected .dualclip or .zip)");
                return;
            }

            // ZIP / .dualclip package path
            Directory.CreateDirectory(stagingDir);

            using var archive = ZipFile.OpenRead(filePath);

            // 1. Anti-bomb: entry count limit (20,000)
            if (archive.Entries.Count > 20000)
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Archive contains too many entries (max 20,000)" });
                else SendToast("Import failed: Archive contains too many entries (max 20,000)");
                return;
            }

            // 2. Anti-exploit: duplicate entry detection
            var seenEntryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long totalUncompressedSize = 0;
            foreach (var entry in archive.Entries)
            {
                if (!seenEntryNames.Add(entry.FullName))
                {
                    if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = $"Archive contains duplicate entry: {entry.FullName}" });
                    else SendToast("Import failed: Archive contains duplicate entries");
                    return;
                }
                totalUncompressedSize += entry.Length;
                if (totalUncompressedSize > 1024L * 1024 * 1024) // 1 GB uncompressed limit
                {
                    if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Archive total uncompressed content exceeds 1 GB limit" });
                    else SendToast("Import failed: Uncompressed content exceeds 1 GB limit");
                    return;
                }
            }

            // 3. Manifest validation
            var manifestEntry = archive.GetEntry("manifest.json");
            if (manifestEntry != null)
            {
                byte[]? manifestBytes = ReadBoundedEntryStream(manifestEntry, 64 * 1024 * 1024);
                if (manifestBytes == null)
                {
                    if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "manifest.json exceeds size limit" });
                    else SendToast("Import failed: manifest.json exceeds size limit");
                    return;
                }
                using var mDoc = JsonDocument.Parse(manifestBytes);
                if (mDoc.RootElement.TryGetProperty("minimum_reader_version", out var mMinVer) && mMinVer.TryGetInt32(out int minVer) && minVer > 1)
                {
                    if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = $"Unsupported archive format version (requires reader v{minVer})" });
                    else SendToast($"Import failed: Unsupported archive format version (requires reader v{minVer})");
                    return;
                }
            }

            // Collection ids arriving inside a package are untrusted. SaveCollection refuses ids
            // that collide with a built-in scope (all/pins/favorites/most_used/transcriptions/voice),
            // which would silently drop the folder and orphan its clips. Those ids are remapped to
            // a fresh generated id first, and anything pointing at the old id — a child folder's
            // parent_id, a clip's collection — is repointed at the new one.
            // Folder *names* are never restricted: a user may name a folder anything they like,
            // including "voice" or "transcriptions". Only the internal id is protected.
            var collectionIdRemap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            // 4. Import collections.json (if present)
            // Import folder-save failures are collected, not swallowed (code-quality audit).
            var failedCollections = new List<string>();
            var colEntry = archive.GetEntry("collections.json");
            if (colEntry != null)
            {
                try
                {
                    byte[]? colBytes = ReadBoundedEntryStream(colEntry, 64 * 1024 * 1024);
                    if (colBytes != null)
                    {
                        // D5: v1 packages carry no parent_id. Nulling the parent for those
                        // would un-nest live folders — preserve it instead.
                        var liveParents = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                        try
                        {
                            foreach (var d in _db.GetCollections())
                            {
                                if (!string.IsNullOrWhiteSpace(d.Id) && !liveParents.ContainsKey(d.Id))
                                    liveParents[d.Id] = d.ParentId;
                            }
                        }
                        catch { }
                        using var colDoc = JsonDocument.Parse(colBytes);
                        if (colDoc.RootElement.ValueKind == JsonValueKind.Array)
                        {
                            // Pass 1 — decide every remap up front, so a child folder is never written
                            // before the remapped id of its own parent is known.
                            foreach (var cElem in colDoc.RootElement.EnumerateArray())
                            {
                                string rawId = cElem.TryGetProperty("id", out var rawIdProp) ? rawIdProp.GetString() ?? "" : "";
                                if (string.IsNullOrWhiteSpace(rawId)) continue;
                                if (!DatabaseService.IsReservedSystemCollectionId(rawId)) continue;
                                if (collectionIdRemap.ContainsKey(rawId)) continue;
                                collectionIdRemap[rawId] = "col_i" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("x")
                                    + Random.Shared.Next(0x10000, 0xFFFFF).ToString("x")
                                    + collectionIdRemap.Count.ToString("x");
                            }

                            // Pass 2 — write each collection under its resolved id.
                            foreach (var cElem in colDoc.RootElement.EnumerateArray())
                            {
                                string cId = cElem.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? "" : "";
                                string cName = cElem.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? "" : "";
                                bool cPinned = cElem.TryGetProperty("pinned", out var pinProp) && pinProp.ValueKind == JsonValueKind.True;
                                int cOrder = cElem.TryGetProperty("sort_order", out var orderProp) && orderProp.TryGetInt32(out int ord) ? ord : 0;
                                string? cParent = null;
                                if (cElem.TryGetProperty("parent_id", out var parentProp))
                                {
                                    cParent = parentProp.ValueKind == JsonValueKind.String ? parentProp.GetString() : null;
                                    if (string.IsNullOrWhiteSpace(cParent)) cParent = null;
                                }
                                else if (liveParents.TryGetValue(cId, out var liveParent))
                                {
                                    cParent = liveParent;
                                }
                                if (!string.IsNullOrWhiteSpace(cId) && !string.IsNullOrWhiteSpace(cName))
                                {
                                    string finalId = collectionIdRemap.TryGetValue(cId, out var mappedSelf) ? mappedSelf : cId;
                                    if (cParent != null && collectionIdRemap.TryGetValue(cParent, out var mappedParent))
                                        cParent = mappedParent;
                                    if (!_db.SaveCollection(finalId, cName, cPinned, cOrder, cParent))
                                    {
                                        failedCollections.Add(string.IsNullOrWhiteSpace(cName) ? finalId : cName);
                                    }
                                }
                            }
                        }
                    }
                }
                catch { }
            }

            // 5. Extract and validate image entries to temporary staging folder
            var stagedImages = new Dictionary<string, (string stagedFile, string dims, string sizeStr, string thumbUri, string ext)>(StringComparer.OrdinalIgnoreCase);
            var imageRegex = new Regex(@"^images/[a-f0-9]{64}\.(png|gif)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

            foreach (var entry in archive.Entries)
            {
                if (!imageRegex.IsMatch(entry.FullName)) continue;

                // Max 15 MB per image
                if (entry.Length > 15 * 1024 * 1024) continue;

                var entryHash = Path.GetFileNameWithoutExtension(entry.FullName).ToUpperInvariant();
                var entryExt = Path.GetExtension(entry.FullName).TrimStart('.').ToLowerInvariant();
                if (entryExt != "png" && entryExt != "gif") continue;
                string stagedFile = Path.Combine(stagingDir, $"{entryHash}.{entryExt}");

                byte[] imageBytes;
                using (var entryStream = entry.Open())
                using (var ms = new MemoryStream())
                {
                    entryStream.CopyTo(ms);
                    imageBytes = ms.ToArray();
                }

                if (imageBytes.Length > 15 * 1024 * 1024) continue;

                // Verify SHA256 of extracted bytes matches the entry filename hash
                var computedHash = Convert.ToHexString(SHA256.HashData(imageBytes)).ToLowerInvariant();
                if (!string.Equals(computedHash, entryHash, StringComparison.OrdinalIgnoreCase))
                {
                    continue; // Skip corrupt/mismatched image entry
                }

                // Format check matches the container: PNG header for .png, GIF magic for .gif
                int width = 0, height = 0;
                bool validImage;
                if (entryExt == "gif")
                {
                    validImage = IsGifBytes(imageBytes);
                    if (validImage)
                    {
                        try
                        {
                            using var gifMs = new MemoryStream(imageBytes);
                            using var gifImg = Image.FromStream(gifMs);
                            width = gifImg.Width;
                            height = gifImg.Height;
                        }
                        catch { validImage = false; }
                    }
                }
                else
                {
                    validImage = ValidatePngHeader(imageBytes, out width, out height);
                }
                if (!validImage)
                {
                    continue; // Skip invalid, mismatched-container, or oversized image
                }

                File.WriteAllBytes(stagedFile, imageBytes);

                string dims = $"{width} × {height}";
                string kindLabel = entryExt == "gif" ? "GIF" : "PNG";
                string sizeStr = imageBytes.Length < 1024 * 1024
                    ? $"{Math.Max(1, imageBytes.Length / 1024)} KB {kindLabel}"
                    : $"{((double)imageBytes.Length / (1024 * 1024)):F1} MB {kindLabel}";

                string thumbUri = "";
                try
                {
                    using var ms = new MemoryStream(imageBytes);
                    using var img = Image.FromStream(ms);
                    thumbUri = ClipboardListener.GenerateThumbnailDataUri(img, 240, 160);
                }
                catch { }

                stagedImages[computedHash] = (stagedFile, dims, sizeStr, thumbUri, entryExt);
            }

            // 6. Parse clips.json
            var clipsEntry = archive.GetEntry("clips.json");
            if (clipsEntry == null)
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "Archive is missing clips.json" });
                else SendToast("Import failed: Archive is missing clips.json");
                return;
            }
            byte[]? clipsBytes = ReadBoundedEntryStream(clipsEntry, 64 * 1024 * 1024);
            if (clipsBytes == null)
            {
                if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "clips.json exceeds maximum size limit of 64MB" });
                else SendToast("Import failed: clips.json exceeds size limit");
                return;
            }

            int malformedClips = 0;
            var items = new List<ClipItem>();
            using (var clipsDoc = JsonDocument.Parse(clipsBytes))
            {
                if (clipsDoc.RootElement.ValueKind != JsonValueKind.Array)
                {
                    if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = "clips.json root must be an array" });
                    else SendToast("Import failed: clips.json root must be an array");
                    return;
                }

                foreach (var elem in clipsDoc.RootElement.EnumerateArray())
                {
                    try
                    {
                        var clip = ParseClipFromJsonElement(elem);
                        // Keep clips attached to their folder when that folder's id was remapped.
                        if (!string.IsNullOrWhiteSpace(clip.Collection)
                            && collectionIdRemap.TryGetValue(clip.Collection, out var mappedClipCol))
                        {
                            clip.Collection = mappedClipCol;
                        }
                        if (clip.IsImage)
                        {
                            string imgHash = Path.GetFileNameWithoutExtension(clip.ImagePath).ToUpperInvariant();
                            if (stagedImages.TryGetValue(imgHash, out var staged))
                            {
                                clip.ImagePath = Path.Combine(PathHelper.GetImagesFolder(), $"{imgHash}.{staged.ext}");
                                clip.ImgDims = staged.dims;
                                clip.ImgSize = staged.sizeStr;
                                clip.ThumbnailData = staged.thumbUri;
                            }
                            else
                            {
                                clip.ImagePath = ""; // Missing image binary -> skipped
                            }
                        }
                        items.Add(clip);
                    }
                    catch
                    {
                        malformedClips++;
                    }
                }
            }

            // 7. Execute SQLite transaction batch
            var (imported, deduped, skipped, skippedImages) = _db.ImportPackageBatch(items, collection);

            // 8. Post-Commit File Promotion (Step 6.5)
            var imagesDir = PathHelper.GetImagesFolder();
            foreach (var kvp in stagedImages)
            {
                try
                {
                    var destFile = Path.Combine(imagesDir, $"{kvp.Key}.{kvp.Value.ext}");
                    if (!File.Exists(destFile))
                    {
                        File.Copy(kvp.Value.stagedFile, destFile, overwrite: true);
                    }
                }
                catch { }
            }

            PostEventToJs("refreshClips", new { });
            PostEventToJs("refreshStorageStats", new { });

            if (rpcId != 0)
            {
                SendRpcResponse(rpcId, new
                {
                    ok = true,
                    path = filePath,
                    imported = imported,
                    deduped = deduped,
                    skipped = skipped,
                    skipped_images = skippedImages,
                    malformed_clips = malformedClips,
                    collection_failures = failedCollections.Count
                });
            }
            else
            {
                string msg = $"Imported {imported} new clip{(imported == 1 ? "" : "s")}";
                if (deduped > 0) msg += $" ({deduped} duplicate{(deduped == 1 ? "" : "s")})";
                if (malformedClips > 0) msg += $" ({malformedClips} malformed skipped)";
                if (failedCollections.Count > 0) msg += $" ({failedCollections.Count} folder{(failedCollections.Count == 1 ? "" : "s")} not saved: {string.Join(", ", failedCollections.Take(3))})";
                SendToast(msg);
            }
        }
        catch (Exception ex)
        {
            if (rpcId != 0) SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
            else SendToast($"Import failed: {ex.Message}");
        }
        finally
        {
            try
            {
                if (Directory.Exists(stagingDir))
                {
                    Directory.Delete(stagingDir, true);
                }
            }
            catch { }
        }
    }

    private void HandleRestoreBackupDialog(long rpcId)
    {
        try
        {
            var backupDir = _db.GetBackupDirectory();
            using var dlg = new OpenFileDialog
            {
                Filter = "DualClip Backup (*.db;*.sqlite)|*.db;*.sqlite",
                Title = "Select Backup Database to Restore",
                InitialDirectory = Directory.Exists(backupDir) ? backupDir : AppDomain.CurrentDomain.BaseDirectory
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                string targetPath = dlg.FileName;
                var ext = Path.GetExtension(targetPath);
                if (!string.Equals(ext, ".db", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(ext, ".sqlite", StringComparison.OrdinalIgnoreCase))
                {
                    SendRpcResponse(rpcId, new { ok = false, error = "invalid_extension" });
                    return;
                }

                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try
                    {
                        bool ok = _db.RestoreFromBackup(targetPath);
                        if (ok)
                        {
                            PostEventToJs("refreshClips", new { });
                        }
                        SendRpcResponse(rpcId, new { ok, path = targetPath, fileName = Path.GetFileName(targetPath), error = ok ? null : (_db.LastRestoreError ?? "restore_failed") });
                    }
                    catch (Exception ex)
                    {
                        SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
                    }
                });
            }
            else
            {
                SendRpcResponse(rpcId, new { ok = false, canceled = true });
            }
        }
        catch (Exception ex)
        {
            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
        }
    }

    private string? EnsureClipImagePath(ClipItem clip)
    {
        if (!string.IsNullOrEmpty(clip.ImagePath) && File.Exists(clip.ImagePath))
        {
            return clip.ImagePath;
        }

        if (!string.IsNullOrEmpty(clip.ThumbnailData))
        {
            try
            {
                var tempDir = PathHelper.GetDragTempFolder();
                bool isSvg = clip.ThumbnailData.StartsWith("data:image/svg+xml", StringComparison.OrdinalIgnoreCase) ||
                             (!string.IsNullOrEmpty(clip.ImagePath) && clip.ImagePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase));
                var ext = isSvg ? "svg" : "png";
                var tempPath = Path.Combine(tempDir, $"clip_{clip.Id}.{ext}");
                if (File.Exists(tempPath)) return tempPath;

                string rawBase64 = clip.ThumbnailData;
                int commaIdx = rawBase64.IndexOf(',');
                if (commaIdx >= 0) rawBase64 = rawBase64.Substring(commaIdx + 1);

                byte[] bytes = Convert.FromBase64String(rawBase64);
                File.WriteAllBytes(tempPath, bytes);
                return tempPath;
            }
            catch
            {
            }
        }
        return null;
    }

    private string? EnsureClipTextFile(ClipItem clip, string text)
    {
        try
        {
            var tempDir = PathHelper.GetDragTempFolder();
            var tempPath = Path.Combine(tempDir, $"clip_{clip.Id}.txt");
            try
            {
                File.WriteAllText(tempPath, text, System.Text.Encoding.UTF8);
            }
            catch (IOException)
            {
                // Target app may still hold the file from the previous drag; retry once after a short delay.
                System.Threading.Thread.Sleep(150);
                File.WriteAllText(tempPath, text, System.Text.Encoding.UTF8);
            }
            return tempPath;
        }
        catch
        {
            return null;
        }
    }

    private void PurgeStaleDragTempFiles()
    {
        try
        {
            var tempDir = PathHelper.GetDragTempFolder();
            if (!Directory.Exists(tempDir)) return;

            var cutoff = DateTime.UtcNow.AddDays(-7);
            foreach (var file in Directory.EnumerateFiles(tempDir))
            {
                try
                {
                    if (File.GetLastWriteTimeUtc(file) < cutoff)
                    {
                        File.Delete(file); // skips in-use files by throwing; caught below
                    }
                }
                catch { /* file locked by an active drag/copy — keep it */ }
            }
        }
        catch
        {
        }
    }
}
