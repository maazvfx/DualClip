using System;

namespace DualClip.Services;

public enum HotkeyAction
{
    Show,
    RepositionAndBringToFront,
    IgnoreBounce,
    CycleNext,
    IgnoreCycleCooldown,
    Hide
}

/// <summary>
/// Pure policy governing hotkey toggle, debouncing, and list-cycling semantics.
/// Separated from WinForms/UI dispatch so activation invariants can be unit tested
/// under rapid churn, system lag, and out-of-order modifier releases.
/// </summary>
public static class HotkeyTogglePolicy
{
    public const double DefaultSummonDebounceMs = 350.0;
    public const double DefaultCycleDebounceMs = 120.0;

    public static HotkeyAction Evaluate(
        bool isVisible,
        bool isForeground,
        double elapsedSinceShowMs,
        double elapsedSinceCycleMs,
        bool smartShortcuts,
        bool modifiersHeld,
        bool fromTray = false,
        double summonDebounceMs = DefaultSummonDebounceMs,
        double cycleDebounceMs = DefaultCycleDebounceMs)
    {
        if (fromTray)
        {
            return isVisible ? HotkeyAction.Hide : HotkeyAction.Show;
        }

        if (!isVisible)
        {
            return HotkeyAction.Show;
        }

        if (!isForeground)
        {
            // Visible but inactive (e.g. pinned or focus shifted to background window):
            // User requested summon via hotkey — re-position window at current cursor and bring to front.
            return HotkeyAction.RepositionAndBringToFront;
        }

        // Window is visible and in the foreground:
        if (elapsedSinceShowMs < summonDebounceMs)
        {
            // Rapid repeat / bounce buffer: absorbs accidental multi-taps, key repeats,
            // or queued hotkey messages under system stress.
            return HotkeyAction.IgnoreBounce;
        }

        if (smartShortcuts && modifiersHeld)
        {
            if (elapsedSinceCycleMs >= cycleDebounceMs)
            {
                return HotkeyAction.CycleNext;
            }
            return HotkeyAction.IgnoreCycleCooldown;
        }

        return HotkeyAction.Hide;
    }
}
