using System.Drawing;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// The clipboard popup must never open off-screen, clipped by a taskbar, or on a display
/// that has been disconnected. These tests drive the pure geometry directly with the
/// multi-monitor and mixed-DPI layouts that are impractical to reproduce through the GUI.
/// </summary>
public class WindowPlacementTests
{
    private static readonly Size Popup = new(680, 580);

    // A 150% 4K primary placed at the virtual origin.
    private static readonly Rectangle Primary4k = new(0, 0, 3840, 2160);

    // A 100% 1080p secondary to the right, and one below to exercise negative origins.
    private static readonly Rectangle Right1080 = new(3840, 0, 1920, 1080);
    private static readonly Rectangle Left1080 = new(-1920, 0, 1920, 1080);

    [Fact]
    [Trait("Category", "Core")]
    public void PositionInsideWorkingAreaIsUnchanged()
    {
        var p = WindowPlacement.ClampToWorkingArea(new Point(100, 100), Popup, Primary4k);
        Assert.Equal(new Point(100, 100), p);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void PopupNearRightEdgeIsPulledBackOnScreen()
    {
        var p = WindowPlacement.ClampToWorkingArea(new Point(3800, 200), Popup, Primary4k);
        Assert.True(p.X + Popup.Width <= Primary4k.Right);
        Assert.True(WindowPlacement.IsMeaningfullyVisible(new Rectangle(p.X, p.Y, Popup.Width, Popup.Height), Primary4k));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void PopupNearBottomEdgeIsPulledAboveTaskbar()
    {
        // WorkingArea excludes the taskbar, so clamping must not push into it.
        var withTaskbar = new Rectangle(0, 0, 1920, 1040);
        var p = WindowPlacement.ClampToWorkingArea(new Point(200, 1030), Popup, withTaskbar);
        Assert.True(p.Y + Popup.Height <= withTaskbar.Bottom);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void PopupNearLeftEdgeIsPushedInside()
    {
        var p = WindowPlacement.ClampToWorkingArea(new Point(-500, 200), Popup, Primary4k);
        Assert.True(p.X >= Primary4k.Left);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void PopupOnSecondaryWithNegativeOriginStaysOnThatDisplay()
    {
        // A display left of the primary has negative coordinates; the popup must keep them.
        var p = WindowPlacement.ClampToWorkingArea(new Point(-1800, 100), Popup, Left1080);
        Assert.True(p.X >= Left1080.Left);
        Assert.True(p.X + Popup.Width <= Left1080.Right);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CenterModeCentersInsideWorkingArea()
    {
        var area = new Rectangle(0, 0, 1000, 1000);
        var p = WindowPlacement.CenterIn(Popup, area);
        Assert.Equal(new Point(160, 210), p);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void BottomRightStaysWithinWorkingArea()
    {
        var area = new Rectangle(0, 0, 1000, 1000);
        var p = WindowPlacement.BottomRight(new Size(400, 300), area);
        Assert.True(p.X >= area.Left && p.Y >= area.Top);
        Assert.True(p.X + 400 <= area.Right && p.Y + 300 <= area.Bottom);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void OnePixelSliverIsNotTreatedAsVisible()
    {
        // The old guard used IntersectsWith, which accepted a window hanging off the edge.
        var almostGone = new Rectangle(Primary4k.Right - 1, 100, Popup.Width, Popup.Height);
        Assert.False(WindowPlacement.IsMeaningfullyVisible(almostGone, Primary4k));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ComfortablyVisibleWindowPasses()
    {
        Assert.True(WindowPlacement.IsMeaningfullyVisible(new Rectangle(100, 100, Popup.Width, Popup.Height), Primary4k));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RememberedPositionOnDisconnectedDisplayIsRejected()
    {
        // Position remembered on a third monitor that is now gone.
        var remembered = new Rectangle(6000, 500, Popup.Width, Popup.Height);
        var attached = new[] { Primary4k, Right1080 };
        Assert.False(WindowPlacement.IsPositionUsable(remembered, attached));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RememberedPositionOnAttachedDisplayIsKept()
    {
        var remembered = new Rectangle(4000, 100, Popup.Width, Popup.Height);
        var attached = new[] { Primary4k, Right1080 };
        Assert.True(WindowPlacement.IsPositionUsable(remembered, attached));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SizeIsClampedToFitAWorkAreaSmallerThanThePopup()
    {
        var tiny = new Rectangle(0, 0, 400, 300);
        var size = WindowPlacement.ClampSize(Popup, tiny, 200, 150);
        Assert.True(size.Width <= tiny.Width);
        Assert.True(size.Height <= tiny.Height);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SizeClampNeverReturnsBelowTheMinimum()
    {
        // A work area smaller than the minimum must still yield a usable minimum size.
        var tiny = new Rectangle(0, 0, 50, 50);
        var size = WindowPlacement.ClampSize(Popup, tiny, 200, 150);
        Assert.Equal(200, size.Width);
        Assert.Equal(150, size.Height);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void PopupLargerThanWorkingAreaStillStaysReachable()
    {
        var small = new Rectangle(0, 0, 500, 400);
        var size = WindowPlacement.ClampSize(Popup, small, 200, 150);
        var p = WindowPlacement.ClampToWorkingArea(new Point(0, 0), size, small);
        Assert.True(p.X >= small.Left && p.Y >= small.Top);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void EveryModeProducesAVisibleWindowOnEveryDisplay()
    {
        var areas = new[] { Primary4k, Right1080, Left1080 };
        foreach (var area in areas)
        {
            var centers = new[]
            {
                WindowPlacement.CenterIn(Popup, area),
                WindowPlacement.BottomRight(Popup, area),
                new Point(area.Left, area.Top),
                new Point(area.Right - 1, area.Bottom - 1),
                new Point(area.Left - Popup.Width, area.Top - Popup.Height),
            };
            foreach (var c in centers)
            {
                var p = WindowPlacement.ClampToWorkingArea(c, Popup, area);
                var rect = new Rectangle(p.X, p.Y, Popup.Width, Popup.Height);
                Assert.True(
                    WindowPlacement.IsMeaningfullyVisible(rect, area),
                    $"mode candidate {c} escaped display {area}");
            }
        }
    }
}