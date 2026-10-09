# Review — Data Safety: Export / Import Package Round-Trip

**Date**: 2026-10-05
**Type**: Read-only review. **No source file was changed for this report.**
**Scope**: `.dualclip` export writer (`MainForm.cs` `HandleExportClips`, lines 2469-2772),
package importer (`ExecutePackageImport` + `ParseClipFromJsonElement`, lines 2369-2468 / 2944-3210+),
`GetClipsForExport` / `ImportPackageBatch` (`Services/DatabaseService.cs`),
pre-clear safety backups, `Services/DatabaseService.Backup.cs` (skimmed).
**Method**: source read end to end, both directions of the round-trip.
**Not run**: `dotnet test` (withheld per `AGENTS.md` rule 6), the app itself.

---

## 1. Verdict

The transport is careful (tmp + atomic rename, zip-bomb guards, hash-checked
images, transaction batch) but the **payload is lossy**: four user-visible
fields never make it into the package, and the importer cannot restore what
was never written. All four are silent — export reports success.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| D1 | Clip renames (`custom_title`) dropped from `clips.json` | **High** | fixed — query selects it, writer emits it, import persists + merges it |
| D2 | GIF animation destroyed (relabeled `.png`, then skipped on import) | **High** | fixed — real container stored (`images/{sha}.gif`, `image/gif`), importer validates per format |
| D3 | Folder nesting (`parent_id`) dropped from `collections.json` | **High** | fixed — writer emits `parent_id`, format bumped to v2 |
| D4 | Rich text (`rich_text`) dropped from `clips.json` | **Medium** | fixed — same path as D1 |
| D5 | Collection import upsert wipes nesting even for packages that predate it | **Medium** | fixed — v1 entries without the field preserve the live parent |

---

## 2. Evidence (pre-fix; all five fixed in `333c514`)

- **D1**: `GetClipsForExport` selects 19 columns, no `custom_title`/`rich_text`
  (`DatabaseService.cs:1800-1805`), so `ReadClip` yields null for both
  (null at `FieldCount` 19, `DatabaseService.cs:2450-2456`). The writer emits
  neither (`MainForm.cs:2608-2632`). The rename *saves* correctly
  (`RenameCollection`, `DatabaseService.cs:1322`) — it just never leaves the app.
- **D2**: GIFs are stored as `{HASH}.gif` (`ClipboardListener.cs:1071`). Export
  writes them as `images/{sha}.png` with hardcoded `media_type: image/png`
  (`MainForm.cs:2671-2675`). Import matches the bytes by hash, then
  `ValidatePngHeader` rejects GIF bytes → entry skipped → `clip.ImagePath = ""`
  → `skippedImages++` (`MainForm.cs:3095-3100, 3152-3166`). Irreversible.
- **D3**: collections writer emits only `id/name/sort_order/pinned`
  (`MainForm.cs:2589-2594`). A nested tree flattens on re-import.
- **D4**: same write path as D1; `rich_text` column exists (`clips` DDL,
  `DatabaseService.cs:173`) and survives inside the DB, but never the package.
- **D5**: collection import calls `SaveCollection(cId, cName, cPinned, cOrder)`
  with no parent (`MainForm.cs:3056`), and `SaveCollection` unconditionally
  overwrites `parent_id` (`DatabaseService.cs:1398-1408`). Importing *any*
  package — even one written before nesting existed — un-nests matching live
  folders. There is no `FOREIGN KEY` on `parent_id`, so import order is free;
  only the missing-field handling is wrong.

## 3. Checked and found clean

- **Pre-clear backups**: all four clear paths call `CreateBackup("pre_clear")`
  and **abort** when it fails (`DatabaseService.cs:817-823`, same at
  961/1506/1678). Backup stages to a GUID `.tmp` then swaps — concurrent
  attempts cannot collide.
- **Import hardening**: 512 MB cap, ZIP magic sniff, 20k entry cap, duplicate
  rejection, 1 GB uncompressed cap, `minimum_reader_version` refusal,
  per-image 15 MB cap + SHA256 filename match, 64 MB JSON caps, image binaries
  promoted only after DB commit. Missing-image clips are skipped, not half-written.
- **Dedupe merge** (`ImportPackageBatch`): hash match merges pins/favs/counts
  and tags instead of duplicating rows.
- **Hash casing**: export lowercases, import compares case-insensitively —
  consistent with the uppercase-`content_hash` convention.

## 4. Fix plan (applied after this report)

Backward-compatible `format_version 2` (`minimum_reader_version` stays 1 —
old readers ignore unknown fields and degrade gracefully):

1. `GetClipsForExport`: select `custom_title, rich_text` (become `ReadClip`
   columns 20/21, already supported).
2. Export writer: emit `custom_title`, `rich_text`, collection `parent_id`;
   detect GIF bytes (magic `GIF87a`/`GIF89a`) and store
   `images/{sha}.gif` with `media_type: image/gif`.
3. Importer: accept `images/{64hex}.(png|gif)`; validate per format; preserve
   the staged extension through promotion and `ImagePath`.
4. `ParseClipFromJsonElement`: read `custom_title`, `rich_text`.
5. `ImportPackageBatch` INSERT: persist both columns.
6. Collection import: pass `parent_id` when present; when absent (v1 packages),
   preserve the live parent instead of nulling it.
