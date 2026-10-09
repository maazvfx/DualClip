using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace DualClip.Services;

public class BackupFileInfo
{
    public string FilePath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public string Reason { get; set; } = string.Empty;
}

public partial class DatabaseService
{
    private const int MaxRollingBackups = 5;
    private static readonly object _backupGate = new();

    public string? LastBackupError { get; private set; }
    public string? LastRestoreError { get; private set; }

    public string GetDbPath()
    {
        var csb = new SqliteConnectionStringBuilder(_connectionString);
        return csb.DataSource;
    }

    public string GetBackupDirectory()
    {
        var dbPath = GetDbPath();
        var dir = Path.GetDirectoryName(dbPath) ?? string.Empty;
        var parent = Directory.GetParent(dir)?.FullName ?? dir;
        var backupDir = Path.Combine(parent, "backups");
        if (!Directory.Exists(backupDir))
        {
            Directory.CreateDirectory(backupDir);
        }
        return backupDir;
    }

    public string GetSentinelFilePath()
    {
        var dbPath = GetDbPath();
        var dir = Path.GetDirectoryName(dbPath) ?? string.Empty;
        return Path.Combine(dir, ".session_active");
    }

    public void MarkSessionActive()
    {
        try
        {
            var sentinel = GetSentinelFilePath();
            File.WriteAllText(sentinel, DateTime.UtcNow.ToString("O"));
        }
        catch { }
    }

    public void MarkSessionCleanExit()
    {
        try
        {
            var sentinel = GetSentinelFilePath();
            if (File.Exists(sentinel))
            {
                File.Delete(sentinel);
            }
        }
        catch { }
    }

    public void CheckpointWal()
    {
        lock (_gate)
        {
            try
            {
                using var conn = new SqliteConnection(_connectionString);
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "PRAGMA wal_checkpoint(TRUNCATE);";
                cmd.ExecuteNonQuery();
            }
            catch { }
        }
    }

    public bool HadDirtyShutdown()
    {
        try
        {
            var sentinel = GetSentinelFilePath();
            return File.Exists(sentinel);
        }
        catch
        {
            return false;
        }
    }

    public Task TriggerStartupSafetyBackupAsync()
    {
        return Task.Run(() =>
        {
            try
            {
                bool dirty = HadDirtyShutdown();
                string reason = dirty ? "crash_recovery" : "startup";
                
                // If dirty shutdown was detected, verify current DB integrity first
                if (dirty)
                {
                    VerifyDatabaseIntegrity();
                }

                // Full startup integrity routine (quick_check + integrity_check).
                // Corrupt-at-launch rotation already happened synchronously in the
                // ctor pre-flight; this background pass is monitoring only and
                // never rotates a live database.
                try { RunStartupIntegrityChecks(); } catch { }

                CreateBackup(reason);
                MaybeCreateWeeklySnapshot();
                MarkSessionActive();
            }
            catch
            {
                // Safety backups are non-blocking and fail-safe
            }
        });
    }

