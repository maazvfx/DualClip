using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
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
    private readonly CustomTrayMenuRenderer _renderer;
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
        _renderer = new CustomTrayMenuRenderer();
        _contextMenu = new ContextMenuStrip
        {
            ShowImageMargin = false,
            ShowCheckMargin = true
        };

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

        if (pauseItem.DropDown is ToolStripDropDownMenu pauseMenu)
        {
            pauseMenu.ShowImageMargin = false;
            pauseMenu.ShowCheckMargin = true;
        }

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

        if (clearItem.DropDown is ToolStripDropDownMenu clearMenu)
        {
            clearMenu.ShowImageMargin = false;
            clearMenu.ShowCheckMargin = false;
        }

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

        // ApplyVerticalPadding(_contextMenu.Items);

        _contextMenu.Opened += (_, _) => _menuOpen = true;
        _contextMenu.Closed += (_, _) => _menuOpen = false;

        ApplyTheme(AppSettings.Load().TrayTheme);

        Icon? icon = null;
        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "app.ico");
        if (File.Exists(iconPath))
        {
            try { icon = new Icon(iconPath); } catch { }
        }
        if (icon == null)
        {
            icon = SystemIcons.Application;
        }
        _normalIcon = icon;

        Icon? paused = null;
        var pausedPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "app-paused.ico");
        if (File.Exists(pausedPath))
        {
            try { paused = new Icon(pausedPath); } catch { }
        }
        _pausedIcon = paused;

        _notifyIcon = new NotifyIcon
        {
            Icon = icon,
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
        ApplyTheme(theme);
    }


    private void ApplyTheme(string theme)
    {
        // Temporarily disabled custom styling per user request
    }

    private static bool IsWindowsDarkMode()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            var val = key?.GetValue("AppsUseLightTheme");
            if (val is int intVal)
            {
                return intVal == 0;
            }
        }
        catch { }
        return true;
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

    private static void ApplyVerticalPadding(ToolStripItemCollection items)
    {
        foreach (ToolStripItem item in items)
        {
            if (item is ToolStripMenuItem menuItem)
            {
                menuItem.Padding = new Padding(0, 4, 0, 4);
                if (menuItem.HasDropDownItems)
                {
                    ApplyVerticalPadding(menuItem.DropDownItems);
                }
            }
        }
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        try { if (_pausedIcon != null) _pausedIcon.Dispose(); } catch { }
        try { if (_normalIcon != null && !ReferenceEquals(_normalIcon, SystemIcons.Application)) _normalIcon.Dispose(); } catch { }
    }
}

public class CustomTrayMenuColorTable : ProfessionalColorTable
{
    public bool IsLight { get; set; }

    public override Color ToolStripDropDownBackground => IsLight ? Color.FromArgb(250, 250, 252) : Color.FromArgb(24, 26, 36);
    public override Color ImageMarginGradientBegin => ToolStripDropDownBackground;
    public override Color ImageMarginGradientMiddle => ToolStripDropDownBackground;
    public override Color ImageMarginGradientEnd => ToolStripDropDownBackground;

    public override Color MenuBorder => IsLight ? Color.FromArgb(222, 226, 236) : Color.FromArgb(48, 52, 70);
    public override Color MenuItemBorder => Color.Transparent;

    public override Color MenuItemSelected => IsLight ? Color.FromArgb(232, 236, 246) : Color.FromArgb(38, 43, 62);
    public override Color MenuItemSelectedGradientBegin => MenuItemSelected;
    public override Color MenuItemSelectedGradientEnd => MenuItemSelected;

    public override Color MenuItemPressedGradientBegin => MenuItemSelected;
    public override Color MenuItemPressedGradientEnd => MenuItemSelected;

    // Fluent Blue Checkmark Accent
    public override Color CheckBackground => IsLight ? Color.FromArgb(37, 99, 235) : Color.FromArgb(59, 130, 246);
    public override Color CheckSelectedBackground => IsLight ? Color.FromArgb(29, 78, 216) : Color.FromArgb(96, 165, 250);
    public override Color CheckPressedBackground => CheckBackground;

