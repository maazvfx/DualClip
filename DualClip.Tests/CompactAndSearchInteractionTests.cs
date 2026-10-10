using System;
using System.IO;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Regression and invariant test suite for recently added UX features:
/// 1. Compact preview auto-expansion & collapse on close
/// 2. Idle search row drag handle & arrow cursor switching
/// 3. In-app preview lightbox integrity (no detached window leaks)
/// </summary>
public class CompactAndSearchInteractionTests
{
    private static string ResolveUiFile(string subpath)
    {
        string p1 = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", subpath);
        if (File.Exists(p1)) return Path.GetFullPath(p1);

        string p2 = Path.Combine(Directory.GetCurrentDirectory(), "ui", subpath);
        if (File.Exists(p2)) return Path.GetFullPath(p2);

        string p3 = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, subpath);
        if (File.Exists(p3)) return Path.GetFullPath(p3);

        return p1;
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CompactPreview_ExpandsOnOpen_AndRestoresOnClose()
    {
        string jsPath = ResolveUiFile(Path.Combine("js", "overlays", "preview-lightbox.js"));
        Assert.True(File.Exists(jsPath), $"preview-lightbox.js not found at {jsPath}");

        string content = File.ReadAllText(jsPath);

        // Verification of state variables
        Assert.Contains("_compactPreviewExpanded", content);
        Assert.Contains("_compactPreExpandSize", content);

        // Verification of open logic: checks for compact mode and calls set_window_size with animate=true
        Assert.Contains("data-layout-preset", content);
        Assert.Contains("set_window_size", content);

        // Verification of close logic: restores original pre-expand size
        Assert.Contains("closePreviewModal", content);
        Assert.Contains("restoreW", content);
        Assert.Contains("restoreH", content);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SearchInput_DefaultsToArrowCursor_WhenIdleOrEmpty()
    {
        string cssPath = ResolveUiFile(Path.Combine("css", "layout-chrome.css"));
        Assert.True(File.Exists(cssPath), $"layout-chrome.css not found at {cssPath}");

        string css = File.ReadAllText(cssPath);

        // Search input should default to cursor: default
        Assert.Contains(".search-input", css);
        Assert.Contains("cursor: default", css);

        // Caret (cursor: text) should only be activated when typing or non-empty
        Assert.Contains(".search-input.typing", css);
        Assert.Contains("cursor: text", css);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SearchInput_AllowsDragWhenEmpty_InFiltersSearchJs()
    {
        string jsPath = ResolveUiFile(Path.Combine("js", "list", "filters-search.js"));
        Assert.True(File.Exists(jsPath), $"filters-search.js not found at {jsPath}");

        string js = File.ReadAllText(jsPath);

        // Must toggle .typing class on input
        Assert.Contains("searchInputEl.classList.add('typing')", js);
        Assert.Contains("searchInputEl.classList.remove('typing')", js);

        // Must trigger window drag on pointerdown when search input is empty
        Assert.Contains("pointerdown", js);
        Assert.Contains("start_drag", js);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void DedicatedPreviewWindow_CleanlyRemovedFromUIAndBridge()
    {
        string htmlPath = ResolveUiFile("index.html");
        Assert.True(File.Exists(htmlPath), $"index.html not found at {htmlPath}");
        string html = File.ReadAllText(htmlPath);

        // popOutPreview button should be removed from previewModal
        Assert.DoesNotContain("popOutPreview", html);

        string bridgePath = ResolveUiFile(Path.Combine("js", "core", "bridge.js"));
        Assert.True(File.Exists(bridgePath), $"bridge.js not found at {bridgePath}");
        string bridge = File.ReadAllText(bridgePath);

        // open_preview_window and close_preview_window should not be exposed
        Assert.DoesNotContain("open_preview_window:", bridge);
        Assert.DoesNotContain("close_preview_window:", bridge);

        // Dedicated PreviewForm.cs and preview-window.html files should no longer exist
        string previewFormPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "PreviewForm.cs");
        string previewHtmlPath = ResolveUiFile("preview-window.html");
        Assert.False(File.Exists(previewFormPath), "PreviewForm.cs must not exist in repository root");
        Assert.False(File.Exists(previewHtmlPath), "preview-window.html must not exist in ui folder");
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ModalsJs_ContainsUniversalCompactModalAutoMorph()
    {
        string jsPath = ResolveUiFile(Path.Combine("js", "overlays", "modals.js"));
        Assert.True(File.Exists(jsPath), $"modals.js not found at {jsPath}");

        string content = File.ReadAllText(jsPath);

        // Verification of modal observer compact expansion hook
        Assert.Contains("window.__compactModalExpanded", content);
        Assert.Contains("window.__compactPreModalSize", content);
        Assert.Contains("editClipModal", content);
        Assert.Contains("appPickerModal", content);
        Assert.Contains("manageTagsModal", content);
        Assert.Contains("set_window_size", content);
    }
}
