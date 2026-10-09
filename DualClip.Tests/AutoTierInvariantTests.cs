using System.Diagnostics;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Covers the TASK-002 `auto` line-density repair.
///
/// TEST CLASSIFICATION:
///
///   [Fact] AutoTier_Invariants_Hold          BEHAVIOURAL. Executes the real
///       ui/js/list/render.js in a Node DOM shim: drives getAdaptiveTier() for
///       each tier and asserts getRowHeight()'s dense buckets equal the
///       min-height rules in ui/css/overlays-modals.css for every
///       (details x tier) pair. Verified to FAIL when the tier-3 clamp fix is
///       reverted (see responses/RESPONSE-002.md).
///   [Fact] SOURCE_TEXT_*                    SOURCE-TEXT. Pins the Phase 2
///       decoupling (line density no longer stomped by mode switches) and the
///       persistence collapse (dead ViewMode mirror deleted). Absence
///       assertions are the correct tool for deletions — there is no behaviour
///       left to execute.
///
/// REQUIRES NODE ON PATH (same policy as GroupCountPaginationTests).
/// </summary>
public class AutoTierInvariantTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));

    private static string RepoFile(params string[] parts)
    {
        var segs = new[] { RepoRoot() }.Concat(parts).ToArray();
        var full = Path.Combine(segs);
        Assert.True(File.Exists(full), $"expected source file at {full}");
        return File.ReadAllText(full);
    }

    private static string UiFile(params string[] parts)
        => RepoFile(new[] { "ui", "js" }.Concat(parts).ToArray());

    /// <summary>Run one Node harness and return (exitCode, stdout+stderr).</summary>
    private static (int ExitCode, string Output) RunHarness(string harnessFileName)
    {
        var script = Path.Combine(RepoRoot(), "DualClip.Tests", "js-harness", harnessFileName);
        Assert.True(File.Exists(script), $"expected harness at {script}");

        var psi = new ProcessStartInfo("node")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add(script);
        psi.WorkingDirectory = RepoRoot();

        try
        {
            using var proc = Process.Start(psi);
            if (proc is null)
            {
                Assert.Fail("node is required for the JS invariant harnesses but could not be started. "
                          + "Install Node.js (https://nodejs.org) or these tests will fail.");
            }
            string stdout = proc.StandardOutput.ReadToEnd();
            string stderr = proc.StandardError.ReadToEnd();
            proc.WaitForExit(120_000);
            return (proc.ExitCode, stdout + stderr);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            Assert.Fail("node was not found on PATH. The auto-tier invariants live in "
                      + "JavaScript and are executed via Node; they cannot be skipped silently because a "
                      + "suite that reports green without running them is worse than a red one. "
                      + "Install Node.js or exclude this class.");
            return (-1, "");   // unreachable; satisfies the compiler
        }
    }

    [Fact]
    [Trait("Category", "Core")]
    public void AutoTier_Invariants_Hold()
    {
        // BEHAVIOURAL — executes ui/js/list/render.js and calls the real
        // getAdaptiveTier() / getRowHeight() against the real CSS files.
        var script = Path.Combine(RepoRoot(), "DualClip.Tests", "js-harness", "auto-tier-invariants.js");
        Assert.True(File.Exists(script), $"expected harness at {script}");
        var run = RunHarness("auto-tier-invariants.js");
        Assert.True(
            run.ExitCode == 0,
            $"auto-tier-invariants.js reported a regression.\n--- harness output ---\n{run.Output}");
        Assert.Contains("SUMMARY", run.Output);
        Assert.DoesNotContain("FAIL ", run.Output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SOURCE_TEXT_LineDensityDecoupledFromModeSwitch()
    {
        // SOURCE-TEXT. The preset bundle must no longer stomp the user's line
        // setting when switching Compact/Standard.
        string qv = UiFile("settings", "quick-view-menu.js");
        Assert.DoesNotContain("changeLineDisplay(b.lines", qv);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SOURCE_TEXT_ViewModeMirrorDeleted()
    {
        // SOURCE-TEXT. Persistence authority is localStorage
        // 'dualclip_layout_preset' only; the C# ViewMode mirror and its RPCs
        // were deleted in the same change (TASK-002 Phase 2).
        string mainForm = RepoFile("MainForm.cs");
        Assert.DoesNotContain("set_view_mode", mainForm);
        Assert.DoesNotContain("get_view_mode", mainForm);
        Assert.DoesNotContain("s.ViewMode", mainForm);

        string settings = RepoFile("Services", "AppSettings.cs");
        Assert.DoesNotContain("public string ViewMode", settings);

        string bridge = UiFile("core", "bridge.js");
        Assert.DoesNotContain("set_view_mode", bridge);
        Assert.DoesNotContain("get_view_mode", bridge);

        string render = UiFile("list", "render.js");
        Assert.DoesNotContain("set_view_mode", render);
    }
}
