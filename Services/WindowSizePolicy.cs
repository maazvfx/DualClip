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
    {
        bool isCompact = string.Equals(layoutPreset, "compact", StringComparison.OrdinalIgnoreCase);
        int w, h;
        if (isCompact)
        {
            w = compactWidth >= minWidth ? compactWidth : (lastWindowWidth >= minWidth && lastWindowWidth <= CompactWidth * 2 ? lastWindowWidth : CompactWidth);
            h = compactHeight >= minHeight ? compactHeight : (lastWindowHeight >= minHeight && lastWindowHeight <= CompactHeight * 2 ? lastWindowHeight : CompactHeight);
        }
        else
        {
            w = standardWidth >= minWidth ? standardWidth : (lastWindowWidth >= minWidth ? lastWindowWidth : StandardWidth);
            h = standardHeight >= minHeight ? standardHeight : (lastWindowHeight >= minHeight ? lastWindowHeight : StandardHeight);
        }

        var clamped = WindowPlacement.ClampSize(new Size(w, h), workingArea, minWidth, minHeight);
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
    {
        int w = DefaultWidth;
        int h = DefaultHeight;

        if (rememberWindowSize && rememberedWidth >= minWidth && rememberedHeight >= minHeight)
        {
            w = rememberedWidth;
            h = rememberedHeight;
        }
        else if (lastWindowWidth >= minWidth && lastWindowHeight >= minHeight)
        {
            w = lastWindowWidth;
            h = lastWindowHeight;
        }
        else if (rememberedWidth >= minWidth && rememberedHeight >= minHeight)
        {
            w = rememberedWidth;
            h = rememberedHeight;
        }

        var clamped = WindowPlacement.ClampSize(new Size(w, h), workingArea, minWidth, minHeight);
        return (clamped.Width, clamped.Height);
    }
}
