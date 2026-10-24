using System.Threading.Tasks;
using Xunit;

namespace DualClip.Tests;

public class SearchUsageRankingTests
{
    // Timestamps are stored in whole seconds, so steps that must be ordered wait past one second.
    private const int OneSecondStep = 1100;

    [Fact]
    public async Task Search_DefaultMode_PastedClipRanksAboveUnpastedClipWithSameMatch()
    {
        using var db = new TestDb();

        long unusedId = db.AddText("alpha project script");
        await Task.Delay(OneSecondStep);

        long usedId = db.AddText("alpha project notes");
        db.Service.MarkUsed(usedId, trackStats: true);

        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "alpha project",
            limit: 50,
            offset: 0
        );

        Assert.True(results.Count >= 2);
        Assert.Equal(usedId, results[0].Id);
        Assert.Equal(unusedId, results[1].Id);
    }

    [Fact]
    public async Task Search_DefaultMode_HigherPasteCountRanksFirstWhenMatchIsEqual()
    {
        using var db = new TestDb();

        long usedFiveTimesId = db.AddText("beta snippet five");
        for (int i = 0; i < 5; i++)
        {
            db.Service.MarkUsed(usedFiveTimesId, trackStats: true);
        }
        await Task.Delay(OneSecondStep);

        long usedOnceId = db.AddText("beta snippet one");
        db.Service.MarkUsed(usedOnceId, trackStats: true);

        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "beta snippet",
            limit: 50,
            offset: 0
        );

        Assert.True(results.Count >= 2);
        Assert.Equal(usedFiveTimesId, results[0].Id);
        Assert.Equal(usedOnceId, results[1].Id);
    }

    [Fact]
    public async Task Search_DefaultMode_UnusedPinnedClipDoesNotRankFirst()
    {
        using var db = new TestDb();

        long pinnedId = db.AddText("gamma pinned reference");
        db.Service.TogglePin(pinnedId);
        await Task.Delay(OneSecondStep);

        long usedId = db.AddText("gamma command line runner");
        db.Service.MarkUsed(usedId, trackStats: true);

        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "gamma",
            limit: 50,
            offset: 0
        );

        Assert.True(results.Count >= 2);
        Assert.Equal(usedId, results[0].Id);
        Assert.Equal(pinnedId, results[1].Id);
    }

    [Fact]
    public async Task Search_PinsBoost_UsedPinnedClipRanksFirst()
    {
        using var db = new TestDb();

        long pinnedId = db.AddText("gamma pinned reference");
        db.Service.TogglePin(pinnedId);
        db.Service.MarkUsed(pinnedId, trackStats: true);
        await Task.Delay(OneSecondStep);

        long otherId = db.AddText("gamma command line runner");
        db.Service.MarkUsed(otherId, trackStats: true);

        var defaultResults = await db.Service.GetClipsAsync(
            track: "all",
            search: "gamma",
            limit: 50,
            offset: 0,
            sort: "default"
        );
        Assert.Equal(otherId, defaultResults[0].Id);

        var pinsResults = await db.Service.GetClipsAsync(
            track: "all",
            search: "gamma",
            limit: 50,
            offset: 0,
            sort: "pins"
        );
        Assert.Equal(pinnedId, pinsResults[0].Id);
        Assert.Equal(otherId, pinsResults[1].Id);
    }

    [Fact]
    public async Task Search_DefaultMode_UnusedClipsFallBackToRelevanceAndRecency()
    {
        using var db = new TestDb();

        // Both clips have 0 uses. Each falls back to its created time, and relevance breaks ties.
        long substringId = db.AddText("middle text with delta inside");
        long exactStartId = db.AddText("delta exact start text");

        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "delta",
            limit: 50,
            offset: 0
        );

        Assert.True(results.Count >= 2);
        Assert.Equal(exactStartId, results[0].Id);
        Assert.Equal(substringId, results[1].Id);
    }
}
