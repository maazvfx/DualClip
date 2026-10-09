using System.Drawing;
using System.Security.Cryptography;
using DualClip.Models;
using DualClip.Services;
using Microsoft.Data.Sqlite;

namespace DualClip.Tests;

/// <summary>
/// Clear History is destructive and irreversible from the user's point of view, so the
/// deletion engine is verified across the full checkbox matrix.
///
/// Semantics under test: Pinned and Favorites are independent, explicit scopes - ticking
/// either deletes matching clips outright, including clips that are both pinned and
/// favorited. Main History and Images are broad scopes and skip anything the user protected
/// by leaving Pinned or Favorites unticked.
///
/// Every case asserts BOTH the surviving database rows and the surviving PNG files, since a
/// correct row delete with a leaked file is still a bug.
/// </summary>
public class ClearHistoryScopeTests
{
    private sealed record Shape(string Name, bool IsImage, bool Pinned, bool Favorite);

    private static readonly Shape[] Shapes =
    {
        new("plain",         false, false, false),
        new("fav",           false, false, true),
        new("pinned",        false, true,  false),
        new("pinned_fav",    false, true,  true),
        new("image",         true,  false, false),
        new("image_fav",     true,  false, true),
        new("image_pinned",  true,  true,  false),
        new("image_pin_fav", true,  true,  true),
    };

    /// <summary>Expected outcome, written independently of the SQL under test.</summary>
    private static bool ShouldDelete(Shape s, bool main, bool images, bool pinned, bool favorites)
    {
        if (favorites && s.Favorite) return true;
        if (pinned && s.Pinned) return true;
        if (images && s.IsImage && !s.Pinned && !s.Favorite) return true;
        if (main && !s.IsImage && !s.Pinned && !s.Favorite) return true;
        return false;
    }

    public static IEnumerable<object[]> ScopeMatrix()
    {
        foreach (var main in new[] { false, true })
        foreach (var images in new[] { false, true })
        foreach (var pinned in new[] { false, true })
        foreach (var fav in new[] { false, true })
        {
            if (!main && !images && !pinned && !fav) continue;
            yield return new object[] { main, images, pinned, fav };
        }
    }