    public override Color SeparatorDark => IsLight ? Color.FromArgb(226, 230, 240) : Color.FromArgb(42, 46, 62);
    public override Color SeparatorLight => SeparatorDark;
}

public class CustomTrayMenuRenderer : ToolStripProfessionalRenderer
{
    private readonly CustomTrayMenuColorTable _colorTable;

    public CustomTrayMenuRenderer() : this(new CustomTrayMenuColorTable()) { }

    private CustomTrayMenuRenderer(CustomTrayMenuColorTable colorTable) : base(colorTable)
    {
        _colorTable = colorTable;
        RoundedEdges = true;
    }

    public void SetTheme(bool isLight)
    {
        _colorTable.IsLight = isLight;
    }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        if (e.Item.Selected && e.Item.Enabled)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            var bounds = new Rectangle(2, 1, e.Item.Width - 4, e.Item.Height - 2);
            using var path = CreateRoundedRectanglePath(bounds, 5);
            using var brush = new SolidBrush(_colorTable.MenuItemSelected);
            g.FillPath(brush, path);
        }
        else
        {
            base.OnRenderMenuItemBackground(e);
        }
    }

    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var bounds = e.ImageRectangle;
        int badgeSize = 16;
        int x = bounds.X + (bounds.Width - badgeSize) / 2;
        int y = bounds.Y + (bounds.Height - badgeSize) / 2;
        var badgeRect = new Rectangle(x, y, badgeSize, badgeSize);

        // Draw rounded blue badge
        Color badgeColor = e.Item.Selected ? _colorTable.CheckSelectedBackground : _colorTable.CheckBackground;
        using var badgePath = CreateRoundedRectanglePath(badgeRect, 3.5f);
        using var badgeBrush = new SolidBrush(badgeColor);
        g.FillPath(badgeBrush, badgePath);

        // Draw crisp vector checkmark tick
        using var pen = new Pen(Color.White, 1.8f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };

        var p1 = new PointF(x + 3.8f, y + 8.2f);
        var p2 = new PointF(x + 6.8f, y + 11.2f);
        var p3 = new PointF(x + 12.2f, y + 4.8f);

        g.DrawLines(pen, new[] { p1, p2, p3 });
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        if (e.Item.Selected)
        {
            e.TextColor = _colorTable.IsLight ? Color.FromArgb(10, 14, 24) : Color.FromArgb(255, 255, 255);
        }
        else if (!e.Item.Enabled)
        {
            e.TextColor = _colorTable.IsLight ? Color.FromArgb(160, 166, 180) : Color.FromArgb(100, 106, 125);
        }
        else
        {
            e.TextColor = _colorTable.IsLight ? Color.FromArgb(45, 52, 68) : Color.FromArgb(220, 224, 236);
        }
        base.OnRenderItemText(e);
    }

    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;

        Color arrowColor = _colorTable.IsLight ? Color.FromArgb(100, 110, 130) : Color.FromArgb(180, 186, 205);
        using var pen = new Pen(arrowColor, 1.5f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };

        var bounds = e.ArrowRectangle;
        float x = bounds.X + bounds.Width / 2f - 2f;
        float y = bounds.Y + bounds.Height / 2f - 4f;

        g.DrawLines(pen, new[]
        {
            new PointF(x, y),
            new PointF(x + 4f, y + 4f),
            new PointF(x, y + 8f)
        });
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        var g = e.Graphics;
        var rect = new Rectangle(8, e.Item.Height / 2, e.Item.Width - 16, 1);
        using var brush = new SolidBrush(_colorTable.SeparatorDark);
        g.FillRectangle(brush, rect);
    }

    private static GraphicsPath CreateRoundedRectanglePath(Rectangle rect, float radius)
    {
        var path = new GraphicsPath();
        float diameter = radius * 2;
        var arc = new RectangleF(rect.X, rect.Y, diameter, diameter);

        path.AddArc(arc, 180, 90);
        arc.X = rect.Right - diameter;
        path.AddArc(arc, 270, 90);
        arc.Y = rect.Bottom - diameter;
        path.AddArc(arc, 0, 90);
        arc.X = rect.Left;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();

        return path;
    }
}
