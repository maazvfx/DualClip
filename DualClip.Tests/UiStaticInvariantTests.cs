using System.Text.RegularExpressions;
using Xunit;

namespace DualClip.Tests;

// STRUCTURAL guards for UI behaviors that cannot be executed without a
// window: instant startup reveal (WinForms ctor) and CSS-only presentation
// rules (badge hiding, Compact menu scaling). Behavioral twins cover what
// runs in Node: WindowSizePolicyTests + mode-switch-invariants.js pin the
// 360x260 geometry on both sides, and the compact clamp test pins menu
// positioning. These tests pin the source contract so silent regressions
// (re-adding an opacity gate, dropping a CSS rule) fail loudly.
public class UiStaticInvariantTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    private static string ReadRepoFile(params string[] relativeParts)
    {
        var path = Path.Combine(new[] { RepoRoot() }.Concat(relativeParts).ToArray());
        Assert.True(File.Exists(path), $"expected repo file at {path}");
        return File.ReadAllText(path);
    }

    private static string ReadMainFormSources()
    {
        var sb = new System.Text.StringBuilder();
        foreach (var name in new[] { "MainForm.cs", "MainForm.RpcDispatch.cs" })
        {
            var path = Path.Combine(RepoRoot(), name);
            if (File.Exists(path)) sb.Append(File.ReadAllText(path));
        }
        var all = sb.ToString();
        Assert.NotEmpty(all);
        return all;
    }

    [Fact]
    [Trait("Category", "Core")]
    public void StartupReveal_HasNoDelayedShowLogic()
    {
        string sources = ReadMainFormSources();
        foreach (var marker in new[] { "Opacity = 0", "_coldStartRevealTimer", "RevealColdStart", "_awaitingFirstPaint" })
        {
            Assert.DoesNotContain(marker, sources);
        }
    }

    [Fact]
    [Trait("Category", "Core")]
    public void StartupReveal_ShowsImmediatelyWhenNotStartHidden()
    {
        string sources = ReadMainFormSources();
        Assert.Contains("public MainForm(bool startHidden = false)", sources);
        Assert.Contains("if (!startHidden)", sources);
        Assert.Contains("ShowWindow()", sources);
        Assert.Contains("_allowVisible = true", sources);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CompactGeometry_AgreesAcrossBackendAndFrontend()
    {
        string policy = ReadRepoFile("Services", "WindowSizePolicy.cs");
        string appearance = ReadRepoFile("ui", "js", "settings", "settings-appearance.js");

        var wMatch = Regex.Match(policy, @"CompactWidth\s*=\s*(\d+)");
        var hMatch = Regex.Match(policy, @"CompactHeight\s*=\s*(\d+)");
        Assert.True(wMatch.Success && hMatch.Success);
        Assert.Equal("360", wMatch.Groups[1].Value);
        Assert.Equal("260", hMatch.Groups[1].Value);

        Assert.Contains("360", appearance);
        Assert.Contains("260", appearance);
        Assert.Matches(new Regex(@"compact['""]?\s*[\)\]:\s{]*\{?\s*w\s*=\s*360\s*;\s*h\s*=\s*260|w\s*=\s*360\s*;\s*h\s*=\s*260"), appearance);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SidebarBadges_HiddenByCss()
    {
        string sidebar = ReadRepoFile("ui", "css", "sidebar-layout.css");
        Assert.Contains(".sidebar-nav-badge", sidebar);
        Assert.Contains("display: none", sidebar);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void GroupCountBadges_HiddenByCss()
    {
        string clipList = ReadRepoFile("ui", "css", "clip-list.css");
        Assert.Contains(".group-count", clipList);
        Assert.Contains("display: none", clipList);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CollectionNameBadge_AlwaysVisibleByCss()
    {
        string clipList = ReadRepoFile("ui", "css", "clip-list.css");
        Assert.Contains(".row-collection-badge", clipList);
        Assert.Contains("visibility: visible", clipList);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CompactMenu_HasCompactScalingRules()
    {
        string css = ReadRepoFile("ui", "css", "collections-bar.css");
        Assert.Contains("compact", css);
        Assert.Contains(".context-menu", css);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SystemReservedCollections_UnifiedAcrossCodebase()
    {
        string namespaceJs = ReadRepoFile("ui", "js", "core", "namespace.js");
        string sidebarJs = ReadRepoFile("ui", "js", "list", "sidebar-layout.js");
        string filtersJs = ReadRepoFile("ui", "js", "list", "filters-collections.js");

        var rx = new Regex(@"SYSTEM_RESERVED_IDS\s*=\s*new\s+Set\(\[([^\]]+)\]\)");
        var expectedSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "all", "pins", "most_used", "favorites", "all_total", "all_unorganized", "transcriptions", "voice"
        };

        foreach (var (fileName, content) in new[] { ("namespace.js", namespaceJs), ("sidebar-layout.js", sidebarJs), ("filters-collections.js", filtersJs) })
        {
            var matches = rx.Matches(content);
            Assert.True(matches.Count > 0, $"{fileName} has no SYSTEM_RESERVED_IDS definition");
            foreach (Match m in matches)
            {
                var ids = Regex.Matches(m.Groups[1].Value, @"['""]([a-z0-9_]+)['""]", RegexOptions.IgnoreCase)
                               .Select(im => im.Groups[1].Value.ToLowerInvariant())
                               .ToHashSet();
                Assert.True(expectedSet.SetEquals(ids), $"{fileName} has mismatched SYSTEM_RESERVED_IDS: {string.Join(", ", ids)}");
            }
        }
    }
}
