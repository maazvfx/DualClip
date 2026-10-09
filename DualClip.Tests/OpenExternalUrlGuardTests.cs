using System.Text.RegularExpressions;
using Xunit;

namespace DualClip.Tests;

// STRUCTURAL guards for the open_external_url RPC security contract that
// cannot be behaviorally executed without a live MainForm/WebView2 host:
// the handler shell-executes a URL via Process.Start(UseShellExecute), so
// the ONLY thing standing between a compromised or buggy renderer and an
// arbitrary shell-handled target (e.g. a file: orUNC path, or a custom
// protocol hijacked to a handler of the attacker's choosing) is the
// scheme whitelist. This test pins the source-level shape of that
// whitelist so its silent removal fails loudly in CI.
//
// Behavioral twin: DualClip.Tests/js-harness/about-links-invariants.js
// exercises the frontend half (renderer never sends non-https cached
// links; fallbacks are https-only by construction).
public class OpenExternalUrlGuardTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    private static string ReadHandlerSource()
    {
        var path = Path.Combine(RepoRoot(), "MainForm.RpcDispatch.cs");
        Assert.True(File.Exists(path), $"expected MainForm.RpcDispatch.cs at {path}");
        return File.ReadAllText(path);
    }

    // Extracts only the `case "open_external_url":` block so generic scheme
    // checks elsewhere in the dispatcher cannot satisfy this test.
    private static string ReadOpenExternalUrlCase()
    {
        string source = ReadHandlerSource();
        int caseIdx = source.IndexOf("case \"open_external_url\":", StringComparison.Ordinal);
        Assert.True(caseIdx >= 0, "open_external_url case missing from MainForm.RpcDispatch.cs");

        // End of block = the next `case \"` label after this one (or EOF).
        int nextCase = source.IndexOf("case \"", caseIdx + 1, StringComparison.Ordinal);
        return nextCase > caseIdx ? source[caseIdx..nextCase] : source[caseIdx..];
    }

    [Fact]
    [Trait("Category", "Core")]
    public void OpenExternalUrl_RequiresAbsoluteParseableUrl()
    {
        string block = ReadOpenExternalUrlCase();
        Assert.Contains("Uri.TryCreate", block);
        Assert.Contains("UriKind.Absolute", block);
        // Whitespace/null payloads must never reach Process.Start.
        Assert.Contains("IsNullOrWhiteSpace", block);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void OpenExternalUrl_SchemeWhitelistIsHttpAndHttpsOnly()
    {
        string block = ReadOpenExternalUrlCase();
        // Both allowlist checks must be present in the SAME case block;
        // Whitelist exactly these two schemes — no custom-scheme passthrough.
        Assert.Contains("Uri.UriSchemeHttp", block);
        Assert.Contains("Uri.UriSchemeHttps", block);
        Assert.Matches(
            new Regex(@"Scheme\s*==\s*Uri\.UriSchemeHttp\s*\|\|\s*.*?Scheme\s*==\s*Uri\.UriSchemeHttps", RegexOptions.Singleline),
            block);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void OpenExternalUrl_LaunchesOutsideTheBuyProcess()
    {
        string block = ReadOpenExternalUrlCase();
        // Shell-execute so the DEFAULT browser opens, never an in-app WebView.
        Assert.Contains("Process.Start", block);
        Assert.Contains("UseShellExecute = true", block);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void OpenExternalUrl_LaunchFailureIsSwallowedNotFatal()
    {
        string block = ReadOpenExternalUrlCase();
        // A failed launch (no browser assoc., sandbox) must not crash the host.
        Assert.Matches(new Regex(@"catch\s*(\(\w+\s*\w+\))?\s*\{\s*\}", RegexOptions.Singleline), block);
    }
}
