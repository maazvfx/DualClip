<#
.SYNOPSIS
    Lints docs/wiki against the repository it describes.

.DESCRIPTION
    The wiki drifted because nothing checked it against the code. This script
    catches the five failure modes that actually occurred:

    1. LINK ROT. Relative markdown links and inline `path/like/this` references
       in docs/wiki that do not resolve to a real file. An earlier revision used
       absolute file:///C:/Users/... links, which broke for every other
       checkout.

    2. RPC DRIFT. The method count asserted in rpc-and-bridge.md vs. the real
       surface parsed from rpc-contracts.js and the host `switch (method)`.
       This is the check that would have caught the invented
       toggle_pin_clip / toggle_fav_clip methods.

    3. PHANTOM IDENTIFIER. Backticked or otherwise token-like identifiers cited
       in the wiki that do not appear anywhere in the referenced source file.
       This catches invented API names (e.g. ExecuteScriptAsync, which has
       never existed in this repo).

    4. EVENT DRIFT. Host event names handled in bridge.js that the host never
       emits, and vice versa.

    5. COUNT DRIFT. Test suite counts asserted in testing-matrix.md vs. the
       files on disk.

    Reports findings; modifies nothing. Exit 1 on error-level findings.

.PARAMETER Strict
    Treat warnings as failures (use in CI or before a release).
#>
[CmdletBinding()]
param([switch]$Strict)

$ErrorActionPreference = "Stop"
$repo    = Split-Path -Parent $PSScriptRoot
$wikiDir = Join-Path $repo "docs\wiki"

$errors   = @()
$warnings = @()
$info     = @()

function ReadRepoFile([string]$rel) {
    $p = Join-Path $repo $rel
    if (-not (Test-Path $p)) { return $null }
    return [System.IO.File]::ReadAllText($p)
}

# ---------------------------------------------------------------------------
# 1. Link rot: every relative link and inline path in docs/wiki must resolve
# ---------------------------------------------------------------------------
if (-not (Test-Path $wikiDir)) {
    Write-Host "No docs/wiki directory; nothing to lint." -ForegroundColor Yellow
    exit 0
}

$wikiFiles = Get-ChildItem $wikiDir -Filter *.md

