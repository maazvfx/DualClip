using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace DualClip.Services;

public class TrayService : IDisposable
{
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _pauseItem;
    private readonly ToolStripMenuItem _pauseUntilResumeItem;
    private readonly ToolStripMenuItem _pause5mItem;
    private readonly ToolStripMenuItem _pause15mItem;
    private readonly ToolStripMenuItem _pause30mItem;
    private readonly ToolStripMenuItem _pause1hItem;
    private readonly ToolStripMenuItem _resumeItem;
    private readonly ContextMenuStrip _contextMenu;
    private readonly Icon? _normalIcon;
    private readonly Icon? _pausedIcon;
    private bool _menuOpen;

    public event Action? ToggleRequested;
    public event Action? PauseIndefiniteRequested;
    public event Action<int>? TimedPauseRequested;
    public event Action? ResumeRequested;
    public event Action<int>? ClearOlderThanRequested;
    public event Action? ClearExceptOrganizedRequested;
    public event Action? ClearImagesOnlyRequested;
    public event Action? ExitRequested;

    public TrayService()
    {
        _contextMenu = new ContextMenuStrip();

        var openItem = new ToolStripMenuItem("Open DualClip", null, (_, _) => ToggleRequested?.Invoke());
        _contextMenu.Items.Add(openItem);

        var pauseItem = new ToolStripMenuItem("Pause Capture");
        var pauseUntilResume = new ToolStripMenuItem("Until I Resume", null, (_, _) => PauseIndefiniteRequested?.Invoke());
        var pause5m = new ToolStripMenuItem("For 5 Minutes", null, (_, _) => TimedPauseRequested?.Invoke(5));
        var pause15m = new ToolStripMenuItem("For 15 Minutes", null, (_, _) => TimedPauseRequested?.Invoke(15));
        var pause30m = new ToolStripMenuItem("For 30 Minutes", null, (_, _) => TimedPauseRequested?.Invoke(30));
        var pause1h = new ToolStripMenuItem("For 1 Hour", null, (_, _) => TimedPauseRequested?.Invoke(60));
        var resumeItem = new ToolStripMenuItem("Resume Capture", null, (_, _) => ResumeRequested?.Invoke())
        {
            Enabled = false
        };

        pauseItem.DropDownItems.Add(pauseUntilResume);
        pauseItem.DropDownItems.Add(pause5m);
        pauseItem.DropDownItems.Add(pause15m);
        pauseItem.DropDownItems.Add(pause30m);
        pauseItem.DropDownItems.Add(pause1h);
        pauseItem.DropDownItems.Add(new ToolStripSeparator());
        pauseItem.DropDownItems.Add(resumeItem);

        _pauseUntilResumeItem = pauseUntilResume;
        _pause5mItem = pause5m;
        _pause15mItem = pause15m;
        _pause30mItem = pause30m;
        _pause1hItem = pause1h;
        _resumeItem = resumeItem;
        _pauseItem = pauseItem;
        _contextMenu.Items.Add(_pauseItem);

        var clearItem = new ToolStripMenuItem("Clear History");

        var clearOlder7 = new ToolStripMenuItem("Older Than 7 Days", null, (_, _) => ClearOlderThanRequested?.Invoke(7));
        var clearOlder30 = new ToolStripMenuItem("Older Than 30 Days", null, (_, _) => ClearOlderThanRequested?.Invoke(30));
        var clearKeepOrganized = new ToolStripMenuItem("Clear Main History Clips", null, (_, _) => ClearExceptOrganizedRequested?.Invoke());
        var clearImagesOnly = new ToolStripMenuItem("Clear Screenshots Only", null, (_, _) => ClearImagesOnlyRequested?.Invoke());

        clearItem.DropDownItems.Add(clearOlder7);
        clearItem.DropDownItems.Add(clearOlder30);
        clearItem.DropDownItems.Add(new ToolStripSeparator());
        clearItem.DropDownItems.Add(clearKeepOrganized);
        clearItem.DropDownItems.Add(clearImagesOnly);
        _contextMenu.Items.Add(clearItem);

        _contextMenu.Items.Add(new ToolStripSeparator());

        var exitItem = new ToolStripMenuItem("Exit DualClip", null, (_, _) => ExitRequested?.Invoke());
        _contextMenu.Items.Add(exitItem);

        _contextMenu.Opened += (_, _) => _menuOpen = true;
        _contextMenu.Closed += (_, _) => _menuOpen = false;

        _normalIcon = LoadBestIcon("assets/app.ico", isPaused: false);
        _pausedIcon = LoadBestIcon("assets/app-paused.ico", isPaused: true);

        _notifyIcon = new NotifyIcon
        {
            Icon = _normalIcon ?? SystemIcons.Application,
            Text = "DualClip - Smart Clipboard Manager",
            Visible = true,
            ContextMenuStrip = _contextMenu
        };

        _notifyIcon.MouseClick += (s, e) =>
        {
            if (_menuOpen || e.Button != MouseButtons.Left) return;
            long now = Environment.TickCount64;
            if (now - _lastClickTimestamp < 300)
            {
                return; // Ignore rapid second click from double-click
            }
            _lastClickTimestamp = now;
            ToggleRequested?.Invoke();
        };
    }

