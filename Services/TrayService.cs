using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace DualClip.Services;

public class TrayService : IDisposable
{
    // Switches matching approved style
    private static readonly bool TrayMenuStylingEnabled = true;
    private static readonly bool UseDarkBackground = true;
    private static readonly bool UseBorderColour = true;
    private static readonly bool UseHoverColour = false;
    private static readonly bool UseCustomFont = true;
    private static readonly int TrayMenuCorner = 8;
    private static readonly int TrayMenuHoverRadius = 0;

    private static readonly Color TrayMenuBg = ColorTranslator.FromHtml("#141416");
    private static readonly Color TrayMenuHover = ColorTranslator.FromHtml("#3F3F46");
    private static readonly Color TrayMenuBorder = ColorTranslator.FromHtml("#3C3C42");

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
        if (TrayMenuStylingEnabled)
        {
            _contextMenu.RenderMode = ToolStripRenderMode.Professional;
            _contextMenu.Renderer = new TrayMenuRenderer();
            if (UseDarkBackground)
            {
                _contextMenu.BackColor = TrayMenuBg;
                _contextMenu.ForeColor = Color.White;
            }
            if (UseCustomFont)
            {
                _contextMenu.Font = new Font("Segoe UI", 9.5f);
            }
            _contextMenu.ShowImageMargin = false;
            _contextMenu.ShowCheckMargin = true;
        }

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

        if (TrayMenuStylingEnabled && pauseItem.DropDown is ToolStripDropDownMenu pauseMenu)
        {
            pauseMenu.RenderMode = ToolStripRenderMode.Professional;
            pauseMenu.Renderer = _contextMenu.Renderer;
            if (UseDarkBackground)
            {
                pauseMenu.BackColor = TrayMenuBg;
                pauseMenu.ForeColor = Color.White;
            }
            if (UseCustomFont)
            {
                pauseMenu.Font = _contextMenu.Font;
            }
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

        if (TrayMenuStylingEnabled && clearItem.DropDown is ToolStripDropDownMenu clearMenu)
        {
            clearMenu.RenderMode = ToolStripRenderMode.Professional;
            clearMenu.Renderer = _contextMenu.Renderer;
            if (UseDarkBackground)
            {
                clearMenu.BackColor = TrayMenuBg;
                clearMenu.ForeColor = Color.White;
            }
            if (UseCustomFont)
            {
                clearMenu.Font = _contextMenu.Font;
            }
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

    private static GraphicsPath RoundedPath(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        if (radius <= 0)
        {
            path.AddRectangle(r);
            return path;
        }

        int d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed class TrayMenuColors : ProfessionalColorTable
    {
        private static Color Selection => UseHoverColour ? TrayMenuHover : SystemColors.Highlight;

        public override Color ToolStripDropDownBackground =>
            UseDarkBackground ? TrayMenuBg : SystemColors.Menu;

        public override Color MenuItemSelected => Selection;
        public override Color MenuItemSelectedGradientBegin => Selection;
        public override Color MenuItemSelectedGradientEnd => Selection;
        public override Color MenuItemPressedGradientBegin => Selection;
        public override Color MenuItemPressedGradientEnd => Selection;
        public override Color MenuItemBorder => Color.Transparent;

        public override Color MenuBorder =>
            UseBorderColour ? TrayMenuBorder : SystemColors.ControlDark;

        public override Color ImageMarginGradientBegin => Color.Transparent;
        public override Color ImageMarginGradientMiddle => Color.Transparent;
        public override Color ImageMarginGradientEnd => Color.Transparent;

        public override Color CheckBackground => Selection;
        public override Color CheckSelectedBackground => Selection;
        public override Color CheckPressedBackground => Selection;

        public override Color SeparatorDark => UseBorderColour ? TrayMenuBorder : SystemColors.ControlDark;
        public override Color SeparatorLight => Color.Transparent;
    }

    private sealed class TrayMenuRenderer : ToolStripProfessionalRenderer
    {
        public TrayMenuRenderer() : base(new TrayMenuColors())
        {
            RoundedEdges = false;
        }

        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
        {
            if (TrayMenuCorner <= 0 || !UseDarkBackground)
            {
                base.OnRenderToolStripBackground(e);
                return;
            }

            var rect = new Rectangle(0, 0, e.ToolStrip.Width, e.ToolStrip.Height);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var path = RoundedPath(rect, TrayMenuCorner);
            using var brush = new SolidBrush(TrayMenuBg);
            e.Graphics.FillPath(brush, path);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            if (!UseBorderColour)
            {
                base.OnRenderToolStripBorder(e);
                return;
            }

            var rect = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var path = RoundedPath(rect, TrayMenuCorner);
            using var pen = new Pen(TrayMenuBorder);
            e.Graphics.DrawPath(pen, path);
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (!UseDarkBackground)
            {
                base.OnRenderMenuItemBackground(e);
                return;
            }

            var bounds = e.Item.Bounds;

            if (e.Item is ToolStripMenuItem item && item.Selected && item.Enabled)
            {
                Color selection = UseHoverColour ? TrayMenuHover : SystemColors.Highlight;

                if (TrayMenuHoverRadius > 0)
                {
                    var pill = new Rectangle(
                        bounds.X + 4,
                        bounds.Y + 2,
                        bounds.Width - 8,
                        bounds.Height - 4);

                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    using var path = RoundedPath(pill, TrayMenuHoverRadius);
                    using var brush = new SolidBrush(selection);
                    e.Graphics.FillPath(brush, path);
                }
                else if (UseHoverColour)
                {
                    using var brush = new SolidBrush(selection);
                    e.Graphics.FillRectangle(brush, bounds);
                }
                else
                {
                    base.OnRenderMenuItemBackground(e);
                }
            }
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (UseDarkBackground)
            {
                e.TextColor = e.Item.Enabled ? Color.White : Color.FromArgb(120, 120, 130);
            }
            base.OnRenderItemText(e);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            if (UseDarkBackground)
            {
                e.ArrowColor = Color.White;
            }
            base.OnRenderArrow(e);
        }

        protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
        {
            if (!UseDarkBackground)
            {
                base.OnRenderItemCheck(e);
                return;
            }

            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            var bounds = e.ImageRectangle;
            int badgeSize = 14;
            int x = bounds.X + (bounds.Width - badgeSize) / 2;
            int y = bounds.Y + (bounds.Height - badgeSize) / 2;
            var badgeRect = new Rectangle(x, y, badgeSize, badgeSize);

            using var badgePath = RoundedPath(badgeRect, 3);
            using var badgeBrush = new SolidBrush(Color.FromArgb(37, 99, 235));
            g.FillPath(badgeBrush, badgePath);

            using var pen = new Pen(Color.White, 1.8f)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round
            };
            g.DrawLines(pen, new[]
            {
                new PointF(x + 3.2f, y + 7.2f),
                new PointF(x + 5.8f, y + 9.8f),
                new PointF(x + 10.8f, y + 4.2f)
            });
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            using var pen = new Pen(TrayMenuBorder);
            int y = e.Item.Height / 2;
            e.Graphics.DrawLine(pen, 8, y, e.Item.Width - 8, y);
        }
    }
}
