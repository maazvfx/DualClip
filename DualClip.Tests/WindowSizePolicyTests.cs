using System;
using System.Drawing;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Pure show-time size policy tests: which bounds a summon restores, decided before the
/// window is revealed. This is the contract that eliminates the Compact summon flicker
/// (window appeared at 970x730 because RememberWindowSize==OFF hard-reset to the default,
/// then shrank to 360x260 once the onWindowShow round-trip reached JavaScript).
///
/// Authority order under test:
///   1. RememberWindowSize ON wins over the mirror (explicit user choice).
///   2. RememberWindowSize OFF replays the frontend's last applied size (the mirror).
///   3. Unknown mirror (0) falls back to the 970x730 default.
///   4. The result is clamped to the target display's working area, never below the
///      app minimum (all presets fit 768p unclamped).
/// Reset is layout-aware: ResetSizeFor returns the active mode's base size.
/// </summary>
public class WindowSizePolicyTests
{
    private static readonly Rectangle FullHd = new(0, 0, 1920, 1040); // taskbar excluded
    private static readonly Rectangle QuadHd = new(0, 0, 2560, 1400); // 1440p taskbar excluded
    private const int MinW = 300;
    private const int MinH = 240;

    private static (int W, int H) Resolve(
        bool remember = false,
        int rememberedW = 0, int rememberedH = 0,
        int lastW = 0, int lastH = 0,
        Rectangle? area = null,
        int minW = MinW, int minH = MinH)
        => WindowSizePolicy.Resolve(remember, rememberedW, rememberedH, lastW, lastH,
            area ?? FullHd, minW, minH);

