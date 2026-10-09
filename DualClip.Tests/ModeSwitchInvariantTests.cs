using System.Diagnostics;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Covers the view-mode switch flow and the JS→C# RPC bridge surface.
///
/// TEST CLASSIFICATION:
///
///   [Fact] ModeSwitch_Invariants_Hold          BEHAVIOURAL. Executes the real
///       ui/js/settings/quick-view-menu.js and ui/js/core/bridge.js in Node DOM
///       shims and drives changeQuickViewLayoutPreset() plus the RPC facade,
///       asserting what actually reaches the host.
///
///   [Fact] RpcBridge_Invariants_Hold           BEHAVIOURAL. Executes the real
///       bridge.js facade and asserts every wrapper forwards all its parameters.
///
/// Why these exist: the UI is JavaScript and `dotnet build` never parses it. A
/// deleted `const b` shipped once as a build reporting "0 errors, 0 warnings"
/// while mode switching was entirely dead at runtime, and the bridge wrapper
/// silently dropped an argument while the source read correctly end to end.
/// Both are verified here to FAIL when reintroduced.
///
/// REQUIRES NODE ON PATH (same policy as AutoTierInvariantTests).
/// </summary>
public class ModeSwitchInvariantTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

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
                Assert.Fail("node is required for the mode-switch/bridge harnesses but could not be started. "
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
            return (-1, "");   // unreachable; satisfies the compiler
        }
    }

    [Fact]
    [Trait("Category", "Core")]
    public void ModeSwitch_Invariants_Hold()
    {
        // BEHAVIOURAL — drives the real preset bundle for Standard/Compact/Expanded.
        var run = RunHarness("mode-switch-invariants.js");
        Assert.True(
            run.ExitCode == 0,
            $"mode-switch-invariants.js reported a regression.\n--- harness output ---\n{run.Output}");
        Assert.Contains("SUMMARY", run.Output);
        Assert.DoesNotContain("FAIL ", run.Output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void RpcBridge_Invariants_Hold()
    {
        // BEHAVIOURAL — executes the real bridge facade and inspects forwarded args.
        var run = RunHarness("rpc-bridge-invariants.js");
        Assert.True(
            run.ExitCode == 0,
            $"rpc-bridge-invariants.js reported a regression.\n--- harness output ---\n{run.Output}");
        Assert.Contains("SUMMARY", run.Output);
        Assert.DoesNotContain("FAIL ", run.Output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SOURCE_TEXT_NoDeadBundleVariable()
    {
        // SOURCE-TEXT. Guards the specific defect that shipped: the bundle
        // selector was deleted while six `b.*` references remained, so the
        // function threw on its first statement and no mode switch worked.
        // The behavioural harness above is the real guard; this is a cheap
        // tripwire that names the regression directly in the failure output.
        string src = File.ReadAllText(
            Path.Combine(RepoRoot(), "ui", "js", "settings", "quick-view-menu.js"));

        Assert.Contains("const b = bundles[value]", src);

        var bodyStart = src.IndexOf("function changeQuickViewLayoutPreset", StringComparison.Ordinal);
        Assert.True(bodyStart >= 0, "changeQuickViewLayoutPreset not found");
        var body = src[bodyStart..];

        int declAt = body.IndexOf("const b = bundles[value]", StringComparison.Ordinal);
        int firstUse = body.IndexOf("b.density", StringComparison.Ordinal);
        Assert.True(declAt >= 0 && firstUse > declAt,
            "bundle selector must be declared before first use inside changeQuickViewLayoutPreset");
    }
}
