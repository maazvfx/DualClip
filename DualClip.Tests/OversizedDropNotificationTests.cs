using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

// The NotifyOversizedClips setting and its two RPC handlers were removed (B1): no Settings
// control ever existed for it. The oversized-clip notification itself is still wired and now
// fires unconditionally, so what remains here is coverage for the safety limits it reports on.
public class OversizedDropNotificationTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void MaxSafetyConstants_AreWithinExpectedLimits()
    {
        Assert.Equal(250_000, ClipboardListener.MaxTextChars);
        Assert.Equal(500 * 1024, ClipboardListener.MaxRichTextBytes);
    }
}