    [Fact]
    [Trait("Category", "Core")]
    public void RememberOff_ReplaysFrontendMirror_CompactSummonIsInstant()
    {
        // The audit's headline case: Compact layout preset was applied by the frontend,
        // mirror recorded 360x260, RememberWindowSize is OFF.
        var (w, h) = Resolve(lastW: 360, lastH: 260);
        Assert.Equal((360, 260), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RememberOff_UnknownMirror_FallsBackToDefault()
    {
        // First launch ever (mirror 0/0): identical to the pre-fix behavior.
        var (w, h) = Resolve();
        Assert.Equal((970, 730), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RememberOn_WinsOverMirror()
    {
        // Explicit "remember my size" is the stronger authority.
        var (w, h) = Resolve(remember: true, rememberedW: 760, rememberedH: 600, lastW: 360, lastH: 260);
        Assert.Equal((760, 600), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RememberOn_BelowMinimumRemembered_FallsThroughToMirror()
    {
        // A corrupted/too-small remembered size must not win; the mirror is next.
        var (w, h) = Resolve(remember: true, rememberedW: 100, rememberedH: 100, lastW: 360, lastH: 260);
        Assert.Equal((360, 260), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void StandardPreset_FitsUnclampedOnSmallDisplay()
    {
        // 1366x768 laptop: only Compact and Standard presets exist now;
        // Standard 970x730 fits the working area unclamped.
        var small = new Rectangle(0, 0, 1366, 728);
        var (w, h) = Resolve(lastW: 680, lastH: 540, area: small);
        Assert.Equal((680, 540), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void OversizeRequest_ShrinksToWorkingArea_NeverBelowMinimum()
    {
        // A display smaller than the request still shrinks it, never below minimum.
        var tiny2 = new Rectangle(0, 0, 800, 500);
        var (w, h) = Resolve(lastW: 1000, lastH: 800, area: tiny2);
        Assert.Equal((800, 500), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void DisplaySmallerThanMinimum_MinimumWins()
    {
        // Degenerate display: an unreachable-but-honest window beats an invisible one.
        var tiny = new Rectangle(0, 0, 200, 150);
        var (w, h) = Resolve(lastW: 360, lastH: 260, area: tiny);
        Assert.Equal((MinW, MinH), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SecondaryDisplayWithNegativeOrigin_ClampsInsideIt()
    {
        // Left-of-primary monitor with negative coordinates.
        var left = new Rectangle(-1920, 0, 1920, 1040);
        var (w, h) = Resolve(lastW: 3600, lastH: 260, area: left);
        Assert.True(w <= left.Width);
        Assert.True(h <= left.Height);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RememberOn_UnknownRemembered_FallsThroughToMirrorThenDefault()
    {
        var (a, b) = Resolve(remember: true, rememberedW: 0, rememberedH: 0, lastW: 360, lastH: 260);
        Assert.Equal((360, 260), (a, b));

        var (c, d) = Resolve(remember: true);
        Assert.Equal((970, 730), (c, d));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ResetSizeFor_ReturnsActiveModeBase()
    {
        Assert.Equal((360, 260), WindowSizePolicy.ResetSizeFor("compact"));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor("standard"));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor("default"));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor("expanded"));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor("large"));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ResetSizeFor_UnknownOrNull_FallsBackToStandard()
    {
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor("bogus"));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor(null));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor(""));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void LayoutAware_CompactWithCustomDimensions_RestoresCustomDimensions()
    {
        var (w, h) = WindowSizePolicy.Resolve(
            layoutPreset: "compact",
            standardWidth: 1100, standardHeight: 800,
            compactWidth: 450, compactHeight: 320,
            lastWindowWidth: 450, lastWindowHeight: 320,
            workingArea: FullHd, minWidth: MinW, minHeight: MinH);
        Assert.Equal((450, 320), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void LayoutAware_StandardWithCustomDimensions_RestoresCustomDimensions()
    {
        var (w, h) = WindowSizePolicy.Resolve(
            layoutPreset: "standard",
            standardWidth: 1150, standardHeight: 820,
            compactWidth: 400, compactHeight: 280,
            lastWindowWidth: 1150, lastWindowHeight: 820,
            workingArea: FullHd, minWidth: MinW, minHeight: MinH);
        Assert.Equal((1150, 820), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ToPhysicalPixels_ScalesAccurately()
    {
        Assert.Equal(970, WindowSizePolicy.ToPhysicalPixels(970, 1.0f));
        Assert.Equal(1213, WindowSizePolicy.ToPhysicalPixels(970, 1.25f));
        Assert.Equal(1455, WindowSizePolicy.ToPhysicalPixels(970, 1.50f));
        Assert.Equal(1698, WindowSizePolicy.ToPhysicalPixels(970, 1.75f));
        Assert.Equal(1940, WindowSizePolicy.ToPhysicalPixels(970, 2.0f));

        Assert.Equal(360, WindowSizePolicy.ToPhysicalPixels(360, 1.0f));
        Assert.Equal(450, WindowSizePolicy.ToPhysicalPixels(360, 1.25f));
        Assert.Equal(540, WindowSizePolicy.ToPhysicalPixels(360, 1.50f));
        Assert.Equal(630, WindowSizePolicy.ToPhysicalPixels(360, 1.75f));
        Assert.Equal(720, WindowSizePolicy.ToPhysicalPixels(360, 2.0f));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ToLogicalPixels_ConvertsBackAccurately()
    {
        Assert.Equal(970, WindowSizePolicy.ToLogicalPixels(1455, 1.5f));
        Assert.Equal(360, WindowSizePolicy.ToLogicalPixels(540, 1.5f));
        Assert.Equal(970, WindowSizePolicy.ToLogicalPixels(1940, 2.0f));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ResetSizeFor_WithDpiScale_ScalesProperly()
    {
        // 100% scale
        Assert.Equal((360, 260), WindowSizePolicy.ResetSizeFor("compact", 1.0f));
        Assert.Equal((970, 730), WindowSizePolicy.ResetSizeFor("standard", 1.0f));

        // 150% scale
        Assert.Equal((540, 390), WindowSizePolicy.ResetSizeFor("compact", 1.5f));
        Assert.Equal((1455, 1095), WindowSizePolicy.ResetSizeFor("standard", 1.5f));

        // 200% scale
        Assert.Equal((720, 520), WindowSizePolicy.ResetSizeFor("compact", 2.0f));
        Assert.Equal((1940, 1460), WindowSizePolicy.ResetSizeFor("standard", 2.0f));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void LayoutAware_StandardBasePreset_At150Dpi_ScalesBaseTo1455x1095()
    {
        // Uncustomized standard base preset (970x730 in settings) at 150% scaling
        var (w, h) = WindowSizePolicy.Resolve(
            layoutPreset: "standard",
            standardWidth: 970, standardHeight: 730,
            compactWidth: 360, compactHeight: 260,
            lastWindowWidth: 0, lastWindowHeight: 0,
            workingArea: QuadHd, minWidth: MinW, minHeight: MinH,
            dpiScale: 1.5f);
        Assert.Equal((1455, 1095), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void LayoutAware_CompactBasePreset_At150Dpi_ScalesBaseTo540x390()
    {
        // Uncustomized compact base preset (360x260 in settings) at 150% scaling
        var (w, h) = WindowSizePolicy.Resolve(
            layoutPreset: "compact",
            standardWidth: 970, standardHeight: 730,
            compactWidth: 360, compactHeight: 260,
            lastWindowWidth: 360, lastWindowHeight: 260,
            workingArea: QuadHd, minWidth: MinW, minHeight: MinH,
            dpiScale: 1.5f);
        Assert.Equal((540, 390), (w, h));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void LayoutAware_StandardBasePreset_At150Dpi_ClampsToSmallWorkingArea()
    {
        // 1455x1095 base preset at 150% on a 1080p display (working area height ~1040)
        var (w, h) = WindowSizePolicy.Resolve(
            layoutPreset: "standard",
            standardWidth: 970, standardHeight: 730,
            compactWidth: 360, compactHeight: 260,
            lastWindowWidth: 0, lastWindowHeight: 0,
            workingArea: FullHd, minWidth: MinW, minHeight: MinH,
            dpiScale: 1.5f);
        Assert.Equal((1455, 1040), (w, h));
    }
}
