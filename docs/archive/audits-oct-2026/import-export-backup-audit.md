# Review — Import, export and backup layers

**Date**: 2026-10-05
**Type**: Read-only review. **No source file was changed.**
**Scope**: `Services/DatabaseService.Backup.cs` (backup creation, integrity checks, rotation, weekly
snapshots, startup recovery), the destructive operations in `Services/DatabaseService.cs`
(`ClearHistory`, `DeleteCollectionWithClips`, `DeleteClipsInCollection`, `ImportPackageBatch` and its
neighbours), the package import/export implementation in `MainForm.cs` (~2600-3450), and the
`export_clips` / `import_into_collection` / `import_dropped_package` / `import_package_base64` RPCs in
`MainForm.RpcDispatch.cs`.
**Not run**: `dotnet test` (needs explicit user permission per `AGENTS.md` rule 6) and the app itself.
No archive was crafted to exploit I-E1; the finding is from reading the size checks.

---

## 1. Verdict

This layer is the most heavily hardened code in the repository, and the hardening is real rather than
decorative. A **failed safety backup aborts the destructive operation** at all four call sites. The
package importer validates entry names against a strict regex, verifies the **SHA-256 of every
extracted image against the hash in its own filename**, checks magic bytes, enforces anti-zip-bomb
limits, and reads entries by exact name so there is no zip-slip surface at all. Staging directories are
unioned away in a `finally`.

The one real weakness is narrow and specific: **the size limits trust the archive's own central
directory**, which is attacker-controlled data, and only the image path re-verifies after
decompression.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| I-E1 | `clips.json` / `manifest.json` size caps trust attacker-controlled zip metadata | **Low-Med** | new |
| I-E2 | Dedup does not honour the import target collection | **Low** | new |
| I-E3 | Per-clip `catch { }` silently drops malformed entries from the count | **Low** | new |

---

## 2. Findings

### I-E1 — The JSON size caps trust the archive's own metadata (Low-Med)

`ExecutePackageImport` layers three limits, all of which read `ZipArchiveEntry.Length` — a value taken
verbatim from the archive's central directory, which the author of the file controls:

```csharp
// MainForm.cs:3077  — 20,000 entry cap
// MainForm.cs:3097  — total uncompressed ≤ 1 GB, summed from entry.Length
// MainForm.cs:3109  — manifest.json ≤ 64 MB, entry.Length
// MainForm.cs:3292  — clips.json ≤ 64 MB, entry.Length
```

The **image** path is the one that gets this right, and the contrast is the proof of intent:

```csharp
if (entry.Length > 15 * 1024 * 1024) continue;      // metadata check  (MainForm.cs:3213)
…
entryStream.CopyTo(ms);
imageBytes = ms.ToArray();
if (imageBytes.Length > 15 * 1024 * 1024) continue; // ACTUAL size re-checked (MainForm.cs:3228)
```

Images are checked twice because the first number is untrusted. `clips.json` and `manifest.json` are
checked once and then handed straight to `JsonDocument.Parse(clipsStream)`, which reads the decompressed
stream to the end. A crafted archive can declare a small `clips.json` in its central directory while
expanding to far more, and the guard would pass.

Practical impact is bounded — the user must choose to import a hostile file, and the failure mode is a
large allocation rather than code execution — but this is the one input in the whole app that arrives
from outside, and the fix is already written three lines away in the same function.

**Fix**: mirror the image pattern. Wrap the stream in a counting/limiting read, or read the entry to a
bounded `MemoryStream` and check the real length before parsing:

```csharp
using var clipsStream = clipsEntry.Open();
using var bounded = new MemoryStream();
var buf = new byte[8192];
long total = 0;
int read;
while ((read = clipsStream.Read(buf, 0, buf.Length)) > 0)
{
    total += read;
    if (total > 64L * 1024 * 1024) { /* respond with the size error; return; */ }
    bounded.Write(buf, 0, read);
}
bounded.Position = 0;
using var clipsDoc = JsonDocument.Parse(bounded);
```

Apply the same to `manifest.json`, and — while there — sum the *verified* sizes rather than
`entry.Length` for the 1 GB total, so the anti-bomb limit rests on measured data too.

### I-E2 — Dedup does not honour the import target collection (Low)

`ImportPackageBatch` takes a `forceCollection` and is reached via `import_into_collection`. For a clip
whose `content_hash` already exists, it runs the dedup `UPDATE`, which merges pinned/favorite with
`|`, timestamps with `MIN`/`MAX`, and fills empty `custom_title` / `rich_text` — but **never touches
`collection`**. For a genuinely new clip it inserts with the forced collection.

So "import into Project X" leaves already-known clips sitting in whatever collection they were in
before. That is a defensible design (a dedup should not silently relocate existing history), but it is
undocumented and the user sees a lower imported count with no explanation of where the rest went.