    public bool VerifyDatabaseIntegrity()
    {
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "PRAGMA quick_check;";
            var res = cmd.ExecuteScalar()?.ToString();
            return string.Equals(res, "ok", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Startup integrity routine: fast <c>quick_check</c> first, then the
    /// thorough <c>integrity_check</c>. Returns true only when both report ok.
    /// Any exception (busy, locked, I/O) counts as failure without throwing.
    /// </summary>
    public bool RunStartupIntegrityChecks()
    {
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var quick = conn.CreateCommand();
            quick.CommandText = "PRAGMA quick_check;";
            quick.CommandTimeout = 120;
            var quickRes = quick.ExecuteScalar()?.ToString();
            if (!string.Equals(quickRes, "ok", StringComparison.OrdinalIgnoreCase))
                return false;
            using var full = conn.CreateCommand();
            full.CommandText = "PRAGMA integrity_check;";
            full.CommandTimeout = 120;
            var fullRes = full.ExecuteScalar()?.ToString();
            return string.Equals(fullRes, "ok", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    internal static bool IsCorruptionError(SqliteException ex)
    {
        return ex.SqliteErrorCode == 11 /* SQLITE_CORRUPT */
            || ex.SqliteErrorCode == 26 /* SQLITE_NOTADB */;
    }

    /// <summary>
    /// Rotates a corrupt database plus its WAL/SHM/journal sidecars to
    /// <c>clips_corrupt_&lt;timestamp&gt;.db*</c> in the same folder so the
    /// next init starts clean. Never throws; returns the rotated main path or null.
    /// </summary>
    public string? RotateCorruptDatabase()
    {
        lock (_gate)
        {
            try
            {
                try { SqliteConnection.ClearAllPools(); } catch { }
                try { Thread.Sleep(50); } catch { }
                var dbPath = GetDbPath();
                if (!File.Exists(dbPath)) return null;
                var dir = Path.GetDirectoryName(dbPath) ?? string.Empty;
                var ts = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
                var target = Path.Combine(dir, $"clips_corrupt_{ts}.db");
                int dup = 0;
                while (File.Exists(target) && dup < 100)
                {
                    dup++;
                    target = Path.Combine(dir, $"clips_corrupt_{ts}_{dup}.db");
                }
                File.Move(dbPath, target);
                foreach (var suffix in new[] { "-wal", "-shm", "-journal" })
                {
                    try
                    {
                        var side = dbPath + suffix;
                        if (File.Exists(side)) File.Move(side, target + suffix, overwrite: true);
                    }
                    catch { }
                }
                return target;
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Clean-exit maintenance: safe WAL checkpoint then best-effort VACUUM to
    /// reclaim free pages after sudden-termination growth. Never throws.
    /// </summary>
    public void ShutdownMaintenance()
    {
        lock (_gate)
        {
            try
            {
                using var conn = new SqliteConnection(_connectionString);
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "PRAGMA wal_checkpoint(TRUNCATE);";
                cmd.ExecuteNonQuery();
            }
            catch { }
            try
            {
                var dbPath = GetDbPath();
                if (!File.Exists(dbPath)) return;
                using var conn = new SqliteConnection(_connectionString);
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "VACUUM;";
                cmd.CommandTimeout = 300;
                cmd.ExecuteNonQuery();
            }
            catch { }
        }
    }

    private const int MaxWeeklySnapshots = 3;

    /// <summary>
    /// Creates a <c>clips_weekly_*.db</c> snapshot when no snapshot newer than
    /// 7 days exists. Non-blocking wrapper around <see cref="CreateWeeklySnapshot"/>.
    /// </summary>
    public void MaybeCreateWeeklySnapshot()
    {
        try
        {
            var backupDir = GetBackupDirectory();
            var latest = new DirectoryInfo(backupDir).GetFiles("clips_weekly_*.db")
                .OrderByDescending(f => f.CreationTimeUtc)
                .FirstOrDefault();
            if (latest != null && (DateTime.UtcNow - latest.CreationTimeUtc).TotalDays < 7)
                return;
            CreateWeeklySnapshot();
        }
        catch { }
    }

    /// <summary>
    /// Weekly clean snapshot via the SQLite online backup API with its own
    /// keep-3 rotation. DB file only (no images copy) to bound disk usage;
    /// restore tolerates a missing images snapshot. Rolling
    /// <c>clips_backup_*</c> logic is untouched.
    /// </summary>
    public BackupFileInfo? CreateWeeklySnapshot()
    {
        lock (_backupGate)
        {
            var dbPath = GetDbPath();
            if (!File.Exists(dbPath)) return null;
            var backupDir = GetBackupDirectory();
            var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
            var fileName = $"clips_weekly_{timestamp}.db";
            var finalPath = Path.Combine(backupDir, fileName);
            var tempPath = Path.Combine(backupDir, $"{fileName}.{Guid.NewGuid():N}.tmp");
            try
            {
                if (!TryDeleteFile(tempPath)) return null;
                var destConnStr = new SqliteConnectionStringBuilder
                {
                    DataSource = tempPath,
                    Mode = SqliteOpenMode.ReadWriteCreate,
                    Pooling = false
                }.ToString();
                using (var sourceConn = new SqliteConnection(_connectionString))
                using (var destConn = new SqliteConnection(destConnStr))
                {
                    sourceConn.Open();
                    destConn.Open();
                    sourceConn.BackupDatabase(destConn);
                    using var verifyCmd = destConn.CreateCommand();
                    verifyCmd.CommandText = "PRAGMA quick_check;";
                    var verifyResult = verifyCmd.ExecuteScalar()?.ToString();
                    destConn.Close();
                    SqliteConnection.ClearPool(destConn);
                    if (!string.Equals(verifyResult, "ok", StringComparison.OrdinalIgnoreCase))
                    {
                        TryDeleteFile(tempPath);
                        return null;
                    }
                }
                if (File.Exists(finalPath) && !TryDeleteFile(finalPath))
                {
                    TryDeleteFile(tempPath);
                    return null;
                }
                if (!TryFileOpWithRetry(() => { File.Move(tempPath, finalPath); return true; }))
                {
                    TryDeleteFile(tempPath);
                    return null;
                }
                PruneWeeklySnapshots(backupDir, MaxWeeklySnapshots);
                var info = new FileInfo(finalPath);
                return new BackupFileInfo
                {
                    FilePath = finalPath,
                    FileName = fileName,
                    SizeBytes = info.Length,
                    CreatedAtUtc = info.CreationTimeUtc,
                    Reason = "weekly"
                };
            }
            catch
            {
                TryDeleteFile(tempPath);
                return null;
            }
        }
    }

    private static void PruneWeeklySnapshots(string backupDir, int keepCount)
    {
        try
        {
            var snaps = new DirectoryInfo(backupDir).GetFiles("clips_weekly_*.db")
                .OrderByDescending(f => f.CreationTimeUtc)
                .ToList();
            if (snaps.Count > keepCount)
            {
                foreach (var f in snaps.Skip(keepCount))
                {
                    try { f.Delete(); } catch { }
                }
            }
        }
        catch { }
    }

    // Best-effort file delete/move with backoff for transient AV/indexer locks.
    private static bool TryFileOpWithRetry(Func<bool> op, int attempts = 3)
    {
        for (int i = 0; i < attempts; i++)
        {
            try
            {
                if (op()) return true;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            if (i < attempts - 1)
            {
                try { Thread.Sleep(100 * (i + 1)); } catch { }
            }
        }
        return false;
    }

    private static bool TryDeleteFile(string path)
    {
        if (string.IsNullOrEmpty(path)) return true;
        try { if (File.Exists(path + "-shm")) TryFileOpWithRetry(() => { File.Delete(path + "-shm"); return true; }); } catch { }
        try { if (File.Exists(path + "-wal")) TryFileOpWithRetry(() => { File.Delete(path + "-wal"); return true; }); } catch { }
        if (!File.Exists(path)) return true;
        return TryFileOpWithRetry(() => { File.Delete(path); return true; });
    }

    public BackupFileInfo? CreateBackup(string reason = "manual")
    {
        LastBackupError = null;
        lock (_backupGate)
        {
            var dbPath = GetDbPath();
            if (!File.Exists(dbPath)) { LastBackupError = "database_missing"; return null; }

            var backupDir = GetBackupDirectory();
            var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
            var cleanReason = string.IsNullOrWhiteSpace(reason) ? "manual" : reason.Trim().ToLowerInvariant();
            var finalFileName = $"clips_backup_{timestamp}_{cleanReason}.db";
            var finalFilePath = Path.Combine(backupDir, finalFileName);
            // Unique temp name per attempt: same-second concurrent backups must
            // never share (and fight over) one .tmp file.
            var tempFilePath = Path.Combine(backupDir, $"{finalFileName}.{Guid.NewGuid():N}.tmp");

            try
            {
                // 1. Check available disk space (require at least 50MB or 2x current DB size)
                var dbInfo = new FileInfo(dbPath);
                var requiredBytes = Math.Max(50 * 1024 * 1024, dbInfo.Length * 2);
                var driveInfo = new DriveInfo(Path.GetPathRoot(backupDir) ?? "C:\\");
                if (driveInfo.AvailableFreeSpace < requiredBytes)
                {
                    LastBackupError = "insufficient_disk_space";
                    return null; // Insufficient disk space
                }

                // 2. Perform SQLite Online Backup to .tmp file
                if (!TryDeleteFile(tempFilePath))
                {
                    LastBackupError = "backup_temp_locked";
                    return null;
                }

                var destConnStr = new SqliteConnectionStringBuilder
                {
                    DataSource = tempFilePath,
                    Mode = SqliteOpenMode.ReadWriteCreate,
                    Pooling = false
                }.ToString();

                using (var sourceConn = new SqliteConnection(_connectionString))
                using (var destConn = new SqliteConnection(destConnStr))
                {
                    sourceConn.Open();
                    destConn.Open();

                    // SQLite online backup API folds WAL content cleanly without locking
                    sourceConn.BackupDatabase(destConn);

                    // 3. Run quick integrity check on the newly created backup
                    using var verifyCmd = destConn.CreateCommand();
                    verifyCmd.CommandText = "PRAGMA quick_check;";
                    var verifyResult = verifyCmd.ExecuteScalar()?.ToString();

                    destConn.Close();
                    SqliteConnection.ClearPool(destConn);

                    if (!string.Equals(verifyResult, "ok", StringComparison.OrdinalIgnoreCase))
                    {
                        TryDeleteFile(tempFilePath);
                        LastBackupError = "integrity_check_failed";
                        return null; // Backup verification failed
                    }
                }

                // 4. Atomically rename .tmp to final .db (retried against AV locks)
                if (File.Exists(finalFilePath) && !TryDeleteFile(finalFilePath))
                {
                    TryDeleteFile(tempFilePath);
                    LastBackupError = "backup_final_locked";
                    return null;
                }
                if (!TryFileOpWithRetry(() => { File.Move(tempFilePath, finalFilePath); return true; }))
                {
                    TryDeleteFile(tempFilePath);
                    LastBackupError = "backup_final_locked";
                    return null;
                }

                // Snapshot images folder if images exist
                try
                {
                    var imagesFolder = PathHelper.GetImagesFolder();
                    if (Directory.Exists(imagesFolder))
                    {
                        var backupImagesDir = Path.Combine(backupDir, $"{Path.GetFileNameWithoutExtension(finalFileName)}_images");
                        if (Directory.Exists(backupImagesDir)) Directory.Delete(backupImagesDir, true);
                        Directory.CreateDirectory(backupImagesDir);

                        var di = new DirectoryInfo(imagesFolder);
                        int copied = 0, failed = 0;
                        foreach (var file in di.EnumerateFiles())
                        {
                            try
                            {
                                file.CopyTo(Path.Combine(backupImagesDir, file.Name), true);
                                copied++;
                            }
                            catch
                            {
                                failed++;
                            }
                        }
                        if (failed > 0)
                        {
                            System.Diagnostics.Debug.WriteLine($"[Backup] Images snapshot: {copied} copied, {failed} skipped.");
                        }
                    }
                }
                catch { }

                // 5. Clean up older backups, retaining the most recent MaxRollingBackups
                PruneOldBackups(backupDir, MaxRollingBackups);

                var resultInfo = new FileInfo(finalFilePath);
                return new BackupFileInfo
                {
                    FilePath = finalFilePath,
                    FileName = finalFileName,
                    SizeBytes = resultInfo.Length,
                    CreatedAtUtc = resultInfo.CreationTimeUtc,
                    Reason = cleanReason
                };
            }
            catch (Exception ex)
            {
                TryDeleteFile(tempFilePath);
                LastBackupError = $"backup_failed: {ex.Message}";
                return null;
            }
        }
    }

    private static void PruneOldBackups(string backupDir, int keepCount)
    {
        try
        {
            var dir = new DirectoryInfo(backupDir);

            // Clean up stale temporary files left by unexpected process kills
            var staleCutoff = DateTime.UtcNow.AddMinutes(-1);
            foreach (var tmp in dir.EnumerateFiles("*.tmp*"))
            {
                if (tmp.CreationTimeUtc < staleCutoff)
                {
                    try { tmp.Delete(); } catch { }
                }
            }

            var backupFiles = dir.GetFiles("clips_backup_*.db")
                                 .OrderByDescending(f => f.CreationTimeUtc)
                                 .ToList();

            if (backupFiles.Count > keepCount)
            {
                var filesToDelete = backupFiles.Skip(keepCount);
                foreach (var f in filesToDelete)
                {
                    try { f.Delete(); } catch { }
                    try
                    {
                        var imgDir = Path.Combine(backupDir, $"{Path.GetFileNameWithoutExtension(f.Name)}_images");
                        if (Directory.Exists(imgDir)) Directory.Delete(imgDir, true);
                    }
                    catch { }
                }
            }
        }
        catch { }
    }

    public List<BackupFileInfo> ListBackups()
    {
        var list = new List<BackupFileInfo>();
        try
        {
            var backupDir = GetBackupDirectory();
            var dir = new DirectoryInfo(backupDir);
            var files = dir.GetFiles("clips_backup_*.db")
                           .OrderByDescending(f => f.CreationTimeUtc);

            foreach (var f in files)
            {
                var parts = Path.GetFileNameWithoutExtension(f.Name).Split('_');
                var reason = parts.Length > 4 ? string.Join("_", parts.Skip(4)) : (parts.Length == 4 ? parts[3] : "auto");
                list.Add(new BackupFileInfo
                {
                    FilePath = f.FullName,
                    FileName = f.Name,
                    SizeBytes = f.Length,
                    CreatedAtUtc = f.CreationTimeUtc,
                    Reason = reason
                });
            }
        }
        catch { }
        return list;
    }

    public bool RestoreFromBackup(string backupFilePath)
    {
        LastRestoreError = null;
        if (string.IsNullOrWhiteSpace(backupFilePath) || !File.Exists(backupFilePath))
        {
            LastRestoreError = "file_not_found";
            return false;
        }

        // 1. Verify target backup file integrity and DualClip schema before taking any locks
        try
        {
            var testConnStr = new SqliteConnectionStringBuilder
            {
                DataSource = backupFilePath,
                Mode = SqliteOpenMode.ReadOnly
            }.ToString();

            using (var testConn = new SqliteConnection(testConnStr))
            {
                testConn.Open();
                using var verifyCmd = testConn.CreateCommand();
                verifyCmd.CommandText = "PRAGMA quick_check;";
                var res = verifyCmd.ExecuteScalar()?.ToString();
                if (!string.Equals(res, "ok", StringComparison.OrdinalIgnoreCase))
                {
                    LastRestoreError = "integrity_check_failed";
                    return false; // Target backup is invalid SQLite DB
                }

                // Verify that the database contains the required DualClip schema
                using var schemaCmd = testConn.CreateCommand();
                schemaCmd.CommandText = @"
                    SELECT COUNT(*) 
                    FROM sqlite_master 
                    WHERE type='table' AND name='clips';";
                var tableCount = Convert.ToInt64(schemaCmd.ExecuteScalar() ?? 0);
                if (tableCount == 0)
                {
                    LastRestoreError = "invalid_schema";
                    return false; // Missing core 'clips' table
                }

                using var colsCmd = testConn.CreateCommand();
                colsCmd.CommandText = @"
                    SELECT COUNT(*) 
                    FROM pragma_table_info('clips') 
                    WHERE name IN ('content_hash', 'created_at', 'track');";
                var colCount = Convert.ToInt64(colsCmd.ExecuteScalar() ?? 0);
                if (colCount < 3)
                {
                    LastRestoreError = "invalid_schema";
                    return false; // Not a valid DualClip schema
                }
            }
        }
        catch
        {
            LastRestoreError = "integrity_check_failed";
            return false;
        }

        // 2. Acquire locks in standard hierarchy (_gate then _backupGate) to eliminate any deadlock risk
        bool restored = false;
        lock (_gate)
        {
            lock (_backupGate)
            {
                var dbPath = GetDbPath();
                var dbDir = Path.GetDirectoryName(dbPath) ?? string.Empty;
                var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
                var quarantinePath = Path.Combine(dbDir, $"clips_pre_restore_{timestamp}.db");
                var quarantineWalPath = Path.Combine(dbDir, $"clips_pre_restore_{timestamp}.db-wal");
                var quarantineShmPath = Path.Combine(dbDir, $"clips_pre_restore_{timestamp}.db-shm");
                var walPath = dbPath + "-wal";
                var shmPath = dbPath + "-shm";

                try
                {
                    // 3. Checkpoint WAL before disconnecting to ensure all live data is flushed
                    if (File.Exists(dbPath))
                    {
                        try
                        {
                            using var conn = new SqliteConnection(_connectionString);
                            conn.Open();
                            using var cmd = conn.CreateCommand();
                            cmd.CommandText = "PRAGMA wal_checkpoint(TRUNCATE);";
                            using var r = cmd.ExecuteReader();
                            if (r.Read())
                            {
                                int busy = r.GetInt32(0);
                                if (busy != 0)
                                {
                                    LastRestoreError = "database_busy";
                                    return false; // Database is busy, cannot safely restore right now
                                }
                            }
                        }
                        catch
                        {
                            LastRestoreError = "database_busy";
                            return false; // Checkpoint threw an error
                        }
                    }

                    // 4. Clear all connection pools to release file handles
                    SqliteConnection.ClearAllPools();
                    Thread.Sleep(50);

                    // 5. Quarantine existing DB, WAL and SHM files if they exist
                    if (File.Exists(dbPath))
                    {
                        File.Copy(dbPath, quarantinePath, overwrite: true);
                    }
                    if (File.Exists(walPath))
                    {
                        try { File.Copy(walPath, quarantineWalPath, overwrite: true); } catch { }
                    }
                    if (File.Exists(shmPath))
                    {
                        try { File.Copy(shmPath, quarantineShmPath, overwrite: true); } catch { }
                    }

                    // 6. Remove temporary WAL/SHM files
                    try { if (File.Exists(walPath)) File.Delete(walPath); } catch { }
                    try { if (File.Exists(shmPath)) File.Delete(shmPath); } catch { }

                    // 7. Copy verified backup into place via atomic temp replacement
                    var tempPath = dbPath + ".restore_tmp";
                    try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
                    File.Copy(backupFilePath, tempPath, overwrite: true);
                    var tempInfo = new FileInfo(tempPath);
                    if (!tempInfo.Exists || tempInfo.Length == 0)
                    {
                        try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
                        LastRestoreError = "restore_failed";
                        return false;
                    }
                    File.Move(tempPath, dbPath, overwrite: true);

                    // Restore corresponding images snapshot if present
                    try
                    {
                        var backupDir = Path.GetDirectoryName(backupFilePath) ?? string.Empty;
                        var backupImagesDir = Path.Combine(backupDir, $"{Path.GetFileNameWithoutExtension(backupFilePath)}_images");
                        var currentImagesFolder = PathHelper.GetImagesFolder();

                        if (Directory.Exists(backupImagesDir))
                        {
                            var bdi = new DirectoryInfo(backupImagesDir);
                            foreach (var file in bdi.EnumerateFiles())
                            {
                                try { file.CopyTo(Path.Combine(currentImagesFolder, file.Name), true); } catch { }
                            }
                        }
                    }
                    catch { }

                    // 8. Run schema initialization on restored DB to ensure all migrations / tables exist
                    InitializeDatabase();

                    // 9. Bump data generation
                    BumpDataGeneration();
                    restored = true;
                }
                catch
                {
                    LastRestoreError = "restore_failed";
                    restored = false;

                    // Roll back from quarantine if replacement or initialization failed
                    try
                    {
                        SqliteConnection.ClearAllPools();
                        Thread.Sleep(20);
                        if (File.Exists(quarantinePath))
                        {
                            File.Copy(quarantinePath, dbPath, overwrite: true);
                        }
                        if (File.Exists(quarantineWalPath))
                        {
                            File.Copy(quarantineWalPath, walPath, overwrite: true);
                        }
                        if (File.Exists(quarantineShmPath))
                        {
                            File.Copy(quarantineShmPath, shmPath, overwrite: true);
                        }
                        InitializeDatabase();
                    }
                    catch { }
                }
            }
        }
        if (restored)
        {
            try { ResetAndRestartFtsAfterRestore(); } catch { }
        }
        return restored;
    }
}