    [Theory]
    [MemberData(nameof(ScopeMatrix))]
    public void DeletesStrictlyWhatWasSelected(bool main, bool images, bool pinned, bool favorites)
    {
        using var db = new TestDb();
        var files = SeedAllShapes(db);

        db.Service.ClearHistory(
            includePinned: pinned,
            excludedCollections: null,
            keepStarred: !favorites,
            deleteUnpinned: main,
            deleteImages: images);

        var survivors = db.Search("").Select(c => c.Preview).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var expected = Shapes
            .Where(s => !ShouldDelete(s, main, images, pinned, favorites))
            .Select(s => s.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.Equal(expected, survivors);

        // Files must agree with the rows: a surviving image clip keeps its PNG, and a
        // deleted one leaves nothing behind.
        foreach (var s in Shapes.Where(s => s.IsImage))
        {
            bool exists = File.Exists(files[s.Name]);
            if (survivors.Contains(s.Name)) Assert.True(exists, $"{s.Name}: row survived but PNG was deleted");
            else Assert.False(exists, $"{s.Name}: row deleted but PNG was orphaned");
        }
    }

    [Fact]
    public void FavoritesAloneDeletesPinnedFavorites()
    {
        // The regression this suite exists for: selecting only Favorites used to spare
        // pinned favorites, and produced no matching predicate at all.
        using var db = new TestDb();
        SeedAllShapes(db);

        db.Service.ClearHistory(
            includePinned: false,
            excludedCollections: null,
            keepStarred: false,
            deleteUnpinned: false,
            deleteImages: false);

        var survivors = db.Search("").Select(c => c.Preview).ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.DoesNotContain("pinned_fav", survivors);
        Assert.DoesNotContain("image_pin_fav", survivors);
        Assert.DoesNotContain("fav", survivors);
        Assert.DoesNotContain("image_fav", survivors);
        // Unrelated shapes must survive an explicit Favorites-only clear.
        Assert.Contains("plain", survivors);
        Assert.Contains("pinned", survivors);
    }

    [Fact]
    public void PinnedAloneDeletesPinnedFavorites()
    {
        using var db = new TestDb();
        SeedAllShapes(db);

        db.Service.ClearHistory(
            includePinned: true,
            excludedCollections: null,
            keepStarred: true,
            deleteUnpinned: false,
            deleteImages: false);

        var survivors = db.Search("").Select(c => c.Preview).ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.DoesNotContain("pinned_fav", survivors);
        Assert.DoesNotContain("image_pin_fav", survivors);
        Assert.Contains("fav", survivors);
        Assert.Contains("plain", survivors);
    }

    [Fact]
    public void BroadScopesProtectPinnedAndFavorites()
    {
        using var db = new TestDb();
        SeedAllShapes(db);

        db.Service.ClearHistory(
            includePinned: false,
            excludedCollections: null,
            keepStarred: true,
            deleteUnpinned: true,
            deleteImages: true);

        var survivors = db.Search("").Select(c => c.Preview).ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.Equal(new[] { "fav", "image_fav", "image_pin_fav", "image_pinned", "pinned", "pinned_fav" },
            survivors.OrderBy(x => x, StringComparer.Ordinal));
    }

    [Fact]
    public void ImageSharedByTwoClipsIsNotDeleted()
    {
        using var db = new TestDb();
        var path = WritePng("shared.png");

        long ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        InsertImage(db.DbPath, "shared_fav", path, ts, pinned: 0, favorite: 1);
        InsertImage(db.DbPath, "shared_pin", path, ts, pinned: 1, favorite: 0);

        // Delete the favorite; the pinned row still references the file.
        db.Service.ClearHistory(false, null, keepStarred: false, deleteUnpinned: false, deleteImages: false);

        Assert.True(File.Exists(path), "PNG deleted while another clip still references it");
        Cleanup(path);
    }

    [Fact]
    public void SingleDeleteKeepsPngForUndo()
    {
        using var db = new TestDb();
        var path = WritePng("undo.png");
        long ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        InsertImage(db.DbPath, "undo_row", path, ts, pinned: 0, favorite: 0);

        long id = ScalarLong(db.DbPath, "SELECT id FROM clips WHERE preview = 'undo_row'");
        db.Service.DeleteClip(id);

        // The UI offers Undo after a single delete and RestoreClip needs the file present.
        Assert.True(File.Exists(path));
        Cleanup(path);
    }

    [Fact]
    public void MaxClipsTrimmingRemovesTrimmedPng()
    {
        using var db = new TestDb();
        var keepImg = WritePng("keep.png");
        var dropImg = WritePng("drop.png");
        long ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // Trimming orders by sort_rank DESC and keeps the top N, so the row that should survive
        // needs the higher rank. Equal ranks would fall back to id DESC.
        InsertImage(db.DbPath, "keep_row", keepImg, ts + 100, 0, 0, rank: ts + 100);
        InsertImage(db.DbPath, "drop_row", dropImg, ts, 0, 0, rank: ts);

        db.Service.EnforceMaxClips(1);

        Assert.False(File.Exists(dropImg), "trimmed row left its PNG behind");
        Assert.True(File.Exists(keepImg), "surviving row lost its PNG");
        Cleanup(keepImg);
        Cleanup(dropImg);
    }

    // ------------------------------------------------------------------ helpers

    private static Dictionary<string, string> SeedAllShapes(TestDb db)
    {
        var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        long ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        foreach (var s in Shapes)
        {
            if (s.IsImage)
            {
                var path = WritePng($"{s.Name}.png");
                files[s.Name] = path;
                InsertImage(db.DbPath, s.Name, path, ts, s.Pinned ? 1 : 0, s.Favorite ? 1 : 0);
            }
            else
            {
                InsertText(db.DbPath, s.Name, ts, s.Pinned ? 1 : 0, s.Favorite ? 1 : 0);
            }
        }
        return files;
    }

    private static string WritePng(string name)
    {
        var dir = PathHelper.GetImagesFolder();
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"test_{Guid.NewGuid():N}_{name}");
        File.WriteAllBytes(path, Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="));
        return path;
    }

    private static void InsertText(string dbPath, string tag, long ts, int pinned, int favorite)
        => Insert(dbPath, tag, false, "", ts, pinned, favorite, rank: 0);

    private static void InsertImage(string dbPath, string tag, string imagePath, long ts, int pinned, int favorite, long rank = 0)
        => Insert(dbPath, tag, true, imagePath, ts, pinned, favorite, rank);

    private static void Insert(string dbPath, string tag, bool isImage, string imagePath,
                               long ts, int pinned, int favorite, long rank)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO clips
              (text_content, preview, content_hash, track, collection, is_image, image_path,
               src_process, src_title, pinned, favorite, nickname, created_at, last_used_at, sort_rank, use_count)
            VALUES ($t, $t, $h, 'manual', 'all', $img, $ip, 't.exe', 'T', $pin, $fav, '', $ts, $ts, $rank, 0);";
        cmd.Parameters.AddWithValue("$t", tag);
        cmd.Parameters.AddWithValue("$h", "H_" + tag);
        cmd.Parameters.AddWithValue("$img", isImage ? 1 : 0);
        cmd.Parameters.AddWithValue("$ip", imagePath);
        cmd.Parameters.AddWithValue("$pin", pinned);
        cmd.Parameters.AddWithValue("$fav", favorite);
        cmd.Parameters.AddWithValue("$ts", ts);
        cmd.Parameters.AddWithValue("$rank", rank);
        cmd.ExecuteNonQuery();
    }

    private static long ScalarLong(string dbPath, string sql)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static void Cleanup(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* best effort */ }
    }
}