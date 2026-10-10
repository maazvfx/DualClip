using System.Diagnostics;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Covers frontend format detection and syntax classification rules.
///
/// TEST CLASSIFICATION:
///   [Fact] FormatDetection_Invariants_Hold     BEHAVIOURAL. Executes the real
///       getFormatTag() function in Node.js and asserts 15 classification invariants:
///       prose non-matches, PowerShell cmdlets & variables, shebangs, Python # comments,
///       Markdown code fences, strict JSON parsing, and performance budgets.
///
/// REQUIRES NODE ON PATH (same policy as ModeSwitchInvariantTests / AutoTierInvariantTests).
/// </summary>
public class FormatDetectionInvariantTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

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
                Assert.Fail("node is required for format detection harnesses but could not be started. "
                          + "Install Node.js (https://nodejs.org) or these tests will fail.");
            }
            string stdout = proc.StandardOutput.ReadToEnd();
            string stderr = proc.StandardError.ReadToEnd();
            proc.WaitForExit(120_000);
            return (proc.ExitCode, stdout + stderr);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            Assert.Fail("node was not found on PATH. These invariants live in JavaScript and are "
                      + "executed via Node; they cannot be skipped silently because a suite that "
                      + "reports green without running them is worse than a red one.");
            return (-1, "");
        }
    }

    [Fact]
    [Trait("Category", "Core")]
    public void FormatDetection_Invariants_Hold()
    {
        var run = RunHarness("format-detection-invariants.js");
        Assert.True(
            run.ExitCode == 0,
            $"format-detection-invariants.js reported a regression.\n--- harness output ---\n{run.Output}");
        Assert.Contains("All frontend format detection invariants hold!", run.Output);
        Assert.DoesNotContain("FAIL", run.Output);
    }
}
