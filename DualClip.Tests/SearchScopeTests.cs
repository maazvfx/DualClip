namespace DualClip.Tests;

public class SearchScopeTests
{
    [Fact]
    public async Task SearchInPinsScope_OnlyReturnsFavorites()
    {
        using var db = new TestDb();
        long favId = db.AddText("unique keyword in favorite clip");
        db.Service.ToggleFavorite(favId);

        long nonFavId = db.AddText("unique keyword in normal clip");

        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "unique keyword",
            limit: 50,
            offset: 0,
            collection: "pins",
            filterType: "all",
            filterApp: "all",
            filterTime: "any",
            fuzzyEnabled: false
        );

        Assert.Single(results);
        Assert.Equal(favId, results[0].Id);
        Assert.True(results[0].Favorite);
    }

    [Fact]
    public async Task SearchInMostUsedScope_OnlyReturnsClipsWithUseCount()
    {
        using var db = new TestDb();
        long usedId = db.AddText("frequently used project script");
        db.Service.MarkUsed(usedId, trackStats: true);

        long unusedId = db.AddText("never used project script");

        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "project script",
            limit: 50,
            offset: 0,
            collection: "most_used",
            filterType: "all",
            filterApp: "all",
            filterTime: "any",
            fuzzyEnabled: false
        );

        Assert.Single(results);
        Assert.Equal(usedId, results[0].Id);
        Assert.True(results[0].UseCount >= 1);
    }

    [Fact]
    public async Task FuzzySearchInMostUsedScope_OnlyReturnsUsedClips()
    {
        using var db = new TestDb();
        long usedId = db.AddText("database migration runner");
        db.Service.MarkUsed(usedId, trackStats: true);

        long unusedId = db.AddText("database backup runner");

        // Typos with fuzzy enabled
        var results = await db.Service.GetClipsAsync(
            track: "all",
            search: "databse migraton",
            limit: 50,
            offset: 0,
            collection: "most_used",
            filterType: "all",
            filterApp: "all",
            filterTime: "any",
            fuzzyEnabled: true
        );

        Assert.All(results, clip => Assert.True(clip.UseCount >= 1));
    }
}