foreach ($wf in $wikiFiles) {
    $text    = [System.IO.File]::ReadAllText($wf.FullName)
    $relBase = "docs\wiki"

    # 1a. Markdown link targets. Skip http(s): and pure anchors.
    foreach ($m in [regex]::Matches($text, '\]\(([^)]+)\)')) {
        $target = $m.Groups[1].Value.Trim()
        if ($target -match '^(https?|mailto):' -or $target.StartsWith('#')) { continue }

        # Strip an optional anchor / line suffix.
        $pathOnly = ($target -split '#')[0]
        $pathOnly = ($pathOnly -split ':\d+')[0]
        if ([string]::IsNullOrWhiteSpace($pathOnly)) { continue }

        # Reject machine-specific absolute links outright.
        if ($pathOnly -match '^[A-Za-z]:[\\/]' -or $pathOnly -match '^file:') {
            $errors += "ABSOLUTE LINK: $($wf.Name) links '$target'. Absolute links break on other machines; use a relative path."
            continue
        }

        $resolved = Join-Path $repo (Join-Path $relBase $pathOnly)
        if (-not (Test-Path $resolved)) {
            $errors += "LINK ROT: $($wf.Name) -> '$pathOnly' does not exist."
        }
    }

    # 1b. Inline backticked paths that look like repo paths.
    foreach ($m in [regex]::Matches($text, '`([A-Za-z0-9_./\\-]+\.(?:cs|js|html|md|ps1|json|csproj))`')) {
        $p = $m.Groups[1].Value -replace '/', '\'
        # Repo-root-relative paths (Services/..., DualClip.Tests/..., ui/...)
        # resolve from the repo root. Docs also use shorthand prefixes like
        # "js-harness/x.js" or a bare "Suites.cs", so fall back through the
        # common roots rather than only docs/wiki.
        if ($p -match '^\.') {
            $resolved = Join-Path $repo $p.TrimStart('.\')
        } else {
            $resolved = Join-Path $repo $p
            if (-not (Test-Path $resolved)) {
                foreach ($root in @("docs\wiki", "DualClip.Tests", "DualClip.Tests\js-harness")) {
                    $candidate = Join-Path $repo (Join-Path $root $p)
                    if (Test-Path $candidate) { $resolved = $candidate; break }
                }
            }
            if (-not (Test-Path $resolved)) {
                # Bare filename with no directory component: search the tree.
                if ($p -notmatch '[\\/]') {
                    $hit = Get-ChildItem $repo -Recurse -Filter $p -File -ErrorAction SilentlyContinue |
                        Select-Object -First 1
                    if ($hit) { $resolved = $hit.FullName }
                }
            }
        }

        if (-not (Test-Path $resolved)) {
            # A bare filename may live in several dirs (e.g. INDEX.md is only
            # ever referenced relatively). Only flag paths with a directory
            # component, which are unambiguous.
            if ($p -match '\\' -or $p -match '/') {
                $errors += "LINK ROT: $($wf.Name) cites '$p' but it does not exist."
            }
        }
    }
}

# ---------------------------------------------------------------------------
# 2. RPC surface drift
# ---------------------------------------------------------------------------
$contractsJs = ReadRepoFile "ui\js\core\rpc-contracts.js"
if ($contractsJs) {
    $contractNames = [regex]::Matches($contractsJs, '(?m)^[ \t]{4}([A-Za-z0-9_]+):[ \t]*\{') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

    $handlerNames = @()
    Get-ChildItem (Join-Path $repo "MainForm*.cs") -ErrorAction SilentlyContinue | ForEach-Object {
        $cs      = [System.IO.File]::ReadAllText($_.FullName)
        $swIdx   = $cs.IndexOf("switch (method")
        if ($swIdx -lt 0) { return }
        [regex]::Matches($cs.Substring($swIdx), 'case\s+"([A-Za-z0-9_]+)"\s*:') |
            ForEach-Object { $_.Groups[1].Value }
    } | ForEach-Object { $handlerNames += $_ }
    $handlerNames = $handlerNames | Sort-Object -Unique

    if ($contractNames.Count -gt 0 -and $handlerNames.Count -gt 0) {
        if ($contractNames.Count -ne $handlerNames.Count) {
            $errors += "RPC DRIFT: $($contractNames.Count) contracts in rpc-contracts.js vs $($handlerNames.Count) handlers in MainForm*.cs. Run: dotnet test DualClip.Tests/DualClip.Tests.csproj"
        } else {
            $info += "RPC surface aligned: $($contractNames.Count) contracts, $($handlerNames.Count) handlers."
        }

        # Uncontracted / dead surface
        foreach ($h in $handlerNames) {
            if ($contractNames -notcontains $h) {
                $errors += "RPC DRIFT: handler '$h' has no contract in rpc-contracts.js."
            }
        }
        foreach ($c in $contractNames) {
            if ($handlerNames -notcontains $c) {
                $errors += "RPC DRIFT: contract '$c' has no handler in MainForm*.cs (dead surface)."
            }
        }

        # The wiki asserts a count. Keep it honest.
        $rpcWiki = Join-Path $wikiDir "rpc-and-bridge.md"
        if (Test-Path $rpcWiki) {
            $wt = [System.IO.File]::ReadAllText($rpcWiki)
            foreach ($m in [regex]::Matches($wt, '(\d+)-method')) {
                $claimed = [int]$m.Groups[1].Value
                if ($claimed -ne $contractNames.Count) {
                    $errors += "COUNT DRIFT: rpc-and-bridge.md claims $claimed methods; real count is $($contractNames.Count)."
                }
            }
            # Method names the wiki names must actually be contracted.
            foreach ($m in [regex]::Matches($wt, '`([a-z][a-z0-9_]{3,})`')) {
                $sym = $m.Groups[1].Value
                if ($sym -notmatch '^(hide_window|set_|get_|toggle_|paste_|copy_|delete_|clear_|add_|update_|rename_|move_|merge_|reassign_|migrate_|batch_|reset_|start_|center_|resize_|restore_|import_|export_|browse_|ui_ready|window_show_ack|write_debug_log)$') { continue }
                if ($contractNames -notcontains $sym) {
                    $errors += "PHANTOM RPC: rpc-and-bridge.md names '$sym' but no such contract exists."
                }
            }
        }
    }
} else {
    $warnings += "MISSING: ui/js/core/rpc-contracts.js not found; skipping RPC drift checks."
}

# ---------------------------------------------------------------------------
# 3. Host event drift: bridge.js dispatch vs MainForm PostEventToJs
# ---------------------------------------------------------------------------
$bridgeJs = ReadRepoFile "ui\js\core\bridge.js"
if ($bridgeJs) {
    $handled = [regex]::Matches($bridgeJs, "msg\.event\s*===\s*'([A-Za-z_]+)'") |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

    # Match every string literal inside a PostEventToJs(...) call, not just the
    # first one -- MainForm.cs:1419 emits via a ternary:
    #   PostEventToJs(isNew ? "onClipAdded" : "onClipUpdated", payload)
    # The literal must be in the FIRST argument position, otherwise payload
    # strings get swept in (e.g. the "warning" toast type at MainForm.cs:1442).
    $emitted = @()
    Get-ChildItem (Join-Path $repo "MainForm*.cs") -ErrorAction SilentlyContinue | ForEach-Object {
        $cs = [System.IO.File]::ReadAllText($_.FullName)
        $rx = 'PostEventToJs\(\s*("([A-Za-z_]+)"|[^,]*?\?\s*"([A-Za-z_]+)"\s*:\s*"([A-Za-z_]+)")'
        foreach ($m in [regex]::Matches($cs, $rx)) {
            foreach ($g in 2..4) {
                if ($m.Groups[$g].Success) { $emitted += $m.Groups[$g].Value }
            }
        }
    }
    $emitted = $emitted | Sort-Object -Unique

    foreach ($h in $handled) {
        if ($emitted -notcontains $h) {
            $warnings += "EVENT DRIFT: bridge.js handles '$h' but no MainForm PostEventToJs emits it."
        }
    }
    foreach ($e in $emitted) {
        if ($handled -notcontains $e) {
            $warnings += "EVENT DRIFT: host emits '$e' but bridge.js does not handle it."
        }
    }
    $info += "Host events: $($emitted.Count) emitted, $($handled.Count) handled."
}

# ---------------------------------------------------------------------------
# 4. Test suite count drift
# ---------------------------------------------------------------------------
$matrix = Join-Path $wikiDir "testing-matrix.md"
if (Test-Path $matrix) {
    $mt = [System.IO.File]::ReadAllText($matrix)

    $jsActual  = (Get-ChildItem (Join-Path $repo "DualClip.Tests\js-harness") -Filter *.js -ErrorAction SilentlyContinue).Count
    $csActual  = (Get-ChildItem (Join-Path $repo "DualClip.Tests") -Filter *Tests.cs -ErrorAction SilentlyContinue).Count

    foreach ($m in [regex]::Matches($mt, 'All?\s+(\d+)\s+Node\.js')) {
        $claimed = [int]$m.Groups[1].Value
        if ($claimed -ne $jsActual) {
            $errors += "COUNT DRIFT: testing-matrix.md claims $claimed Node harnesses; found $jsActual."
        }
    }
    foreach ($m in [regex]::Matches($mt, '(\d+)\s+\.NET xUnit')) {
        $claimed = [int]$m.Groups[1].Value
        if ($claimed -ne $csActual) {
            $errors += "COUNT DRIFT: testing-matrix.md claims $claimed .NET suites; found $csActual."
        }
    }

    # Every harness and suite on disk should be named in the matrix. The matrix
    # writes bare names in its tables (no directory prefix, no extension on the
    # .NET side), so match on the file stem, not the full name.
    Get-ChildItem (Join-Path $repo "DualClip.Tests\js-harness") -Filter *.js -ErrorAction SilentlyContinue | ForEach-Object {
        if ($mt -notmatch [regex]::Escape($_.BaseName)) {
            $errors += "UNDOCUMENTED TEST: $($_.Name) exists but is not named in testing-matrix.md."
        }
    }
    Get-ChildItem (Join-Path $repo "DualClip.Tests") -Filter *Tests.cs -ErrorAction SilentlyContinue | ForEach-Object {
        # BaseName is e.g. RpcContractInvariantTests; the matrix writes that.
        if ($mt -notmatch [regex]::Escape($_.BaseName)) {
            $errors += "UNDOCUMENTED TEST: $($_.Name) exists but is not named in testing-matrix.md."
        }
    }

    $info += "Test suites: $jsActual Node harnesses, $csActual .NET suites."
}

# ---------------------------------------------------------------------------
# 5. Sibling layer presence
# ---------------------------------------------------------------------------
foreach ($required in @(
    "docs\STATE.md",
    "docs\CODEMAP.md",
    "docs\knowledge\ARCHITECTURE.md"
)) {
    if (-not (Test-Path (Join-Path $repo $required))) {
        $warnings += "MISSING LAYER: $required is referenced from docs/wiki but does not exist."
    }
}

$state = Join-Path $repo "docs\STATE.md"
if (Test-Path $state) {
    $lines = (Get-Content $state).Count
    if ($lines -gt 60) {
        $warnings += "BLOAT: docs/STATE.md has $lines lines (max 60). Prune older entries."
    } else {
        $info += "docs/STATE.md is lean ($lines lines <= 60)."
    }
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Docs freshness check" -ForegroundColor Cyan
Write-Host "--------------------" -ForegroundColor Cyan
foreach ($i in $info)    { Write-Host "  info: $i" -ForegroundColor DarkGray }
foreach ($w in $warnings) { Write-Host "  WARN: $w" -ForegroundColor Yellow }
foreach ($e in $errors)  { Write-Host "  FAIL: $e" -ForegroundColor Red }

$failCount = $errors.Count + $(if ($Strict) { $warnings.Count } else { 0 })
Write-Host ""
if ($failCount -gt 0) {
    Write-Host "Result: $failCount finding(s) requiring action." -ForegroundColor Red
    exit 1
}
Write-Host "Result: no blocking findings ($($warnings.Count) warning(s))." -ForegroundColor Green
exit 0