    private long _lastClickTimestamp;

    public void SetTheme(string theme)
    {
    }

    public void SetPaused(bool isPaused, string? label = null, int? activeMinutes = null)
    {
        _pauseItem.Checked = isPaused;
        _resumeItem.Enabled = isPaused;

        _pauseUntilResumeItem.Checked = isPaused && !activeMinutes.HasValue;
        _pause5mItem.Checked = isPaused && activeMinutes == 5;
        _pause15mItem.Checked = isPaused && activeMinutes == 15;
        _pause30mItem.Checked = isPaused && activeMinutes == 30;
        _pause1hItem.Checked = isPaused && activeMinutes == 60;

        string tooltip = isPaused
            ? (!string.IsNullOrWhiteSpace(label) ? $"DualClip - PAUSED ({label})" : "DualClip - PAUSED")
            : "DualClip - Smart Clipboard Manager";

        // NotifyIcon text must be <= 63 characters on Windows
        if (tooltip.Length > 63)
        {
            int cut = 60;
            if (cut > 0 && char.IsHighSurrogate(tooltip[cut - 1])) cut--;
            tooltip = tooltip.Substring(0, cut) + "...";
        }
        _notifyIcon.Text = tooltip;
        try
        {
            if (isPaused && _pausedIcon != null)
            {
                _notifyIcon.Icon = _pausedIcon;
            }
            else if (!isPaused && _normalIcon != null)
            {
                _notifyIcon.Icon = _normalIcon;
            }
        }
        catch { }
    }

    public void ShowNotification(string title, string message, ToolTipIcon icon = ToolTipIcon.Info, int timeoutMs = 3000)
    {
        try
        {
            _notifyIcon.ShowBalloonTip(timeoutMs, title, message, icon);
        }
        catch { }
    }

    public void RecreateIcon()
    {
        try
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Visible = true;
        }
        catch { }
    }

    private static Icon? LoadBestIcon(string relativePath, bool isPaused)
    {
        int cx = GetSystemMetrics(SM_CXSMICON);
        int cy = GetSystemMetrics(SM_CYSMICON);
        if (cx <= 0 || cy <= 0)
        {
            cx = 16;
            cy = 16;
        }

        // 1. Try disk file first (e.g., in unpacked install or dev)
        try
        {
            var diskPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, relativePath);
            if (File.Exists(diskPath))
            {
                return new Icon(diskPath, new Size(cx, cy));
            }
        }
        catch { }

        // 2. Try embedded resource from assembly
        try
        {
            var asm = typeof(TrayService).Assembly;
            var resName = asm.GetManifestResourceNames()
                .FirstOrDefault(r => r.EndsWith(Path.GetFileName(relativePath), StringComparison.OrdinalIgnoreCase));
            if (resName != null)
            {
                using var stream = asm.GetManifestResourceStream(resName);
                if (stream != null)
                {
                    return new Icon(stream, new Size(cx, cy));
                }
            }
        }
        catch { }

        // 3. Fallback to process executable icon
        try
        {
            var exePath = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
            {
                var exeIcon = Icon.ExtractAssociatedIcon(exePath);
                if (exeIcon != null)
                {
                    return new Icon(exeIcon, new Size(cx, cy));
                }
            }
        }
        catch { }

        return SystemIcons.Application;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);
    private const int SM_CXSMICON = 49;
    private const int SM_CYSMICON = 50;

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        try { if (_pausedIcon != null) _pausedIcon.Dispose(); } catch { }
        try { if (_normalIcon != null && !ReferenceEquals(_normalIcon, SystemIcons.Application)) _normalIcon.Dispose(); } catch { }
    }
}
