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
    /// Resolves the bounds a summon should restore. Pure: no WinForms, no side effects.
    /// </summary>
    /// <param name="rememberWindowSize">The RememberWindowSize setting.</param>
    /// <param name="rememberedWidth">Persisted WindowWidth (honoured only when rememberWindowSize).</param>
    /// <param name="rememberedHeight">Persisted WindowHeight (honoured only when rememberWindowSize).</param>
    /// <param name="lastWindowWidth">Frontend mirror of the last applied size; 0 = unknown.</param>
    /// <param name="lastWindowHeight">Frontend mirror of the last applied size; 0 = unknown.</param>
    /// <param name="workingArea">Working area of the display the window will appear on.</param>
    /// <param name="minWidth">App-wide minimum window width.</param>
    /// <param name="minHeight">App-wide minimum window height.</param>
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

        var clamped = WindowPlacement.ClampSize(new Size(w, h), workingArea, minWidth, minHeight);
        return (clamped.Width, clamped.Height);
    }
}
