using DualClip.Services;

namespace DualClip.Tests;

/// <summary>
/// History is capped by <c>MaxClips</c>. Previously the cap was enforced only when the
/// user changed the setting, so a long capture session could grow the database well past
/// the configured limit. Trimming now also runs during capture, amortized so the check
/// stays off the clipboard hot path.
/// </summary>
public class MaxClipsEnforcementTests
{
    [Fact]
    public void HistoryIsTrimmedToTheCapWithoutTouchingTheSetting()
    {
        using var db = new TestDb();
        const int cap = 10;

        // Capture far more than the cap. Nothing changes the MaxClips setting here, which
        // is exactly the case that previously grew without bound.
        for (int i = 0; i < 200; i++)
        {
            db.AddText($"clip number {i}");
            db.Service.EnforceMaxClipsIfNeeded(cap);
        }

        // Trimming is amortized, so the guarantee is that growth is BOUNDED by
        // cap + TrimCheckInterval rather than that it equals the cap at every instant.
        int bound = cap + (int)DatabaseService.TrimCheckInterval;
        int count = db.Search("", limit: 500).Count;
        Assert.True(count <= bound,
            $"history grew to {count}, past the bound of {bound}");
        Assert.True(count >= 1, "trimming removed everything");
    }

    [Fact]
    public void TrimReducesHistoryWhenExplicitlyRequested()
    {
        using var db = new TestDb();
        for (int i = 0; i < 40; i++) db.AddText($"clip {i}");

        db.Service.EnforceMaxClips(5);
        var afterTrim = db.Search("", limit: 500).Count;

        // The direct API trims immediately and exactly; only the amortized capture-time
        // path trades immediacy for a cheaper hot path.
        Assert.Equal(5, afterTrim);

        db.Service.EnforceMaxClips(5);
        Assert.Equal(afterTrim, db.Search("", limit: 500).Count);
    }

    [Fact]
    public void TrimRemovesTheOldestClipsAndKeepsTheNewest()
    {
        using var db = new TestDb();
        for (int i = 0; i < 40; i++) db.AddText($"clip {i}");

        db.Service.EnforceMaxClips(5);

        var remaining = db.Search("", limit: 500).Select(c => c.Preview).ToList();

        Assert.Equal(5, remaining.Count);
        Assert.Contains("clip 39", remaining);
        Assert.DoesNotContain("clip 0", remaining);
    }

    [Fact]
    public void TrimPreservesPinnedAndFavoritedClips()
    {
        using var db = new TestDb();
        var pinned = db.AddText("keep this pinned");
        var favorite = db.AddText("keep this favorite");
        db.Service.TogglePin(pinned);
        db.Service.ToggleFavorite(favorite);

        for (int i = 0; i < 40; i++) db.AddText($"filler {i}");
        db.Service.EnforceMaxClips(3);

        var remaining = db.Search("", limit: 500).Select(c => c.Preview).ToHashSet();

        Assert.Contains("keep this pinned", remaining);
        Assert.Contains("keep this favorite", remaining);
    }

    [Fact]
    public void TrimDeletesTrimmedImageFiles()
    {
        using var db = new TestDb();
        var images = new List<string>();
        long ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        for (int i = 0; i < 30; i++)
        {
            var path = Path.Combine(PathHelper.GetImagesFolder(), $"trim_{Guid.NewGuid():N}.png");
            File.WriteAllBytes(path, Convert.FromBase64String(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="));
            images.Add(path);
            InsertImage(db.DbPath, $"img{i}", path, ts + i, rank: ts + i);
        }

        db.Service.EnforceMaxClips(5);

        var surviving = db.Search("", limit: 500).Where(c => c.IsImage).ToList();
        Assert.Equal(5, surviving.Count);

        // Exactly the surviving rows may still have files; the rest must be gone.
        var survivorPaths = surviving.Select(c => c.ImagePath).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var p in images)
        {
            if (survivorPaths.Contains(p)) Assert.True(File.Exists(p));
            else Assert.False(File.Exists(p), $"trimmed image left behind: {Path.GetFileName(p)}");
        }

        foreach (var p in images) { try { File.Delete(p); } catch { } }
    }

    [Fact]
    public void NonPositiveCapIsIgnored()
    {
        using var db = new TestDb();
        for (int i = 0; i < 40; i++) db.AddText($"clip {i}");

        db.Service.EnforceMaxClipsIfNeeded(0);

        Assert.Equal(40, db.Search("", limit: 500).Count);
    }

    private static void InsertImage(string dbPath, string tag, string imagePath, long ts, long rank)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO clips
              (text_content, preview, content_hash, track, collection, is_image, image_path,
               src_process, src_title, pinned, favorite, nickname, created_at, last_used_at, sort_rank, use_count)
            VALUES ($t, $t, $h, 'manual', 'all', 1, $ip, 't.exe', 'T', 0, 0, '', $ts, $ts, $rank, 0);";
        cmd.Parameters.AddWithValue("$t", tag);
        cmd.Parameters.AddWithValue("$h", "H_" + tag);
        cmd.Parameters.AddWithValue("$ip", imagePath);
        cmd.Parameters.AddWithValue("$ts", ts);
        cmd.Parameters.AddWithValue("$rank", rank);
        cmd.ExecuteNonQuery();
    }
}