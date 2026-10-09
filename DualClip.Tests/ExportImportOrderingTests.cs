using DualClip.Models;

namespace DualClip.Tests;

/// <summary>
/// Export writes a chronological <c>sort_rank</c>; import sorts by that rank and then
/// RENUMBERS DENSELY rather than restoring absolute values. Absolute ranks are meaningless
/// across databases and would collide with locally stored clips, so dense renumbering is the
/// behaviour that must not regress.
/// </summary>
public class ExportImportOrderingTests
{
    private static ClipItem MakeClip(string text, long rank, long createdAt)
        => new()
        {
            Text = text,
            Preview = text,
            SortRank = rank,
            CreatedAt = DateTimeOffset.FromUnixTimeSeconds(createdAt).UtcDateTime,
            LastUsedAt = DateTimeOffset.FromUnixTimeSeconds(createdAt).UtcDateTime,
            Collection = "all",
            Track = "manual",
        };

    [Fact]
    public void SortRankIsAscendingChronological()
    {
        var older = MakeClip("older", 1, 1_000);
        var newer = MakeClip("newer", 2, 2_000);

        Assert.True(older.SortRank < newer.SortRank);
    }

    [Fact]
    public void ImportOrdersByExportedRankNotAlphabetically()
    {
        using var db = new TestDb();

        // Exported rank order is deliberately NOT alphabetical, so an implementation that
        // sorts by text would produce a different sequence and fail here.
        var items = new List<ClipItem>
        {
            MakeClip("zebra", 1, 1_000),
            MakeClip("apple", 2, 2_000),
            MakeClip("mango", 3, 3_000),
        };

        var (imported, _, _, _) = db.Service.ImportPackageBatch(items, null);
        Assert.Equal(3, imported);

        var stored = db.Search("");
        var order = stored.OrderBy(c => c.SortRank).Select(c => c.Text).ToList();

        Assert.Equal(new[] { "zebra", "apple", "mango" }, order);
    }

    [Fact]
    public void ImportedRanksAreRenumberedDensely()
    {
        using var db = new TestDb();

        // Sparse, large source ranks (as produced by a long-lived source database).
        var items = new List<ClipItem>
        {
            MakeClip("first", 5_000, 1_000),
            MakeClip("second", 90_000, 2_000),
            MakeClip("third", 999_999, 3_000),
        };

        db.Service.ImportPackageBatch(items, null);

        var ranks = db.Search("").OrderBy(c => c.SortRank).Select(c => c.SortRank).ToList();

        Assert.Equal(new long[] { 1, 2, 3 }, ranks);
    }

    [Fact]
    public void ImportedRanksDoNotCollideWithExistingClips()
    {
        using var db = new TestDb();

        // Pre-existing local clip occupies the low ranks.
        var (localId, _) = db.Service.AddOrBump("local clip", "manual", "app.exe", "App", "all");

        var items = new List<ClipItem> { MakeClip("imported one", 1, 5_000) };
        db.Service.ImportPackageBatch(items, null);

        var local = db.Search("").FirstOrDefault(c => c.Id == localId);
        var imported = db.Search("").FirstOrDefault(c => c.Text == "imported one");

        Assert.NotNull(local);
        Assert.NotNull(imported);
        Assert.NotEqual(local!.SortRank, imported!.SortRank);
    }

    [Fact]
    public void ReimportingTheSamePackageDoesNotDuplicateRows()
    {
        using var db = new TestDb();

        var items = new List<ClipItem>
        {
            MakeClip("repeat one", 1, 1_000),
            MakeClip("repeat two", 2, 2_000),
        };

        db.Service.ImportPackageBatch(items, null);
        var (_, deduped, _, _) = db.Service.ImportPackageBatch(items, null);

        Assert.Equal(2, deduped);
        Assert.Equal(2, db.Search("").Count);
    }

    [Fact]
    public void ExportIncludesSortRankForEveryClip()
    {
        using var db = new TestDb();
        db.AddText("exported a");
        db.AddText("exported b");

        var exported = db.Service.GetClipsForExport(true, null, false, false);

        Assert.Equal(2, exported.Count);
        Assert.All(exported, c => Assert.True(c.SortRank > 0));
    }
}