**Fix**: either document it in the RPC contract and the import summary ("N merged into existing clips,
which keep their current collection"), or — if the intent really is relocation — add
`collection = $col` to the UPDATE for the forced-collection case only.

### I-E3 — Malformed entries vanish from the counts (Low)

The per-clip parse loop swallows every exception:

```csharp
foreach (var elem in clipsDoc.RootElement.EnumerateArray())
{
    try { var clip = ParseClipFromJsonElement(elem); … items.Add(clip); }
    catch { }        // MainForm.cs:3336
}
```

A clip whose JSON is the wrong shape, or whose `image_path` throws during the remap, disappears with
no counter and no log — the summary reports only `imported / deduped / skipped / skippedImages`, so a
package with 500 corrupt entries reports as a clean run. The separate "missing image binary → skipped"
case *is* counted, which makes the uncounted path more surprising by comparison.

**Fix**: add a `malformed` counter to the returned tuple and surface it in the toast, or at minimum
`Debug.WriteLine` the exception so a bad package is diagnosable.

---

## 3. Checked and found clean

The positive results here are the reason to keep reading this file before changing anything in it.

- **A failed safety backup aborts the destructive operation — at all four sites.** `ClearHistory`
  (`DatabaseService.cs:961`), `DeleteCollectionWithClips` (`:1506`), `DeleteClipsInCollection` (`:817`)
  and the fourth clear path (`:1678`) each do:

  ```csharp
  var backup = CreateBackup("pre_clear");
  if (backup == null)
  {
      if (string.IsNullOrEmpty(LastBackupError))
          LastBackupError = "Pre-clear safety backup failed; clear operation aborted to prevent data loss.";
      return false;
  }
  ```

  and the error propagates to the RPC as `{ ok = false, error = … }`. "We always back up first" is
  true here, which is not something most projects can say.
- **Backup creation is itself defensively built**: free-space check (max of 50 MB or 2× the live DB
  size) before any work; the SQLite **online backup API** so WAL content folds in without locking; a
  `PRAGMA quick_check` on the *newly written* file with deletion and failure on anything but `ok`; an
  atomic `.tmp` → final rename retried against AV locks; a GUID-unique temp name per attempt so
  same-second concurrent backups cannot fight over one file; and a per-file try/catch when snapshotting
  the images folder so one locked image cannot fail the whole backup.
- **No zip-slip surface.** The importer never calls `ExtractToDirectory` or writes a path derived from
  `entry.FullName`. It reads `manifest.json`, `collections.json` and `clips.json` by exact name and
  stages images under a filename **rebuilt from a validated hash**, so a crafted `image_path` of
  `../../evil.png` cannot escape: it becomes `Path.GetFileNameWithoutExtension(...)` uppercased, joined
  to the images folder with an extension drawn from the allowlist.
- **Image content is verified, not trusted.** Entries must match
  `^images/[a-f0-9]{64}\.(png|gif)$`; the extension is re-checked against `png`/`gif`; the **SHA-256 of
  the decompressed bytes must equal the hash in the entry's own filename** or the entry is skipped; and
  the container is confirmed by magic bytes (plus a real decode for GIF dimensions). A package cannot
  smuggle arbitrary bytes in under a chosen name.
- **Anti-zip-bomb limits exist** — 20,000 entries and 1 GB total — and are checked before any
  extraction (see I-E1 for the caveat that they trust metadata).
- **Staging is cleaned up in a `finally`** (`MainForm.cs:3389-3395`), so both the success and every
  failure path remove the temp directory.
- **The DB import is a single transaction** with prepared, parameterised commands, a monotonic
  `sort_rank` seeded from `MAX(sort_rank)`, and an `INSERT` (deliberately not an upsert) so the
  after-insert FTS trigger fires — the comment says so, which is the kind of constraint that survives.
- **Schema validation on import** checks for the required entries and rejects a `clips.json` whose root
  is not an array, with distinct error messages for the RPC and the toast paths.
- **Collection id remapping is handled**: clips keep their folder association when the folder's id was
  remapped during import.
- **Image clips with a missing binary are marked, not crashed** (`ImagePath = ""` → counted as
  `skippedImages`).
- **Export is non-destructive and side-effect free** — it writes to a new zip with `ZipArchiveMode.Create`
  and never touches the live database.
- **Long-running RPCs are dispatched off the message thread** (`BeginInvoke` for the file-dialog paths,
  `Task.Run` for the package paths), so a modal import cannot freeze the UI or block the WebView
  message pump.

---

## 4. Suggested order of work

1. **I-E1** — the bounded-read fix, copied from the image path that already does it right. Small, and
   it closes the only untrusted-input gap in the app.
2. **I-E2** — decide and document; the code is defensible, the silence is not.
3. **I-E3** — add the counter so a bad package is visible.

Worth adding as tests, in the style of the existing `PackageValidationTests`: an archive whose central
directory understates `clips.json` should be rejected with the size error, and an archive containing
one malformed clip element should report it in the summary.
