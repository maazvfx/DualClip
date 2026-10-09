using System;
using System.IO;
using Xunit;

namespace DualClip.Tests;

public class SidebarLayoutTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_DefaultIsStandard_InSettingsDefaults()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "core", "settings-defaults.js");
        if (!File.Exists(jsPath))
        {
            jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "core", "settings-defaults.js");
        }

        Assert.True(File.Exists(jsPath));
        string content = File.ReadAllText(jsPath);
        Assert.Contains("dualclip_view_layout", content);
        Assert.Contains("'standard'", content);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_CssRulesExist()
    {
        string cssPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "css", "sidebar-layout.css");
        if (!File.Exists(cssPath))
        {
            cssPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "css", "sidebar-layout.css");
        }

        Assert.True(File.Exists(cssPath));
        string css = File.ReadAllText(cssPath);
        Assert.Contains(".layout-sidebar", css);
        Assert.Contains("#sidebarNav", css);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_ToggleBtnExists_InSearchWrapperOrTitlebar()
    {
        string htmlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "index.html");
        if (!File.Exists(htmlPath))
        {
            htmlPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "index.html");
        }

        Assert.True(File.Exists(htmlPath));
        string html = File.ReadAllText(htmlPath);

        // Find position of layout toggle button (btnToggleLayoutSearch or btnToggleLayout)
        bool hasSearchBtn = html.Contains("id=\"btnToggleLayoutSearch\"");
        bool hasTitleBtn = html.Contains("id=\"btnToggleLayout\"");
        Assert.True(hasSearchBtn || hasTitleBtn, "Layout toggle button should exist in index.html");
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_BadgesMinimalTransparent_NoPillContainer()
    {
        string cssPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "css", "sidebar-layout.css");
        if (!File.Exists(cssPath))
        {
            cssPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "css", "sidebar-layout.css");
        }

        Assert.True(File.Exists(cssPath));
        string css = File.ReadAllText(cssPath);

        Assert.Contains(".sidebar-nav-badge", css);
        Assert.Contains("background: transparent", css);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_DoesNotUseFilteredClipsOrDivergentCounter()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath))
        {
            jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        }

        Assert.True(File.Exists(jsPath));
        string js = File.ReadAllText(jsPath);

        // Must not implement a divergent counter wrapper
        Assert.DoesNotContain("function getSidebarClipCount", js);
        // Must never derive store badge counts from the filtered 'clips' array
        Assert.DoesNotContain("clips.length", js);
        // Must delegate directly to canonical counter
        Assert.Contains("getCollectionClipCount", js);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_EarlyExitWhenNotSidebarLayout()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath))
        {
            jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        }

        Assert.True(File.Exists(jsPath));
        string js = File.ReadAllText(jsPath);

        // Guarantees zero keystroke/filter cost when in standard layout
        Assert.Contains("if (getSidebarLayoutSetting() !== 'sidebar') return;", js);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_Wiring_ApplyFiltersAndStateInvokeUpdateCounts()
    {
        string searchJsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "filters-search.js");
        if (!File.Exists(searchJsPath)) searchJsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "filters-search.js");
        Assert.True(File.Exists(searchJsPath));
        string searchJs = File.ReadAllText(searchJsPath);
        Assert.Contains("updateSidebarCounts()", searchJs);

        string stateJsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "core", "state.js");
        if (!File.Exists(stateJsPath)) stateJsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "core", "state.js");
        Assert.True(File.Exists(stateJsPath));
        string stateJs = File.ReadAllText(stateJsPath);
        Assert.Contains("updateSidebarCounts()", stateJs);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_Execution_LiveCountsUpdateAccurately()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath)) jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        Assert.True(File.Exists(jsPath));

        string normalizedJsPath = Path.GetFullPath(jsPath).Replace("\\", "/");
        string nodeScript = $@"
const fs = require('fs');
let code = fs.readFileSync('{normalizedJsPath}', 'utf8');

