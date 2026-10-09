using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class UrlCleanerTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_StripsUtmParameters()
    {
        string raw = "https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=october";
        string clean = UrlCleaner.CleanUrl(raw);
        Assert.Equal("https://example.com/article", clean);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_StripsFbclidAndGclid()
    {
        string raw = "https://example.com/shop?item=123&fbclid=IwAR2XYZ&gclid=CjwKCAiA";
        string clean = UrlCleaner.CleanUrl(raw);
        Assert.Equal("https://example.com/shop?item=123", clean);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_PreservesFunctionalParameters()
    {
        string raw = "https://www.google.com/search?q=dualclip&page=2";
        string clean = UrlCleaner.CleanUrl(raw);
        Assert.Equal("https://www.google.com/search?q=dualclip&page=2", clean);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_HostScoping_TwitterVsUnrelatedDomains()
    {
        // Twitter / X: 't' and 's' are stripped
        string twitterUrl = "https://x.com/user/status/123?s=20&t=abcdef";
        Assert.Equal("https://x.com/user/status/123", UrlCleaner.CleanUrl(twitterUrl));

        // Unrelated domains: 't' is preserved (e.g. notx.com, linux.com)
        string notxUrl = "https://notx.com/post?t=1";
        Assert.Equal("https://notx.com/post?t=1", UrlCleaner.CleanUrl(notxUrl));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_HostScoping_YouTubeTrackingVsTimestamp()
    {
        // YouTube 'si' is stripped, but timestamp 't' is preserved
        string ytShort = "https://youtu.be/dQw4w9WgXcQ?si=abcdef123456&t=45";
        Assert.Equal("https://youtu.be/dQw4w9WgXcQ?t=45", UrlCleaner.CleanUrl(ytShort));

        string ytFull = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=123&t=90s";
        Assert.Equal("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s", UrlCleaner.CleanUrl(ytFull));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_HostScoping_AmazonVsGeneralRefAndTag()
    {
        // Amazon: ref and tag are stripped
        string amazonUrl = "https://www.amazon.com/dp/B08N5WRWNW/ref=cm_sw_r_cp_api_glt_fabc_12345?tag=affiliate-20";
        Assert.Equal("https://www.amazon.com/dp/B08N5WRWNW", UrlCleaner.CleanUrl(amazonUrl));

        // General website: ref and tag are preserved as functional parameters
        string generalRef = "https://example.com/article?ref=engineering-team";
        Assert.Equal("https://example.com/article?ref=engineering-team", UrlCleaner.CleanUrl(generalRef));

        string generalTag = "https://example.com/shop?tag=blue";
        Assert.Equal("https://example.com/shop?tag=blue", UrlCleaner.CleanUrl(generalTag));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_PreservesBareHostsAndPathSegments()
    {
        // Bare host without trailing slash does not gain trailing slash
        Assert.Equal("https://example.com", UrlCleaner.CleanUrl("https://example.com"));

        // Non-Amazon path with /ref= segment is preserved intact
        string docsUrl = "https://example.com/docs/ref=abc/guide";
        Assert.Equal("https://example.com/docs/ref=abc/guide", UrlCleaner.CleanUrl(docsUrl));

        // Percent-encoding on untouched URLs is preserved exactly
        string encodedUrl = "https://example.com/p?path=a%2Fb%2Fc";
        Assert.Equal("https://example.com/p?path=a%2Fb%2Fc", UrlCleaner.CleanUrl(encodedUrl));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void CleanUrl_IsIdempotent()
    {
        string dirty = "https://x.com/user/status/123?s=20&t=abc&utm_source=twitter";
        string clean1 = UrlCleaner.CleanUrl(dirty);
        string clean2 = UrlCleaner.CleanUrl(clean1);
        Assert.Equal(clean1, clean2);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void IsUrl_DetectsValidHttpAndDomainPatterns_IncludingProse()
    {
        Assert.True(UrlCleaner.IsUrl("https://github.com"));
        Assert.True(UrlCleaner.IsUrl("http://localhost:3000"));
        Assert.True(UrlCleaner.IsUrl("Check https://example.com/article and read more"));
        Assert.False(UrlCleaner.IsUrl("Just a normal text note with words."));
    }
}
