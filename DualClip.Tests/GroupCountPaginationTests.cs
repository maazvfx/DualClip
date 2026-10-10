using System.Diagnostics;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Covers the group-count and pagination fixes shipped for
/// docs/reviews/group-header-count-bugs.md (findings F1/F6/F10/F12).
///
/// TEST CLASSIFICATION — read before adding to this file:
///
///   [Fact] Pagination_Invariants_Hold          BEHAVIOURAL. Executes the real
///       ui/js/core/state.js in a Node DOM shim and drives loadNextClipPage()
///       against a mocked get_clips, asserting the offset actually sent to SQLite.
///   [Fact] GroupOverflow_Invariants_Hold      BEHAVIOURAL. Executes the real
///       render.js and calls createHeaderElement() for real.
///   [Fact] SOURCE_TEXT_*                      SOURCE-TEXT. Asserts on source
///       strings only, because the logic is not reachable from a test. Deliberately
///       kept to two. This repo has a documented anti-pattern of ~50 such tests in
///       SidebarLayoutTests.cs; do not add to it without a strong reason.
///
/// WHY THE NODE HARNESS EXISTS: the defect these cover was arithmetic. A source-text
/// assertion that the string "allClips.length" is gone would pass just as happily
/// while the offset was still wrong. Both harnesses were verified to FAIL when the
/// corresponding fix is reverted, which is what makes them worth running.
///
/// REQUIRES NODE ON PATH. DualClip's entire frontend is JS, so Node is already a hard
/// requirement for frontend work (see the js-syntax-check skill). These tests fail
/// loudly rather than silently skipping when Node is missing, because a green suite
/// that quietly did not run would be a lie.
/// </summary>
public class GroupCountPaginationTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));

    private static string RepoFile(params string[] parts)
    {
        var full = Path.Combine(new[] { RepoRoot(), "ui", "js" }.Concat(parts).ToArray());
        Assert.True(File.Exists(full), $"expected source file at {full}");
        return File.ReadAllText(full);
    }

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
            Assert.Fail("node was not found on PATH. The group-count and pagination invariants live in "
                      + "JavaScript and are executed via Node; they cannot be skipped silently because a "
                      + "suite that reports green without running them is worse than a red one. "
                      + "Install Node.js or exclude this class.");
            return (-1, "");   // unreachable; satisfies the compiler
        }
    }

    private static void AssertHarnessGreen((int ExitCode, string Output) run, string harnessName)
    {
        Assert.True(
            run.ExitCode == 0,
            $"{harnessName} reported a regression.\n--- harness output ---\n{run.Output}");

        Assert.Contains("SUMMARY", run.Output);
        Assert.DoesNotContain("FAIL ", run.Output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Pagination_Invariants_Hold()
    {
        // BEHAVIOURAL — executes ui/js/core/state.js and drives the real
        // loadNextClipPage(). Covers F10: the offset must be monotonic and must not
        // rewind when a loaded clip is deleted, which was the original defect.
        AssertHarnessGreen(RunHarness("pagination-invariants.js"), "pagination-invariants.js");
    }

    [Fact]
    [Trait("Category", "Core")]
    public void GroupOverflow_Invariants_Hold()
    {
        // BEHAVIOURAL — executes ui/js/list/render.js and calls the real
        // createHeaderElement(). Covers F1/F12: a truncated group must render "N+"
        // and must never present a page-capped integer as an exact total.
        AssertHarnessGreen(RunHarness("group-count-invariants.js"), "group-count-invariants.js");
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SOURCE_TEXT_GroupOverflow_ResolvedFromLoadingBoundary()
    {
        // SOURCE-TEXT. The resolution half of the fix (which group is "open" at the
        // page boundary) lives inside renderList(), which could not be driven from a
        // test — see responses/RESPONSE-001.md. This pins the wiring only.
        string js = RepoFile("list", "render.js");

        Assert.Contains("let openGrpKey = null;", js);
        Assert.Contains("countOverflow: grpKey === openGrpKey,", js);
        // Resolution must key off the final loaded clip's index, which is what makes
        // it work for every grouping mode without duplicating key derivation.
        Assert.Contains("const lastIdx = clips.length - 1;", js);
        Assert.Contains("gi[i].originalIdx === lastIdx", js);
        // And it must only fire while further pages actually remain.
        Assert.Contains("typeof hasMoreClips !== 'undefined' && hasMoreClips", js);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SOURCE_TEXT_SearchCounter_MarksPartialResults()
    {
        // SOURCE-TEXT. The search counter shares the defect (F6) but lives in
        // filters-search.js and is likewise unreachable from a test.
        string js = RepoFile("list", "filters-search.js");

        Assert.Contains("const partial = (typeof hasMoreClips !== 'undefined' && hasMoreClips);", js);
        Assert.Contains("const shown = partial ? (n + '+') : String(n);", js);
    }
}
