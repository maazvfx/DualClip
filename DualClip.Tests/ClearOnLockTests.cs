using Xunit;

namespace DualClip.Tests;

// The ClearOnLock setting and its six RPC handlers were removed (B1): no Settings control
// ever existed, so the feature was reachable only by hand-editing settings.json. What remains
// here is coverage for ClearHistoryAdvanced itself, which is still used by auto-expire,
// Clear History and the image-purge paths.
public class ClearHistoryAdvancedTests
{
    [Fact]
    public void ClearHistoryAdvanced_RespectsKeepPinned()
    {
        using var db = new TestDb();
        var (id1, _) = db.Service.AddOrBump("Clip 1 - Regular", "manual", "app", "title", "all");
        var (id2, _) = db.Service.AddOrBump("Clip 2 - Pinned", "manual", "app", "title", "all");
        db.Service.TogglePin(id2);

        bool ok = db.Service.ClearHistoryAdvanced(olderThanDays: null, keepPinned: true, keepStarred: true, keepCustomCollections: true);
        Assert.True(ok);

        Assert.Null(db.Service.GetClipById(id1));
        Assert.NotNull(db.Service.GetClipById(id2));
    }
}