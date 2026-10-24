using System.Drawing;

namespace DualClip.Services;

/// <summary>
/// Pure show-time size policy for the clipboard popup. Decides, before the window is
/// revealed, which bounds a summon should restore — so the native side never waits for an
/// <c>onWindowShow</c> round-trip to discover its own size (that round-trip is what made
/// Compact summons flash at the 970x730 default before shrinking to 360x260).
///
/// Authority rules, in order:
///   1. RememberWindowSize ON — the persisted WindowWidth/Height always wins (explicit
///      user choice to keep a specific size).
///   2. RememberWindowSize OFF — the frontend's last explicitly-applied size wins
///      (LastWindowWidth/Height mirror: the active layout preset's dimensions), so a
///      Compact summon appears at Compact dimensions on the very first frame.
///      0/unknown mirror falls back to the 970x730 default.
///   3. The result is clamped to the physical working area of the target display; a
///      display smaller than the preset shrinks it, never below the app minimum.
///
/// Reset is layout-aware: <see cref="ResetSizeFor"/> returns the base size of the
/// active layout mode, so "Reset Window Size" in Compact restores 360x260 instead
/// of jumping to Standard.
///
/// Kept free of any WinForms dependency (mirror-image of <see cref="WindowPlacement"/>)
/// so the policy can be unit tested without constructing a window or touching a display.
/// </summary>
public static class WindowSizePolicy
{
    /// <summary>Default preset width when no size authority is known (matches applyWindowSizePreset 'default').</summary>
    public const int DefaultWidth = 970;

    /// <summary>Default preset height when no size authority is known (matches applyWindowSizePreset 'default').</summary>
    public const int DefaultHeight = 730;

    /// <summary>Compact preset base (matches applyWindowSizePreset 'compact').</summary>
    public const int CompactWidth = 360;

    /// <summary>Compact preset base (matches applyWindowSizePreset 'compact').</summary>
    public const int CompactHeight = 260;

    /// <summary>Standard preset base (matches applyWindowSizePreset 'default').</summary>
    public const int StandardWidth = 970;

    /// <summary>Standard preset base (matches applyWindowSizePreset 'default').</summary>
    public const int StandardHeight = 730;

