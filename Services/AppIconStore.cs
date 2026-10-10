using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace DualClip.Services;

public static class AppIconStore
{
    private static readonly ConcurrentDictionary<string, string?> _memCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, byte> _pendingExtractions = new(StringComparer.OrdinalIgnoreCase);
    private static readonly byte[] PngMagic = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

    public static string? GetCachedOrQueueExtract(string? processName, string? fullPath = null)
    {
        if (string.IsNullOrWhiteSpace(processName)) return null;
        var key = SanitizeKey(processName);
        if (string.IsNullOrEmpty(key)) return null;

        // 1. Memory Cache Hit
        if (_memCache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        // 2. Disk Cache Hit
        try
        {
            var iconDir = PathHelper.GetIconCacheFolder();
            var filePath = Path.Combine(iconDir, $"{key}.png");
            if (File.Exists(filePath))
            {
                var bytes = File.ReadAllBytes(filePath);
                if (IsValidPng(bytes))
                {
                    var dataUrl = "data:image/png;base64," + Convert.ToBase64String(bytes);
                    _memCache[key] = dataUrl;
                    return dataUrl;
                }
                else
                {
                    try { File.Delete(filePath); } catch { }
                }
            }
        }
        catch { }

        // 3. Cache Miss: queue background extraction and return null immediately
        QueueExtract(processName, fullPath);
        return null;
    }

    public static void QueueExtract(string processName, string? fullPath)
    {
        if (string.IsNullOrWhiteSpace(processName)) return;
        var key = SanitizeKey(processName);
        if (string.IsNullOrEmpty(key)) return;

        bool forceRefresh = false;
        if (!string.IsNullOrEmpty(fullPath) && File.Exists(fullPath))
        {
            try
            {
                var iconDir = PathHelper.GetIconCacheFolder();
                var filePath = Path.Combine(iconDir, $"{key}.png");
                if (File.Exists(filePath) && File.GetLastWriteTimeUtc(fullPath) > File.GetLastWriteTimeUtc(filePath))
                {
                    forceRefresh = true;
                }
            }
            catch { }
        }

        if (!forceRefresh && _memCache.ContainsKey(key) && _memCache[key] != null) return;
        if (!_pendingExtractions.TryAdd(key, 0)) return;

        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                var targetPath = fullPath;
                if (string.IsNullOrEmpty(targetPath) || !File.Exists(targetPath))
                {
                    targetPath = ResolveExePath(processName);
                }

                if (!string.IsNullOrEmpty(targetPath) && File.Exists(targetPath))
                {
                    var dataUrl = ExtractAndSaveIcon(key, targetPath);
                    if (dataUrl != null)
                    {
                        _memCache[key] = dataUrl;
                    }
                }
            }
            catch { }
            finally
            {
                _pendingExtractions.TryRemove(key, out byte _);
            }
        });
    }

    public static string? ExtractAndSaveIcon(string key, string exePath)
    {
        try
        {
            using var icon = Icon.ExtractAssociatedIcon(exePath);
            if (icon == null) return null;

            using var bmp = icon.ToBitmap();
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            var pngBytes = ms.ToArray();

            if (!IsValidPng(pngBytes)) return null;

            var dataUrl = "data:image/png;base64," + Convert.ToBase64String(pngBytes);

            // Save to disk cache atomically
            try
            {
                var iconDir = PathHelper.GetIconCacheFolder();
                var targetFile = Path.Combine(iconDir, $"{key}.png");
                var tmpFile = Path.Combine(iconDir, $"{key}.{Guid.NewGuid():N}.tmp");

                File.WriteAllBytes(tmpFile, pngBytes);
                File.Move(tmpFile, targetFile, overwrite: true);
            }
            catch { }

            return dataUrl;
        }
        catch
        {
            return null;
        }
    }

    private static string? ResolveExePath(string processName)
    {
        var cleanName = Path.GetFileName(processName);
        var nameWithoutExt = Path.GetFileNameWithoutExtension(cleanName);

        // A. Running processes lookup
        try
        {
            var procs = Process.GetProcessesByName(nameWithoutExt);
            foreach (var p in procs)
            {
                using (p)
                {
                    try
                    {
                        var fn = p.MainModule?.FileName;
                        if (!string.IsNullOrEmpty(fn) && File.Exists(fn))
                        {
                            return fn;
                        }
                    }
                    catch { }
                }
            }
        }
        catch { }

        // B. Registry App Paths lookup (HKCU & HKLM)
        try
        {
            var regPaths = new[]
            {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"
            };

            foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                foreach (var rp in regPaths)
                {
                    using var key = root.OpenSubKey($@"{rp}\{cleanName}");
                    if (key != null)
                    {
                        var val = key.GetValue(null)?.ToString();
                        if (!string.IsNullOrEmpty(val) && File.Exists(val))
                        {
                            return val;
                        }
                    }
                }
            }
        }
        catch { }

        // C. Common Windows directories
        try
        {
            var commonDirs = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86))
            };

            foreach (var dir in commonDirs)
            {
                if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
                var directMatch = Path.Combine(dir, cleanName);
                if (File.Exists(directMatch)) return directMatch;
            }
        }
        catch { }

        return null;
    }

    private static bool IsValidPng(byte[] bytes)
    {
        if (bytes == null || bytes.Length < 8) return false;
        for (int i = 0; i < 8; i++)
        {
            if (bytes[i] != PngMagic[i]) return false;
        }
        return true;
    }

    private static string SanitizeKey(string input)
    {
        var clean = Path.GetFileName(input).Trim().ToLowerInvariant();
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new System.Text.StringBuilder(clean.Length);
        foreach (var ch in clean)
        {
            if (!invalid.Contains(ch)) sb.Append(ch);
        }
        return sb.ToString();
    }
}
