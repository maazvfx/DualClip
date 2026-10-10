using System.Drawing;

namespace DualClip.Services;

/// <summary>
/// Pure window-placement geometry for the clipboard popup.
///
/// Kept free of any WinForms/Win32 dependency so the placement rules can be unit tested
/// without constructing a window or touching a display. <see cref="MainForm"/> supplies
/// live <see cref="Screen.WorkingArea"/> values and applies the result.
///
/// The rules that matter, in order:
///   1. If the requested size does not fit the working area, shrink it to fit (never
///      below the caller's minimum). A popup that cannot fit should shrink, not overflow.
///   2. The requested position is clamped so the window stays inside the working area,
///      which already excludes the taskbar on whichever edge it sits.
///   3. At least <see cref="MinVisibleWidth"/> x <see cref="MinVisibleHeight"/> of the window
///      must remain on screen. A window merely "intersecting" the desktop by one pixel is
///      not on screen, it is lost.
/// </summary>
public static class WindowPlacement
{
    /// <summary>Minimum on-screen footprint required for a popup to count as visible.</summary>
    public const int MinVisibleWidth = 120;

    /// <summary>Minimum on-screen footprint required for a popup to count as visible.</summary>
    public const int MinVisibleHeight = 80;

    /// <summary>Inset kept between the window and the working-area edge, in pixels.</summary>
    public const int EdgeMargin = 10;

    /// <summary>
    /// Clamps a size so it fits inside <paramref name="workingArea"/>, never returning less
    /// than the supplied minimum. When the working area is smaller than the minimum the
    /// minimum wins, because an undersized popup is better than one that cannot be reached.
    /// </summary>
    public static Size ClampSize(Size desired, Rectangle workingArea, int minWidth, int minHeight)
    {
        int maxW = Math.Max(minWidth, workingArea.Width);
        int maxH = Math.Max(minHeight, workingArea.Height);
        return new Size(
            Math.Clamp(desired.Width, minWidth, maxW),
            Math.Clamp(desired.Height, minHeight, maxH));
    }

    /// <summary>
    /// Clamps a top-left position so that at least <see cref="MinVisibleWidth"/> x
    /// <see cref="MinVisibleHeight"/> of a window of <paramref name="size"/> remains inside
    /// <paramref name="workingArea"/>. Returns an unchanged position when the window is
    /// comfortably visible.
    /// </summary>
    public static Point ClampToWorkingArea(Point desired, Size size, Rectangle workingArea)
    {
        int x = desired.X;
        int y = desired.Y;

        // A window that cannot show MinVisibleWidth should still be pushed fully onto the
        // screen rather than left straddling an edge.
        int visibleW = Math.Min(size.Width, MinVisibleWidth);
        int visibleH = Math.Min(size.Height, MinVisibleHeight);

        int maxX = workingArea.Right - visibleW;
        int maxY = workingArea.Bottom - visibleH;

        // Pull back inside when the window runs past the far edges.
        if (x + size.Width > workingArea.Right) x = workingArea.Right - size.Width;
        if (y + size.Height > workingArea.Bottom) y = workingArea.Bottom - size.Height;

        // Never start before the working-area origin.
        if (x < workingArea.Left) x = workingArea.Left;
        if (y < workingArea.Top) y = workingArea.Top;

        // If the window is larger than the working area, clamping alone cannot make it fully
        // visible; prefer showing its top-left region.
        x = Math.Clamp(x, Math.Min(workingArea.Left, maxX), maxX);
        y = Math.Clamp(y, Math.Min(workingArea.Top, maxY), maxY);

        return new Point(x, y);
    }

    /// <summary>
    /// Centres a window inside <paramref name="workingArea"/>.
    /// </summary>
    public static Point CenterIn(Size size, Rectangle workingArea)
        => new(
            workingArea.Left + (workingArea.Width - size.Width) / 2,
            workingArea.Top + (workingArea.Height - size.Height) / 2);

    /// <summary>
    /// Bottom-right anchor with a margin, used by the tray/corner modes.
    /// </summary>
    public static Point BottomRight(Size size, Rectangle workingArea, int margin = 16)
        => new(
            workingArea.Right - size.Width - margin,
            workingArea.Bottom - size.Height - margin);

    /// <summary>
    /// True when at least <see cref="MinVisibleWidth"/> x <see cref="MinVisibleHeight"/> of the
    /// window is visible within the working area. Used to validate remembered positions.
    /// </summary>
    public static bool IsMeaningfullyVisible(Rectangle windowRect, Rectangle workingArea)
    {
        var visible = Rectangle.Intersect(workingArea, windowRect);
        return visible.Width >= MinVisibleWidth && visible.Height >= MinVisibleHeight;
    }

    /// <summary>
    /// True when a remembered window position is still usable: it must be meaningfully
    /// visible on one of the supplied working areas. Guards against a monitor that was
    /// disconnected while the position was remembered.
    /// </summary>
    public static bool IsPositionUsable(Rectangle windowRect, IReadOnlyList<Rectangle> workingAreas)
    {
        foreach (var area in workingAreas)
        {
            if (IsMeaningfullyVisible(windowRect, area)) return true;
        }
        return false;
    }
}