    /// <summary>
    /// Converts a logical pixel dimension to physical device pixels based on the given DPI scale.
    /// Clamps dpiScale to a minimum of 0.5f to guard against degenerate values.
    /// </summary>
    public static int ToPhysicalPixels(int logicalPixels, float dpiScale)
    {
        if (dpiScale <= 0f) dpiScale = 1.0f;
        return (int)Math.Round(logicalPixels * dpiScale, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Converts a physical device pixel dimension to logical CSS pixels based on the given DPI scale.
    /// </summary>
    public static int ToLogicalPixels(int physicalPixels, float dpiScale)
    {
        if (dpiScale <= 0f) dpiScale = 1.0f;
        return (int)Math.Round(physicalPixels / dpiScale, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Returns the base size of the given layout mode for "Reset Window Size".
    /// Only Compact and Standard exist (Large mode removed); legacy and
    /// unknown layouts fall back to Standard. Pure: no side effects.
    /// </summary>
    /// <param name="layout">Layout preset: 'compact' or 'standard'/'default'.</param>
    public static (int Width, int Height) ResetSizeFor(string? layout)
    {
        return (layout ?? "").Trim().ToLowerInvariant() switch
        {
            "compact" => (CompactWidth, CompactHeight),
            _ => (StandardWidth, StandardHeight),
        };
    }

    /// <summary>
    /// Returns the scaled base size (in physical pixels) of the given layout mode for "Reset Window Size".
    /// </summary>
    public static (int Width, int Height) ResetSizeFor(string? layout, float dpiScale)
    {
        var (w, h) = ResetSizeFor(layout);
        return (ToPhysicalPixels(w, dpiScale), ToPhysicalPixels(h, dpiScale));
    }

    /// <summary>
    /// Resolves the bounds a summon should restore, aware of the active layout preset and display DPI scale.
    /// Base presets (StandardWidth/Height, CompactWidth/Height) are scaled by dpiScale so the physical
    /// window matches the intended logical design size. Pure: no WinForms, no side effects.
    /// </summary>
    public static (int Width, int Height) Resolve(
        string? layoutPreset,
        int standardWidth,
        int standardHeight,
        int compactWidth,
        int compactHeight,
        int lastWindowWidth,
        int lastWindowHeight,
        Rectangle workingArea,
        int minWidth,
        int minHeight,
        float dpiScale)
    {
        if (dpiScale <= 0f) dpiScale = 1.0f;
        int scaledBaseStdW = ToPhysicalPixels(StandardWidth, dpiScale);
        int scaledBaseStdH = ToPhysicalPixels(StandardHeight, dpiScale);
        int scaledBaseCmpW = ToPhysicalPixels(CompactWidth, dpiScale);
        int scaledBaseCmpH = ToPhysicalPixels(CompactHeight, dpiScale);
        int scaledMinW = ToPhysicalPixels(minWidth, dpiScale);
        int scaledMinH = ToPhysicalPixels(minHeight, dpiScale);

        bool isCompact = string.Equals(layoutPreset, "compact", StringComparison.OrdinalIgnoreCase);
        int w, h;
        if (isCompact)
        {
            int resolvedCompactW = (compactWidth == CompactWidth) ? scaledBaseCmpW : compactWidth;
            int resolvedCompactH = (compactHeight == CompactHeight) ? scaledBaseCmpH : compactHeight;
            int resolvedLastW = (lastWindowWidth == CompactWidth) ? scaledBaseCmpW : lastWindowWidth;
            int resolvedLastH = (lastWindowHeight == CompactHeight) ? scaledBaseCmpH : lastWindowHeight;

            w = resolvedCompactW >= scaledMinW ? resolvedCompactW : (resolvedLastW >= scaledMinW && resolvedLastW <= scaledBaseCmpW * 2 ? resolvedLastW : scaledBaseCmpW);
            h = resolvedCompactH >= scaledMinH ? resolvedCompactH : (resolvedLastH >= scaledMinH && resolvedLastH <= scaledBaseCmpH * 2 ? resolvedLastH : scaledBaseCmpH);
        }
        else
        {
            int resolvedStdW = (standardWidth == StandardWidth) ? scaledBaseStdW : standardWidth;
            int resolvedStdH = (standardHeight == StandardHeight) ? scaledBaseStdH : standardHeight;
            int resolvedLastW = (lastWindowWidth == StandardWidth) ? scaledBaseStdW : lastWindowWidth;
            int resolvedLastH = (lastWindowHeight == StandardHeight) ? scaledBaseStdH : lastWindowHeight;

            w = resolvedStdW >= scaledMinW ? resolvedStdW : (resolvedLastW >= scaledMinW ? resolvedLastW : scaledBaseStdW);
            h = resolvedStdH >= scaledMinH ? resolvedStdH : (resolvedLastH >= scaledMinH ? resolvedLastH : scaledBaseStdH);
        }

        var clamped = WindowPlacement.ClampSize(new Size(w, h), workingArea, scaledMinW, scaledMinH);
        return (clamped.Width, clamped.Height);
    }

    /// <summary>
    /// Resolves the bounds a summon should restore, aware of the active layout preset.
    /// Pure: no WinForms, no side effects.
    /// </summary>
    public static (int Width, int Height) Resolve(
        string? layoutPreset,
        int standardWidth,
        int standardHeight,
        int compactWidth,
        int compactHeight,
        int lastWindowWidth,
        int lastWindowHeight,
        Rectangle workingArea,
        int minWidth,
        int minHeight)
        => Resolve(layoutPreset, standardWidth, standardHeight, compactWidth, compactHeight,
                   lastWindowWidth, lastWindowHeight, workingArea, minWidth, minHeight, 1.0f);

    /// <summary>
    /// Resolves the bounds a summon should restore. Pure: no WinForms, no side effects.
    /// </summary>
    public static (int Width, int Height) Resolve(
        bool rememberWindowSize,
        int rememberedWidth,
        int rememberedHeight,
        int lastWindowWidth,
        int lastWindowHeight,
        Rectangle workingArea,
        int minWidth,
        int minHeight,
        float dpiScale)
    {
        if (dpiScale <= 0f) dpiScale = 1.0f;
        int scaledDefaultW = ToPhysicalPixels(DefaultWidth, dpiScale);
        int scaledDefaultH = ToPhysicalPixels(DefaultHeight, dpiScale);
        int scaledMinW = ToPhysicalPixels(minWidth, dpiScale);
        int scaledMinH = ToPhysicalPixels(minHeight, dpiScale);

        int resolvedRemW = (rememberedWidth == DefaultWidth) ? scaledDefaultW : rememberedWidth;
        int resolvedRemH = (rememberedHeight == DefaultHeight) ? scaledDefaultH : rememberedHeight;
        int resolvedLastW = (lastWindowWidth == DefaultWidth) ? scaledDefaultW : lastWindowWidth;
        int resolvedLastH = (lastWindowHeight == DefaultHeight) ? scaledDefaultH : lastWindowHeight;

        int w = scaledDefaultW;
        int h = scaledDefaultH;

        if (rememberWindowSize && resolvedRemW >= scaledMinW && resolvedRemH >= scaledMinH)
        {
            w = resolvedRemW;
            h = resolvedRemH;
        }
        else if (resolvedLastW >= scaledMinW && resolvedLastH >= scaledMinH)
        {
            w = resolvedLastW;
            h = resolvedLastH;
        }
        else if (resolvedRemW >= scaledMinW && resolvedRemH >= scaledMinH)
        {
            w = resolvedRemW;
            h = resolvedRemH;
        }

        var clamped = WindowPlacement.ClampSize(new Size(w, h), workingArea, scaledMinW, scaledMinH);
        return (clamped.Width, clamped.Height);
    }

    /// <summary>
    /// Resolves the bounds a summon should restore. Pure: no WinForms, no side effects.
    /// </summary>
    public static (int Width, int Height) Resolve(
        bool rememberWindowSize,
        int rememberedWidth,
        int rememberedHeight,
        int lastWindowWidth,
        int lastWindowHeight,
        Rectangle workingArea,
        int minWidth,
        int minHeight)
        => Resolve(rememberWindowSize, rememberedWidth, rememberedHeight, lastWindowWidth, lastWindowHeight,
                   workingArea, minWidth, minHeight, 1.0f);
}
