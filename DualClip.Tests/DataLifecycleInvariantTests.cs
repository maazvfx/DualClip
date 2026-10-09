using System.Reflection;
using DualClip.Models;
using DualClip.Services;
using Microsoft.Data.Sqlite;

namespace DualClip.Tests;

// Backend data-lifecycle invariants: backup snapshots, restore safety,
// retention expiry, vault-process suppression, and import accounting.
// Every test runs against an isolated TestDb in a throwaway temp directory
// (backups land in a temp "backups" sibling, never the real profile).
public class DataLifecycleInvariantTests
{
    private static void BackdateClipDays(string dbPath, long clipId, int daysAgo)
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-daysAgo).ToUnixTimeSeconds();
        using var conn = new SqliteConnection(
            new SqliteConnectionStringBuilder
            {
                DataSource = dbPath,
                Pooling = false
            }.ToString());
        conn.Open();
        using var pragma = conn.CreateCommand();
        pragma.CommandText = "PRAGMA busy_timeout=5000;";
        pragma.ExecuteNonQuery();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE clips SET created_at = $ts WHERE id = $id;";
        cmd.Parameters.AddWithValue("$ts", cutoff);
        cmd.Parameters.AddWithValue("$id", clipId);
        Assert.Equal(1, cmd.ExecuteNonQuery());
    }

    private static bool CallIsVaultProcess(string proc, string title, string? fullPath)
    {
        var method = typeof(ClipboardListener).GetMethod(
            "IsVaultProcess", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);
        return (bool)method.Invoke(null, new object?[] { proc, title, fullPath })!;
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Backup_CreatesVerifiableSnapshotFile()
    {
        using var db = new TestDb();
        db.AddText("snapshot me");
        db.Service.CheckpointWal();

        var backup = db.Service.CreateBackup("test_snapshot");

        Assert.NotNull(backup);
        Assert.Null(db.Service.LastBackupError);
        Assert.True(File.Exists(backup.FilePath));
        Assert.True(new FileInfo(backup.FilePath).Length > 0);
        Assert.Contains(db.Service.ListBackups(), b => b.FilePath == backup.FilePath);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void WalMode_StaysEnabledWithCheckpointFoldingCleanly()
    {
        using var db = new TestDb();
        db.AddText("wal one");
        db.AddText("wal two");
        db.Service.CheckpointWal();

        using var conn = new SqliteConnection(
            new SqliteConnectionStringBuilder { DataSource = db.DbPath, Pooling = false }.ToString());
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode;";
        var mode = cmd.ExecuteScalar()?.ToString();

        Assert.Equal("wal", mode?.ToLowerInvariant());
        // A post-write backup runs quick_check internally: success proves the
        // WAL content folded into a verifiable snapshot.
        Assert.NotNull(db.Service.CreateBackup("test_wal"));
        Assert.Null(db.Service.LastBackupError);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Backup_PrunesRollingSnapshotsToFive()
    {
        using var db = new TestDb();
        db.AddText("prune me");
        for (int i = 0; i < 7; i++)
        {
            Assert.NotNull(db.Service.CreateBackup($"test_prune_{i}"));
        }

        var list = db.Service.ListBackups();
        Assert.Equal(5, list.Count);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Restore_RoundTrip_RestoresSnapshotState()
    {
        using var db = new TestDb();
        long idA = db.AddText("snapshot alpha");
        var backup = db.Service.CreateBackup("test_roundtrip");
        Assert.NotNull(backup);
        long idB = db.AddText("snapshot beta");

        Assert.True(db.Service.RestoreFromBackup(backup.FilePath));
        Assert.Null(db.Service.LastRestoreError);
        Assert.NotNull(db.Service.GetClipById(idA));
        Assert.Null(db.Service.GetClipById(idB));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Restore_RejectsGarbageFile()
    {
        using var db = new TestDb();
        string junk = Path.Combine(Path.GetTempPath(), $"dualclip-junk-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllText(junk, "this is not a sqlite database at all");
            Assert.False(db.Service.RestoreFromBackup(junk));
            Assert.Equal("integrity_check_failed", db.Service.LastRestoreError);
        }
        finally
        {
            try { File.Delete(junk); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Restore_RejectsValidSqliteWithoutDualClipSchema()
    {
        using var db = new TestDb();
        string other = Path.Combine(Path.GetTempPath(), $"dualclip-other-{Guid.NewGuid():N}.db");
        try
        {
            using (var conn = new SqliteConnection(
                new SqliteConnectionStringBuilder { DataSource = other, Pooling = false }.ToString()))
            {
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "CREATE TABLE other_stuff (x TEXT); INSERT INTO other_stuff VALUES ('hi');";
                cmd.ExecuteNonQuery();
            }
            SqliteConnection.ClearAllPools();
            Assert.False(db.Service.RestoreFromBackup(other));
            Assert.Equal("invalid_schema", db.Service.LastRestoreError);
        }
        finally
        {
            try { File.Delete(other); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Restore_MissingFile_ReturnsFileNotFound()
    {
        using var db = new TestDb();
        string missing = Path.Combine(Path.GetTempPath(), $"dualclip-missing-{Guid.NewGuid():N}.db");
        Assert.False(db.Service.RestoreFromBackup(missing));
        Assert.Equal("file_not_found", db.Service.LastRestoreError);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void AutoExpire_DeletesOnlyClipsOlderThanRetention()
    {
        using var db = new TestDb();
        long old1 = db.AddText("expire old one");
        long old2 = db.AddText("expire old two");
        long fresh = db.AddText("expire fresh");
        BackdateClipDays(db.DbPath, old1, 40);
        BackdateClipDays(db.DbPath, old2, 45);

        Assert.True(db.Service.ClearHistoryAdvanced(olderThanDays: 30));

        Assert.Null(db.Service.GetClipById(old1));
        Assert.Null(db.Service.GetClipById(old2));
        Assert.NotNull(db.Service.GetClipById(fresh));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SetCollectionParent_PersistsToSqliteAndSurvivesReload()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("np", "Parent", false, 0);
        db.Service.SaveCollection("nc", "Child", false, 1);
        Assert.True(db.Service.SetCollectionParent("nc", "np"));
        db.Service.CheckpointWal();

        // Simulate an app reload: read the parent link straight from SQLite,
        // bypassing any in-memory state, like a fresh launch hydrate would.
        using (var conn = new SqliteConnection(
            new SqliteConnectionStringBuilder { DataSource = db.DbPath, Pooling = false }.ToString()))
        {
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT parent_id FROM collections WHERE id = 'nc';";
            Assert.Equal("np", cmd.ExecuteScalar()?.ToString());
        }
        SqliteConnection.ClearAllPools();
    }

    [Theory]
    [Trait("Category", "Core")]
    [InlineData("bitwarden.exe", "Bitwarden", null, true)]
    [InlineData("keepassxc.exe", "", null, true)]
    [InlineData("1password.exe", "1Password", null, true)]
    [InlineData("chrome.exe", "My Vault Passwords", null, true)]
    [InlineData("KeePass.exe", "notes", "C:\\Tools\\KeePass\\KeePass.exe", true)]
    [InlineData("notepad.exe", "Untitled", null, false)]
    [InlineData("chrome.exe", "GitHub - pull requests", "C:\\Program Files\\Chrome\\chrome.exe", false)]
    public void VaultSuppression_ClassifiesPasswordManagers(
        string proc, string title, string? fullPath, bool expected)
    {
        Assert.Equal(expected, CallIsVaultProcess(proc, title, fullPath));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Import_SkipsImagesWithoutPathAndCountsThem()
    {
        using var db = new TestDb();
        var items = new List<ClipItem>
        {
            new() { Text = "hello import", Preview = "hello import", Collection = "all" },
            new() { IsImage = true, ImagePath = "", Text = "orphan image", Collection = "all" }
        };

        var (imported, _, skipped, skippedImages) = db.Service.ImportPackageBatch(items, null);

        Assert.Equal(1, imported);
        Assert.Equal(1, skippedImages);
        Assert.Equal(0, skipped);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Import_DedupesIdenticalImageHash()
    {
        using var db = new TestDb();
        string hash = new string('A', 64);
        List<ClipItem> Items() => new()
        {
            new() { IsImage = true, ImagePath = "/tmp/img.png", Text = hash, Preview = "[Image]", Collection = "all" }
        };

        var (imported, deduped, _, _) = db.Service.ImportPackageBatch(Items(), null);
        Assert.Equal(1, imported);
        Assert.Equal(0, deduped);

        var (imported2, deduped2, _, _) = db.Service.ImportPackageBatch(Items(), null);
        Assert.Equal(0, imported2);
        Assert.Equal(1, deduped2);
    }
}
