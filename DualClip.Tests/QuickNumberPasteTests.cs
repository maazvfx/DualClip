using System;
using System.IO;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class QuickNumberPasteTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void QuickNumberPaste_DefaultIsFalse()
    {
        var settings = new AppSettingsData();
        Assert.False(settings.QuickNumberPaste);
    }

    /// <summary>
    /// Wiring guard: the toggle must exist end-to-end (settings row, bridge,
    /// apply/toggle functions, boot hydration) or the preference is dead.
    /// </summary>
    [Fact]
    [Trait("Category", "Core")]
    public void QuickNumberPaste_IsWiredFromSettingsRowToBackend()
    {
        string html = UiFile("index.html");
        Assert.Contains("id=\"stQuickNumberPasteToggle\"", html);
        Assert.Contains("toggleQuickNumberPasteSetting(this)", html);
        Assert.Contains("id=\"row_quick_number_paste\"", html);

        string bridge = UiFile(Path.Combine("js", "core", "bridge.js"));
        Assert.Contains("set_quick_number_paste: (enabled) => callHost('set_quick_number_paste'", bridge);
        Assert.Contains("get_quick_number_paste: () => callHost('get_quick_number_paste'", bridge);

        string shortcuts = UiFile(Path.Combine("js", "settings", "settings-shortcuts.js"));
        Assert.Contains("api.set_quick_number_paste(isEnabled)", shortcuts);
        Assert.Contains("notifySettingSaved('row_quick_number_paste')", shortcuts);

        string settingsCore = UiFile(Path.Combine("js", "settings", "settings-core.js"));
        Assert.Contains("applyQuickNumberPasteSetting(quickNumberPaste, false)", settingsCore);

        string mainForm = ReadMainFormSurface();
        Assert.Contains("case \"set_quick_number_paste\":", mainForm);
        Assert.Contains("case \"get_quick_number_paste\":", mainForm);
        Assert.Contains("s.QuickNumberPaste = quickNumberPaste;", mainForm);
    }

    /// <summary>
    /// Badges render only when the toggle is on; digit handling splits bare
    /// (paste) from Shift (collections) based on the same setting.
    /// </summary>
    [Fact]
    [Trait("Category", "Core")]
    public void QuickNumberPaste_BadgesAndDigitsAreGatedOnSetting()
    {
        string render = UiFile(Path.Combine("js", "list", "render.js"));
        Assert.Contains("getQuickNumberPasteSetting", render);

        string keyboard = UiFile(Path.Combine("js", "keyboard.js"));
        Assert.Contains("getQuickNumberPasteSetting", keyboard);
        Assert.Contains("paste the clip at this badge position", keyboard);
    }

    private static string UiFile(string relativePath)
    {
        string path = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", relativePath));
        Assert.True(File.Exists(path), $"Missing ui file: {path}");
        return File.ReadAllText(path);
    }

    private static string ReadMainFormSurface()
    {
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));
        var parts = Directory.GetFiles(root, "MainForm*.cs")
                             .OrderBy(p => p, StringComparer.Ordinal)
                             .Select(File.ReadAllText);
        string joined = string.Join("\n", parts);
        Assert.True(joined.Length > 0, "no MainForm*.cs partials found in repo root");
        return joined;
    }

    private static string SourceFile(string relativePath)
    {
        string path = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", relativePath));
        Assert.True(File.Exists(path), $"Missing source file: {path}");
        return File.ReadAllText(path);
    }
}
