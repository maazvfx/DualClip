using DualClip.Models;
using DualClip.Services;

namespace DualClip.Tests;

/// <summary>
/// Gives each test its own throwaway SQLite database so the suite never touches
/// the developer's real history and tests cannot leak state into one another.
///
/// The database lives in a per-instance temp directory that is deleted on
/// dispose. DatabaseService also spawns a startup safety backup and an FTS
/// backfill on construction, so we checkpoint and close cleanly before removing
/// the files.
/// </summary>
public sealed class TestDb : IDisposable
{
    private readonly string _dir;
    private bool _disposed;

    public string DbPath { get; }

    public DatabaseService Service { get; }

    public TestDb()
    {
        _dir = Path.Combine(Path.GetTempPath(), "dualclip-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
        DbPath = Path.Combine(_dir, "clips.db");
        Service = new DatabaseService(DbPath);
    }

    /// <summary>
    /// Waits until FTS5 reports ready.
    ///
    /// Note this only guarantees the fts_clips table exists with the current schema
    /// version. Tests that depend on rows being present in the index should not rely on
    /// this alone: the AFTER INSERT trigger covers later rows, but rows written before
    /// the table existed are indexed by a background backfill.
    /// </summary>
    public DatabaseService WaitForFts(TimeSpan? timeout = null)
    {
        var limit = timeout ?? TimeSpan.FromSeconds(10);
        var deadline = DateTime.UtcNow + limit;
        while (DateTime.UtcNow < deadline)
        {
            if (Service.IsFtsReady()) return Service;
            Thread.Sleep(25);
        }
        throw new TimeoutException(
            $"FTS5 did not become ready within {limit.TotalSeconds:0.#}s " +
            $"(available={Service.FtsAvailable}).");
    }

    /// <summary>Adds a text clip and returns its id.</summary>
    public long AddText(string text, string collection = "all", string nickname = "",
        string process = "test.exe", string title = "")
    {
        var (id, _) = Service.AddOrBump(text, "manual", process, title, collection);
        if (!string.IsNullOrEmpty(nickname)) Service.SetNickname(id, nickname);
        return id;
    }

    /// <summary>Adds an image clip using an uppercase SHA-256 hash, matching the capture convention.</summary>
    public long AddImage(string contentHash, string collection = "all")
    {
        var (id, _) = Service.AddOrBumpImage(
            contentHash,
            $"/tmp/{contentHash}.png",
            "data:image/png;base64,iVBORw0KGgo=",
            "100 x 50",
            "1 KB PNG",
            "manual",
            "screenshot.exe",
            "Screenshot",
            collection);
        return id;
    }

    /// <summary>Runs a synchronous search through the optimized engine.</summary>
    public List<ClipItem> Search(string query, string collection = "all",
        string filterType = "all", int limit = 150)
    {
        return Service.GetClipsAsync(
            track: "all",
            search: query,
            limit: limit,
            offset: 0,
            collection: collection,
            filterType: filterType,
            fuzzyEnabled: false).GetAwaiter().GetResult();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            // Fold the WAL back into the main file so nothing holds a handle open.
            Service.CheckpointWal();
        }
        catch { /* best effort */ }
        try
        {
            if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
        }
        catch { /* temp cleanup is best effort */ }
    }
}