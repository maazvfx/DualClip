using System.Reflection;

namespace DualClip.Tests;

/// <summary>
/// Auto-sort routing is driven by <c>MatchUrlPattern</c>, which is an implementation detail
/// of the clipboard listener (a Win32 type that cannot be constructed in a unit test). These
/// tests reach it reflectively rather than widening the production API for testing.
///
/// Two behaviours are pinned deliberately:
///   - wildcard rules match strictly, and subdomain/host matching works;
///   - a NON-wildcard pattern also matches as a plain substring, which is why a
///     "github.com" rule can match an unrelated lookalike host. That leniency is a known
///     rough edge documented in ARCHITECTURE.md; this test records it so the day it is
///     tightened, the change is deliberate rather than accidental.
/// </summary>
public class AutoSortPatternTests
{
    private static bool Match(string input, string pattern)
    {
        var m = typeof(Services.ClipboardListener)
            .GetMethod("MatchUrlPattern", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(m);
        return (bool)m.Invoke(null, new object?[] { input, pattern })!;
    }

    [Theory]
    [InlineData("https://github.com/owner/repo", "github.com")]
    [InlineData("https://www.github.com/owner/repo", "github.com")]
    [InlineData("https://gist.github.com/abc", "github.com")]
    [InlineData("https://sub.deep.github.com/x", "github.com")]
    public void HostAndSubdomainsMatchTheDomain(string url, string pattern)
        => Assert.True(Match(url, pattern));

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=1", "https://www.youtube.com")]
    [InlineData("https://notion.so/page", "notion.so")]
    public void ProtocolAndWwwPrefixesAreNormalized(string url, string pattern)
        => Assert.True(Match(url, pattern));

    [Theory]
    [InlineData("Pull Request 42 opened in GitHub Desktop", "*GitHub*")]
    [InlineData("anything at all", "*")]
    public void WildcardPatternsMatch(string input, string pattern)
        => Assert.True(Match(input, pattern));

    [Fact]
    public void WildcardIsNotTreatedAsAWildcardInOtherPositions()
    {
        // "git*ub.com" is a wildcard rule, so it must NOT match an unrelated host.
        Assert.False(Match("https://github.com/x", "git*ub.com"));
    }

    [Fact]
    public void EmptyInputsDoNotMatch()
    {
        Assert.False(Match("", "github.com"));
        Assert.False(Match("https://github.com", ""));
        Assert.False(Match("https://github.com", "   "));
    }

    [Fact]
    public void NullInputsDoNotThrow()
    {
        var ex = Record.Exception(() => Match(null!, "github.com"));
        Assert.Null(ex);
    }

    [Fact]
    public void UnrelatedDomainDoesNotMatch()
    {
        Assert.False(Match("https://stackoverflow.com/questions", "github.com"));
    }

    [Fact]
    public void LookalikeHostThatDoesNotContainThePatternIsRejected()
    {
        // "mygithubclone.com" does not contain "github.com" as a substring and its host
        // is not github.com nor a subdomain of it, so the rule correctly does not fire.
        // Pinned explicitly because the substring check running before host matching is a
        // known leniency (see the next test) and it is easy to over-correct here.
        Assert.False(Match("https://mygithubclone.com/x", "github.com"));
    }

    [Fact]
    public void SubstringLeniencyStillAppliesToPathText()
    {
        // The substring branch runs BEFORE strict host matching, so any input that
        // literally contains the pattern matches regardless of its real host. This is the
        // documented rough edge in ARCHITECTURE.md; pinning it makes a future tightening
        // a deliberate decision.
        Assert.True(Match("https://example.com/github.com/mirror", "github.com"));
    }
}