let elements = {{
  sidebarNav: {{ id: 'sidebarNav' }},
  sideBadge_all: {{ textContent: '0' }},
  sideBadge_pins: {{ textContent: '0' }},
  sideBadge_most_used: {{ textContent: '0' }},
  sideBadge_work: {{ textContent: '0' }}
}};
global.document = {{
  getElementById: (id) => elements[id] || null,
  addEventListener: () => {{}}
}};
global.window = {{}};
global.getSetting = () => 'sidebar';
global.getCollectionClipCount = (col) => {{
  if (col === 'all') return 3;
  if (col === 'pins') return 1;
  if (col === 'most_used') return 1;
  if (col === 'work') return 1;
  return 0;
}};
global.customCollections = [{{ id: 'work', name: 'Work' }}];

eval(code);
updateSidebarCounts();

process.stdout.write(
  elements.sideBadge_all.textContent + ',' +
  elements.sideBadge_pins.textContent + ',' +
  elements.sideBadge_most_used.textContent + ',' +
  elements.sideBadge_work.textContent
);
";

        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"-e \"{nodeScript.Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ")}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var proc = System.Diagnostics.Process.Start(psi);
        Assert.NotNull(proc);
        string output = proc.StandardOutput.ReadToEnd();
        string error = proc.StandardError.ReadToEnd();
        proc.WaitForExit();

        Assert.Equal(0, proc.ExitCode);
        Assert.Equal("3,1,1,1", output.Trim());
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_SectionCollapsibles_ExportedInJs()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath)) jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        Assert.True(File.Exists(jsPath));
        string js = File.ReadAllText(jsPath);

        Assert.Contains("function toggleSidebarSection", js);
        Assert.Contains("window.toggleSidebarSection = toggleSidebarSection", js);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void GetCollectionsWithCounts_IncludesSystemBuckets_AllPinsMostUsed()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("work", "Work", false, 0);
        long id1 = db.AddText("Test clip 1");
        long id2 = db.AddText("Test clip 2");
        db.Service.ToggleFavorite(id1);
        db.Service.MarkUsed(id2, trackStats: true);
        db.Service.SetCollection(id1, "work");

        var data = db.Service.GetCollectionCountsData();
        Assert.NotNull(data);
        Assert.True(data.Collections.ContainsKey("work"));
        Assert.False(data.Collections.ContainsKey("all"));
        Assert.False(data.Collections.ContainsKey("all_total"));
        Assert.Equal(1, data.Collections["work"]);
        Assert.Equal(2, data.AllTotal);
        Assert.Equal(1, data.AllUnorganized);
        Assert.Equal(1, data.Pins);
        Assert.Equal(1, data.MostUsed);

        var counts = db.Service.GetCollectionsWithCounts();
        Assert.NotNull(counts);
        Assert.True(counts.ContainsKey("all_total"));
        Assert.True(counts.ContainsKey("all_unorganized"));
        Assert.True(counts.ContainsKey("pins"));
        Assert.True(counts.ContainsKey("most_used"));
        Assert.True(counts.ContainsKey("work"));
        Assert.False(counts.ContainsKey("all"));

        Assert.Equal(2, counts["all_total"]);
        Assert.Equal(1, counts["all_unorganized"]);
        Assert.Equal(1, counts["pins"]);
        Assert.Equal(1, counts["most_used"]);
        Assert.Equal(1, counts["work"]);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SetCollectionParent_SupportsHierarchyAndPreventsCycles()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("parent", "Parent Folder", false, 0);
        db.Service.SaveCollection("child", "Child Folder", false, 1);
        db.Service.SaveCollection("grandchild", "Grandchild Folder", false, 2);

        // 1. Nest child under parent
        bool ok1 = db.Service.SetCollectionParent("child", "parent");
        Assert.True(ok1);

        // 2. Nest grandchild under child
        bool ok2 = db.Service.SetCollectionParent("grandchild", "child");
        Assert.True(ok2);

        // 3. Verify hierarchy from GetCollections
        var defs = db.Service.GetCollections();
        var childDef = defs.Find(d => d.Id == "child");
        var grandchildDef = defs.Find(d => d.Id == "grandchild");
        Assert.NotNull(childDef);
        Assert.NotNull(grandchildDef);
        Assert.Equal("parent", childDef.ParentId);
        Assert.Equal("child", grandchildDef.ParentId);

        // 4. Cycle guard: Cannot nest parent inside itself
        bool selfNest = db.Service.SetCollectionParent("parent", "parent");
        Assert.False(selfNest);

        // 5. Cycle guard: Cannot nest parent inside grandchild (would create cycle)
        bool cycleNest = db.Service.SetCollectionParent("parent", "grandchild");
        Assert.False(cycleNest);

        // 6. Unnest grandchild back to top level
        bool unnest = db.Service.SetCollectionParent("grandchild", null);
        Assert.True(unnest);
        defs = db.Service.GetCollections();
        grandchildDef = defs.Find(d => d.Id == "grandchild");
        Assert.NotNull(grandchildDef);
        Assert.Null(grandchildDef.ParentId);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_NestedCollections_RendersTreeAndExcludesSystemBuckets()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath)) jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        Assert.True(File.Exists(jsPath));

        string normalizedJsPath = Path.GetFullPath(jsPath).Replace("\\", "/");
        string nodeScript = $@"
