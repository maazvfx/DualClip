using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Microsoft.Win32;

namespace DualClip.Services;

public class AppSettingsData
{
    // Behavior & General
    public bool StartHidden { get; set; } = false;
    public bool StartWithWindows { get; set; } = false;
    public bool IsPaused { get; set; } = false;
    public DateTime? PausedUntilUtc { get; set; } = null;
    public int MinClipLength { get; set; } = 1;
    public bool IgnoreWhitespaceOnly { get; set; } = true;
    public bool IgnorePasswords { get; set; } = true;
    public bool CaptureImages { get; set; } = true;
    public bool EnableBlocklist { get; set; } = true;
    public bool DoubleCopyOverride { get; set; } = false;
    public List<string> BlocklistedApps { get; set; } = new();
    public List<AutoSortRuleEntry> AutoSortRules { get; set; } = GetDefaultAutoSortRules();

    public static List<AutoSortRuleEntry> GetDefaultAutoSortRules() => new();
    public int MaxClips { get; set; } = 500;
    public bool ShowTaskbar { get; set; } = false;
    public bool TrackStats { get; set; } = true;
    public bool RestoreClipboard { get; set; } = false;
    public int AutoExpireDays { get; set; } = 0; // 0 = never
    public bool IsSupporter { get; set; } = false;
    public bool PreventScreenCapture { get; set; } = false;

    // Window & UI
    public string WindowPositionMode { get; set; } = "near";
    public string TrayPositionMode { get; set; } = "center";
    public bool RememberWindowSize { get; set; } = false;
    public string LayoutPreset { get; set; } = "standard";
    public int WindowWidth { get; set; } = 970;
    public int WindowHeight { get; set; } = 730;
    public int StandardWidth { get; set; } = 970;
    public int StandardHeight { get; set; } = 730;
    public int CompactWidth { get; set; } = 360;
    public int CompactHeight { get; set; } = 260;
    // Mirror of the last size the frontend applied through a persisting resize
    // (set_window_size persist=true, a persisting bounds morph, or a drag-resize).
    public int LastWindowWidth { get; set; } = 0;
    public int LastWindowHeight { get; set; } = 0;
    public int? WindowX { get; set; } = null;
    public int? WindowY { get; set; } = null;
    public string ThemeColor { get; set; } = "purple";
    public string TrayTheme { get; set; } = "dark";
    public bool FuzzySearch { get; set; } = false; // V1.0 CONTRACT: default false
    public string Theme { get; set; } = "system";
    public string LineDisplay { get; set; } = "auto";
    public string ClipDetails { get; set; } = "auto";
    public string ThumbSize { get; set; } = "sm";
    public string ImageDisplayMode { get; set; } = "thumbnail_only";
    public string VisualStyle { get; set; } = "linear";
    public string GroupingMode { get; set; } = "time";
    // TASK-002: ViewMode removed — layout preset authority is localStorage 'dualclip_layout_preset'.
    public bool LivePreviewEnabled { get; set; } = false;
    public bool AnimateModeSwitch { get; set; } = false;

    // Smart Features
    public bool SmartShortcuts { get; set; } = true;
    public bool SuppressInFullscreen { get; set; } = false;
    public bool QuickNumberPaste { get; set; } = false;

    // Hotkeys
    public bool HotkeyWin { get; set; } = false;
    public bool HotkeyCtrl { get; set; } = true;
    public bool HotkeyAlt { get; set; } = false;
    public bool HotkeyShift { get; set; } = true;
    public int HotkeyVk { get; set; } = 0x56; // VK_V ('V')
}

public class AutoSortRuleEntry
{
    public string Type { get; set; } = "process";
    public string Pattern { get; set; } = "";
    public string Process { get; set; } = "";
    public string Collection { get; set; } = "all";

    public string GetEffectivePattern()
    {
        if (!string.IsNullOrWhiteSpace(Pattern)) return Pattern.Trim();
        if (!string.IsNullOrWhiteSpace(Process)) return Process.Trim();
        return "";
    }

    public string GetEffectiveType()
    {
        if (!string.IsNullOrWhiteSpace(Type)) return Type.Trim().ToLowerInvariant();
        return "process";
    }
}

public static class AppSettings
{
    private static readonly object _gate = new();
    private static volatile AppSettingsData? _cached;
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AppRunName = "DualClip";

    public static string GetFilePath()
    {
        return PathHelper.GetSettingsPath();
    }

    public static void InvalidateCache()
    {
        lock (_gate)
        {
            _cached = null;
        }
    }

    /// <summary>
    /// Loads the application settings. Returns a shared in-memory cached instance for high-throughput reads.
    /// Callers mutating properties must always follow up with <see cref="Save(AppSettingsData)"/> to persist changes.
    /// </summary>
    public static AppSettingsData Load(bool forceReload = false)
    {
        if (!forceReload && _cached != null)
        {
            return _cached;
        }

        lock (_gate)
        {
            if (!forceReload && _cached != null)
            {
                return _cached;
            }

            var path = GetFilePath();
            var bakPath = path + ".bak";

            if (File.Exists(path))
            {
                try
                {
                    var json = File.ReadAllText(path);
                    var data = JsonSerializer.Deserialize<AppSettingsData>(json);
                    if (data != null)
                    {
                        data.StartWithWindows = GetStartWithWindows();
                        if (data.AutoSortRules == null || data.AutoSortRules.Count == 0)
                        {
                            data.AutoSortRules = AppSettingsData.GetDefaultAutoSortRules();
                        }
                        _cached = data;
                        return data;
                    }
                }
                catch { }
            }

            if (File.Exists(bakPath))
            {
                try
                {
                    var json = File.ReadAllText(bakPath);
                    var data = JsonSerializer.Deserialize<AppSettingsData>(json);
                    if (data != null)
                    {
                        data.StartWithWindows = GetStartWithWindows();
                        if (data.AutoSortRules == null || data.AutoSortRules.Count == 0)
                        {
                            data.AutoSortRules = AppSettingsData.GetDefaultAutoSortRules();
                        }
                        _cached = data;
                        return data;
                    }
                }
                catch { }
            }

            var def = new AppSettingsData();
            def.StartWithWindows = GetStartWithWindows();
            _cached = def;
            return def;
        }
    }

    public static void Save(AppSettingsData data)
    {
        lock (_gate)
        {
            try
            {
                var path = GetFilePath();
                var tmpPath = path + ".tmp";
                var bakPath = path + ".bak";
                var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(tmpPath, json);

                if (File.Exists(path))
                {
                    File.Copy(path, bakPath, overwrite: true);
                }

                File.Move(tmpPath, path, overwrite: true);
                SetStartWithWindows(data.StartWithWindows);
                _cached = data;
            }
            catch { }
        }
    }

    public static bool GetStartWithWindows()
    {
        if (PathHelper.IsPortableMode) return false;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false);
            return key?.GetValue(AppRunName) != null;
        }
        catch
        {
            return false;
        }
    }

    public static bool SetStartWithWindows(bool enable)
    {
        if (PathHelper.IsPortableMode) return false;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true);
            if (key == null) return false;

            if (enable)
            {
                var exePath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "DualClip.exe");
                if (!string.IsNullOrEmpty(exePath))
                {
                    if (exePath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                    {
                        exePath = Path.ChangeExtension(exePath, ".exe");
                    }
                    key.SetValue(AppRunName, $"\"{exePath}\" --hidden");
                    return true;
                }
            }
            else
            {
                key.DeleteValue(AppRunName, false);
                return true;
            }
        }
        catch { }
        return false;
    }
}
