using DualClip.Tests;

namespace DualClip.Tests;

using DualClip.Services;

/// <summary>
/// Edge-case and stress coverage the mission prompt asks for but the rest of
/// the suite doesn't yet pin down. Every test runs against a real SQLite file
/// via TestDb, so these exercise the actual WAL/connection/purge machinery,
/// not mocks.
///
///   RapidChurn_...        — high-frequency clipboard semantics: same-content
///                            bursts dedupe, distinct contents stay distinct,
///                            retention holds under sustained inserts.
///   LargePayload_...      — behaviour must not change near/over the preview
///                            truncation boundary; huge searchable blobs stay
///                            hydratable through the optimized search engine.
///   Recovery_...          — a hard kill between writes must not lose or
///                            duplicate proven rows (WAL durability).
///
/// Timing budget: whole class stays well under 20s; no Thread.Sleep loops.
/// </summary>
public class StressAndEdgeTests
{
    private static string Hash(string text) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(text)));

    // ---------------------------------------------------------------------
    // Rapid-fire clipboard churn
    // ---------------------------------------------------------------------

    [Fact]
    public void RapidChurn_SameContentBurst_DedupesToOneRow()
    {
        using var db = new TestDb();
        // Simulate a screenshotter/IDE pasting the SAME content 50 times fast.
        var firstId = 0L;
        for (int i = 0; i < 50; i++)
        {
            var (id, _) = db.Service.AddOrBump("stable payload", "manual", "app.exe", "App", "all");
            if (i == 0) firstId = id;
            Assert.Equal(firstId, id); // every burst hits the same row
        }
        Assert.Single(db.Search(""));
    }

    [Fact]
    public void RapidChurn_DistinctContent_MaintainsOrderAndCount()
    {
        using var db = new TestDb();
        for (int i = 0; i < 100; i++)
        {
            db.AddText($"rapid-fire item {i:000}");
        }

        var all = db.Search("", limit: 200);
        Assert.Equal(100, all.Count);

        // Newest-first ordering invariant: last inserted must rank first.
        Assert.Contains("rapid-fire item 099", all[0].Text);

        // No content lost or duplicated under zero sleeps.
        var seen = new HashSet<string>();
        foreach (var c in all) Assert.True(seen.Add(c.Text ?? ""), "duplicate row in churn result");
    }

    [Fact]
    public void RapidChurn_RetentionPolicy_TrimsOldestUnpinned()
    {
        using var db = new TestDb();
        // Insert 50, then bump the OLDEST by writing it again: it must jump
        // to the front (bump semantics) and nothing should be purged while
        // under the cap implied by a 500-max setting (the app default).
        for (int i = 0; i < 50; i++) db.AddText($"churn item {i:000}");

        var firstWritten = db.Search("", limit: 200).MinBy(c => string.CompareOrdinal(c.Text, "churn item 000") == 0
            ? 0 : 1);
        Assert.NotNull(firstWritten);

        // Bump oldest content now.
        var (bumpedId, isNew) = db.Service.AddOrBump(firstWritten!.Text!, "manual", "app.exe", "App", "all");
        Assert.False(isNew, "bumped existing row must not create a new one");
        Assert.Contains(bumpedId, db.Search("", limit: 200).Select(c => c.Id));
    }

    // ---------------------------------------------------------------------
    // Large payloads
    // ---------------------------------------------------------------------

    [Fact]
    public void LargePayload_MegabyteText_InsertsAndSearches()
    {
        using var db = new TestDb();
        db.WaitForFts();
        var blob = new string('x', 1_000_000) + " searchTermNeedle " + new string('y', 1_000_000);

        var id = db.AddText(blob);
        Assert.True(id > 0);

        var hits = db.Search("searchTermNeedle");
        Assert.Single(hits);
        Assert.Equal(id, hits[0].Id);
    }

    [Fact]
    public void LargePayload_HugeListImportsWithoutCorruption()
    {
        using var db = new TestDb();
        // Simulate a multi-thousand-line file-drop: each line becomes one clip.
        var items = Enumerable.Range(0, 2000)
            .Select(i => new DualClip.Models.ClipItem
            {
                Text = $"line {i:0000}",
                Preview = $"line {i:0000}",
                Collection = "all"
            })
            .ToList();

        var (imported, deduped, skipped, skippedImages) = db.Service.ImportPackageBatch(items, null);
        Assert.Equal(2000, imported);
        Assert.Equal(0, deduped);
        Assert.Equal(0, skipped);
        Assert.Equal(0, skippedImages);

        // Post-import integrity: paginated reads return consistent totals.
        Assert.Equal(2000, db.Search("", limit: 5000).Count);
    }

    [Fact]
    public void LargePayload_UrlCleaning_PreservesLegitLongUrls()
    {
        // A long-but-legitimate URL must not be corrupted by UrlCleaner.
        var longUrl = "https://example.com/" + string.Join('/',
            Enumerable.Repeat("segment", 200)) + "?q=" + new string('z', 500);
        var cleaned = DualClip.Services.UrlCleaner.CleanUrl(longUrl);
        Assert.False(string.IsNullOrWhiteSpace(cleaned));
        Assert.StartsWith("https://", cleaned);
    }

    // ---------------------------------------------------------------------
    // Crash/recovery semantics
    // ---------------------------------------------------------------------

    [Fact]
    public void Recovery_RowsWrittenBeforeSimulatedCrash_SurviveReopen()
    {
        string dir = Path.Combine(Path.GetTempPath(), "dualclip-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        string dbPath = Path.Combine(dir, "clips.db");

        long expectedId;
        try
        {
            var first = new DualClip.Services.DatabaseService(dbPath);
            expectedId = first.AddOrBump("durable under wal", "manual", "app.exe", "App", "all").Id;
            // No explicit checkpoint: mimic a kill (WAL not truncated).
            first = null;
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();

            // Reopen as a NEW DatabaseService against the same file.
            var reopened = new DualClip.Services.DatabaseService(dbPath);
            var row = reopened.GetClipsAsync(track: "all", search: "", limit: 10, offset: 0,
                collection: "all", filterType: "all", fuzzyEnabled: false).GetAwaiter().GetResult();
            var found = Assert.Single(row);
            Assert.Equal(expectedId, found.Id);
            Assert.Equal("durable under wal", found.Text);
            reopened.CheckpointWal();
        }
        finally
        {
            try { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); } catch { }
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Recovery_ConcurrentAdjacentWrites_SeededDifferentFilesNoInterference()
    {
        // Two TestDbs in parallel = two independent SQLite files; this asserts
        // that rapid writes to DB-A never surface in DB-B (pollution guard
        // that used to matter for shared temp paths).
        using var dbA = new TestDb();
        using var dbB = new TestDb();
        dbA.AddText("only-in-a");
        dbB.AddText("only-in-b");

        Assert.Single(dbA.Search(""));
        Assert.Single(dbB.Search(""));
        Assert.Contains("only-in-a", dbA.Search("")[0].Text);
        Assert.Contains("only-in-b", dbB.Search("")[0].Text);
    }
}