const fs = require('fs');
let code = fs.readFileSync('{normalizedJsPath}', 'utf8');

let navEl = {{ id: 'sidebarNav', innerHTML: '', classList: {{ toggle: () => {{}}, add: () => {{}}, remove: () => {{}} }} }};
global.document = {{
  getElementById: (id) => id === 'sidebarNav' ? navEl : null,
  addEventListener: () => {{}}
}};
global.window = {{ innerWidth: 800, innerHeight: 600 }};
global.escapeHtml = (s) => s;
global.getSetting = () => 'sidebar';
global.getCollectionClipCount = () => 0;

global.customCollections = [
  {{ id: 'work', name: 'Work', parentId: null }},
  {{ id: 'docs', name: 'Documentation', parentId: 'work' }},
  {{ id: 'all_total', name: 'all_total', parentId: null }},
  {{ id: 'all_unorganized', name: 'all_unorganized', parentId: null }}
];

eval(code);
renderSidebarNav();

let html = navEl.innerHTML;
let hasWorkDepth0 = html.includes('sidebar-depth-0') && html.includes('side_col_work');
let hasDocsDepth1 = html.includes('sidebar-depth-1') && html.includes('side_col_docs');
let leakedTotal = html.includes('side_col_all_total');
let leakedUnorganized = html.includes('side_col_all_unorganized');

process.stdout.write([hasWorkDepth0, hasDocsDepth1, !leakedTotal, !leakedUnorganized].join(','));
";

        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"-e \"{nodeScript.Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ")}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var proc = System.Diagnostics.Process.Start(psi);
        Assert.NotNull(proc);
        string output = proc.StandardOutput.ReadToEnd();
        proc.WaitForExit();

        Assert.Equal(0, proc.ExitCode);
        Assert.Equal("true,true,true,true", output.Trim());
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_ContainsCodeAndColorTypeFilters()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath)) jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        Assert.True(File.Exists(jsPath));

        string content = File.ReadAllText(jsPath);
        Assert.Contains("setFilterType('code')", content);
        Assert.Contains("Code Snippets", content);
        Assert.Contains("setFilterType('color')", content);
        Assert.Contains("Color Codes", content);

        string searchJsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "filters-search.js");
        if (!File.Exists(searchJsPath)) searchJsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "filters-search.js");
        Assert.True(File.Exists(searchJsPath));

        string searchJs = File.ReadAllText(searchJsPath);
        Assert.Contains("return 'COLOR';", searchJs);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarLayout_ContainsTagsSection()
    {
        string jsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", "js", "list", "sidebar-layout.js");
        if (!File.Exists(jsPath)) jsPath = Path.Combine(Directory.GetCurrentDirectory(), "ui", "js", "list", "sidebar-layout.js");
        Assert.True(File.Exists(jsPath));

        string content = File.ReadAllText(jsPath);
        Assert.Contains("sidebarSectionTitle_tags", content);
        Assert.Contains("sidebarDynamicTags", content);
        Assert.Contains("toggleSidebarTag", content);
        Assert.Contains("refreshSidebarTags", content);
        Assert.Contains("get_all_tags_with_stats", content);
    }
}

