using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace DualClip.Services;

public record RunningAppInfo(string Process, string Name, string Title, string? IconDataUrl = null);

public static class AppDiscoveryService
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    private static readonly Dictionary<string, string> KnownAppNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["code.exe"] = "Visual Studio Code",
        ["chrome.exe"] = "Google Chrome",
        ["msedge.exe"] = "Microsoft Edge",
        ["firefox.exe"] = "Mozilla Firefox",
        ["slack.exe"] = "Slack",
        ["discord.exe"] = "Discord",
        ["notepad.exe"] = "Notepad",
        ["notepad++.exe"] = "Notepad++",
        ["spotify.exe"] = "Spotify",
        ["explorer.exe"] = "File Explorer",
        ["devenv.exe"] = "Visual Studio",
        ["rider64.exe"] = "JetBrains Rider",
        ["pycharm64.exe"] = "PyCharm",
        ["webstorm64.exe"] = "WebStorm",
        ["sublime_text.exe"] = "Sublime Text",
        ["teams.exe"] = "Microsoft Teams",
        ["outlook.exe"] = "Microsoft Outlook",
        ["excel.exe"] = "Microsoft Excel",
        ["winword.exe"] = "Microsoft Word",
        ["powerpnt.exe"] = "Microsoft PowerPoint",
        ["terminal.exe"] = "Windows Terminal",
        ["windowsterminal.exe"] = "Windows Terminal",
        ["powershell.exe"] = "PowerShell",
        ["cmd.exe"] = "Command Prompt",
        ["obs64.exe"] = "OBS Studio",
        ["vlc.exe"] = "VLC Media Player",
        ["steam.exe"] = "Steam",
        ["calc.exe"] = "Calculator",
        ["mspaint.exe"] = "Paint",
        ["snippingtool.exe"] = "Snipping Tool",
        ["wispr.exe"] = "Wispr Flow",
        ["wisprflow.exe"] = "Wispr Flow",
        ["sharex.exe"] = "ShareX",
        ["everything.exe"] = "Everything",
        ["flow.launcher.exe"] = "Flow Launcher",
        ["powertoys.exe"] = "PowerToys",
        ["ditto.exe"] = "Ditto",
        ["dopus.exe"] = "Directory Opus",
        ["autohotkey64.exe"] = "AutoHotkey"
    };

    private static readonly HashSet<string> ExcludedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "dualclip.exe",
        "appdiscoverytester.exe",
        "dwm.exe",
        "searchhost.exe",
        "shellexperiencehost.exe",
        "startmenuexperiencehost.exe",
        "lockapp.exe",
        "applicationframehost.exe",
        "systemsettings.exe",
        "textinputhost.exe",
        "ctfmon.exe",
        "fontdrvhost.exe",
        "runtimebroker.exe",
        "sihost.exe",
        "taskhostw.exe",
        "shellhost.exe",
        "searchindexer.exe",
        "svchost.exe",
        "conhost.exe",
        "csrss.exe",
        "dllhost.exe",
        "comppkgsrv.exe",
        "smartscreen.exe",
        "securityhealthservice.exe",
        "securityhealthsystray.exe",
        "lsass.exe",
        "services.exe",
        "smss.exe",
        "wininit.exe",
        "winlogon.exe",
        "spoolsv.exe",
        "winstore.app.exe",
        "backgroundtaskhost.exe",
        "msedgewebview2.exe",
        "language_server.exe",
        "rundll32.exe",
        "searchapp.exe",
        "useroobebroker.exe",
        "systemsettingsadminflows.exe",
        "phoneexperiencehost.exe",
        "dopusrt.exe",
        "idle.exe",
        "system.exe",
        "idle",
        "system"
    };

    public static string GetFriendlyName(string processName)
    {
        if (string.IsNullOrWhiteSpace(processName)) return "";
        var baseName = Path.GetFileName(processName).Trim();
        if (KnownAppNames.TryGetValue(baseName, out var friendly))
            return friendly;

        var nameWithoutExt = Path.GetFileNameWithoutExtension(baseName);
        if (string.IsNullOrWhiteSpace(nameWithoutExt)) return baseName;

        var parts = nameWithoutExt.Split(new[] { '-', '_', ' ' }, StringSplitOptions.RemoveEmptyEntries);
        var titleCased = string.Join(" ", parts.Select(p => char.ToUpperInvariant(p[0]) + (p.Length > 1 ? p[1..] : "")));
        return string.IsNullOrWhiteSpace(titleCased) ? baseName : titleCased;
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string?> _iconCache = new(StringComparer.OrdinalIgnoreCase);

    private static List<RunningAppInfo>? _cachedApps;
    private static bool _cachedWithIcons;
    private static long _cachedAtTicks;
    private const long CacheTtlMs = 4000;

    public static List<RunningAppInfo> ListRunningApps(bool includeIcons = true)
    {
        long now = Environment.TickCount64;
        var snapshot = _cachedApps;
        if (snapshot != null && _cachedWithIcons == includeIcons && (now - _cachedAtTicks) < CacheTtlMs)
        {
            return snapshot;
        }

        var appsList = new List<RunningAppInfo>();
        var windowedProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int curPid = Process.GetCurrentProcess().Id;

        try
        {
            var processes = Process.GetProcesses();
            foreach (var proc in processes)
            {
                using (proc)
                {
                    try
                    {
                        if (proc.Id == curPid) continue;
                        var procName = proc.ProcessName + ".exe";
                        var lowerProc = procName.ToLowerInvariant();
                        if (ExcludedProcesses.Contains(lowerProc)) continue;

                        var handle = proc.MainWindowHandle;
                        var title = proc.MainWindowTitle?.Trim() ?? "";

                        bool isKnown = KnownAppNames.ContainsKey(lowerProc);
                        bool isVoice = lowerProc.Contains("wispr");
                        bool hasInteractiveWindow = handle != IntPtr.Zero && IsWindowVisible(handle) && !string.IsNullOrWhiteSpace(title);
                        bool isUserSession = proc.SessionId > 0;

                        // Exclude non-interactive background processes unless in user session or recognized helper
                        if (!hasInteractiveWindow && !isKnown && !isVoice && !isUserSession) continue;

                        string? fullPath = null;
                        string displayName = "";
                        try
                        {
                            fullPath = proc.MainModule?.FileName;
                            if (!string.IsNullOrEmpty(fullPath) && File.Exists(fullPath))
                            {
                                var fvi = FileVersionInfo.GetVersionInfo(fullPath);
                                if (!string.IsNullOrWhiteSpace(fvi.FileDescription))
                                {
                                    displayName = fvi.FileDescription.Trim();
                                }
                                else if (!string.IsNullOrWhiteSpace(fvi.ProductName))
                                {
                                    displayName = fvi.ProductName.Trim();
                                }
                            }
                        }
                        catch { }

                        if (string.IsNullOrEmpty(displayName))
                        {
                            displayName = KnownAppNames.TryGetValue(lowerProc, out var knownName)
                                ? knownName
                                : GetFriendlyName(procName);
                        }

                        string? icon = null;
                        if (includeIcons)
                        {
                            icon = TryGetIconFromPath(fullPath);
                        }

                        if (string.IsNullOrEmpty(title)) title = displayName;
                        appsList.Add(new RunningAppInfo(procName, displayName, title, icon));
                        if (hasInteractiveWindow) windowedProcs.Add(procName);
                    }
                    catch { }
                }
            }
        }
        catch { }

        // Deduplicate by process name, prioritizing entries with real window titles.
        // Sort: apps with visible windows first (real apps on top), background
        // helpers last, alphabetical within each group.
        var result = appsList
            .GroupBy(a => a.Process, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => x.Title.Length).First())
            .OrderByDescending(a => windowedProcs.Contains(a.Process))
            .ThenBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        _cachedApps = result;
        _cachedWithIcons = includeIcons;
        _cachedAtTicks = now;
        return result;
    }

    public static string? TryGetIconFromPath(string? path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
        if (_iconCache.TryGetValue(path, out var cached)) return cached;

        try
        {
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon != null)
            {
                using var bmp = icon.ToBitmap();
                using var ms = new MemoryStream();
                bmp.Save(ms, ImageFormat.Png);
                var dataUrl = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                _iconCache[path] = dataUrl;
                var baseName = Path.GetFileName(path);
                if (!string.IsNullOrEmpty(baseName))
                {
                    _iconCache[baseName] = dataUrl;
                }
                return dataUrl;
            }
        }
        catch { }
        _iconCache[path] = null;
        return null;
    }
}
