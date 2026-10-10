using Xunit;
using DualClip.Services;

namespace DualClip.Tests;

public class HotkeyTogglePolicyTests
{
    [Fact]
    public void ColdSummon_WhenNotVisible_ReturnsShow()
    {
        var action = HotkeyTogglePolicy.Evaluate(
            isVisible: false,
            isForeground: false,
            elapsedSinceShowMs: 10000,
            elapsedSinceCycleMs: 10000,
            smartShortcuts: true,
            modifiersHeld: true,
            fromTray: false);

        Assert.Equal(HotkeyAction.Show, action);
    }

    [Fact]
    public void TrayClick_TogglesVisibilityCleanly()
    {
        var showAction = HotkeyTogglePolicy.Evaluate(
            isVisible: false,
            isForeground: false,
            elapsedSinceShowMs: 0,
            elapsedSinceCycleMs: 0,
            smartShortcuts: false,
            modifiersHeld: false,
            fromTray: true);

        Assert.Equal(HotkeyAction.Show, showAction);

        var hideAction = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: true,
            elapsedSinceShowMs: 1000,
            elapsedSinceCycleMs: 1000,
            smartShortcuts: false,
            modifiersHeld: false,
            fromTray: true);

        Assert.Equal(HotkeyAction.Hide, hideAction);
    }

    [Fact]
    public void Visible_InactiveInBackground_AlwaysRepositionsAndBringsForward()
    {
        // When the window is visible but inactive in the background (e.g. pinned or focus lost),
        // pressing the summon hotkey must re-position it to the current mouse cursor and bring it forward,
        // rather than leaving it stranded at an old position or cycling selection.
        var action = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: false,
            elapsedSinceShowMs: 2000,
            elapsedSinceCycleMs: 2000,
            smartShortcuts: true,
            modifiersHeld: true,
            fromTray: false);

        Assert.Equal(HotkeyAction.RepositionAndBringToFront, action);
    }

    [Fact]
    public void RapidMultiPress_WithoutModifiers_DebouncesAndIgnoresBounce()
    {
        // When user rapidly taps the summon hotkey (without holding modifiers),
        // events arriving within the summon debounce window (< 350ms) must NOT accidentally
        // dismiss/re-hide the window.
        double[] rapidIntervalsMs = { 10.0, 50.0, 100.0, 200.0, 300.0, 349.0 };

        foreach (var elapsed in rapidIntervalsMs)
        {
            var action = HotkeyTogglePolicy.Evaluate(
                isVisible: true,
                isForeground: true,
                elapsedSinceShowMs: elapsed,
                elapsedSinceCycleMs: 1000.0,
                smartShortcuts: true,
                modifiersHeld: false,
                fromTray: false);

            Assert.Equal(HotkeyAction.IgnoreBounce, action);
        }
    }

    [Fact]
    public void Visible_AfterDebounce_ModifiersReleased_TogglesHide()
    {
        // User intentionally taps hotkey again after the window is already open to dismiss it.
        var action = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: true,
            elapsedSinceShowMs: 500.0,
            elapsedSinceCycleMs: 500.0,
            smartShortcuts: true,
            modifiersHeld: false,
            fromTray: false);

        Assert.Equal(HotkeyAction.Hide, action);
    }

    [Fact]
    public void Visible_AfterDebounce_SmartShortcutsDisabled_TogglesHideEvenIfModifiersHeld()
    {
        var action = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: true,
            elapsedSinceShowMs: 500.0,
            elapsedSinceCycleMs: 500.0,
            smartShortcuts: false,
            modifiersHeld: true,
            fromTray: false);

        Assert.Equal(HotkeyAction.Hide, action);
    }

    [Fact]
    public void Visible_AfterDebounce_SmartShortcutsEnabled_ModifiersHeld_CyclesNext()
    {
        // User intentionally holds modifier and presses hotkey past debounce to cycle.
        var action = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: true,
            elapsedSinceShowMs: 500.0,
            elapsedSinceCycleMs: 500.0,
            smartShortcuts: true,
            modifiersHeld: true,
            fromTray: false);

        Assert.Equal(HotkeyAction.CycleNext, action);
    }

    [Fact]
    public void Cycling_EnforcesRepeatCooldown_ToPreventRunawayKeyRepeats()
    {
        // While cycling, if repeated keystrokes arrive within cycle debounce (< 120ms),
        // they are safely absorbed.
        var debouncedAction = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: true,
            elapsedSinceShowMs: 600.0,
            elapsedSinceCycleMs: 50.0, // 50ms < 120ms cooldown
            smartShortcuts: true,
            modifiersHeld: true,
            fromTray: false);

        Assert.Equal(HotkeyAction.IgnoreCycleCooldown, debouncedAction);

        var validNextCycle = HotkeyTogglePolicy.Evaluate(
            isVisible: true,
            isForeground: true,
            elapsedSinceShowMs: 750.0,
            elapsedSinceCycleMs: 150.0, // 150ms >= 120ms cooldown
            smartShortcuts: true,
            modifiersHeld: true,
            fromTray: false);

        Assert.Equal(HotkeyAction.CycleNext, validNextCycle);
    }
}
