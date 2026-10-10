# DualClip Release Build & Packaging Script
# Requires .NET 10 SDK and Inno Setup (ISCC) installed

param(
    [switch]$SkipInstaller = $false,
    [string]$ReleaseOutDir = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=== 1. Terminating running instances of DualClip ===" -ForegroundColor Cyan
Get-Process DualClip -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "=== 2. Validating JavaScript Syntax ===" -ForegroundColor Cyan
$jsFiles = Get-ChildItem -Path "ui/js" -Filter "*.js" -Recurse
foreach ($file in $jsFiles) {
    node -c $file.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "JavaScript syntax check failed for $($file.FullName)"
    }
}
Write-Host "All JavaScript files passed syntax check." -ForegroundColor Green

Write-Host "=== 3. Clean Build (Debug & Release) ===" -ForegroundColor Cyan
dotnet build -c Debug -warnaserror
if ($LASTEXITCODE -ne 0) { Write-Error "Debug build failed." }

dotnet build -c Release -warnaserror
if ($LASTEXITCODE -ne 0) { Write-Error "Release build failed." }

Write-Host "=== 4. Publishing win-x64 Self-Contained ===" -ForegroundColor Cyan
$publishDir = "publish\win-x64"
if (Test-Path $publishDir) {
    Remove-Item -Recurse -Force $publishDir
}

dotnet publish DualClip.csproj -c Release -r win-x64 --self-contained true -o $publishDir
if ($LASTEXITCODE -ne 0) { Write-Error "Publish failed." }

if (Test-Path "LICENSE") {
    Copy-Item -Force "LICENSE" -Destination (Join-Path $publishDir "LICENSE")
    Write-Host "Bundled LICENSE into publish payload." -ForegroundColor Green
}
Write-Host "Published to $publishDir successfully." -ForegroundColor Green

Write-Host "=== 4a. Validating Payload Cleanliness (No Databases or Demo Data Artifacts) ===" -ForegroundColor Cyan
$leakedFiles = Get-ChildItem -Path $publishDir -Include "*.db","*.db-shm","*.db-wal","*.bak" -Recurse
if ($leakedFiles -and $leakedFiles.Count -gt 0) {
    Write-Error "CRITICAL: Found unexpected database or demo artifacts in publish payload: $($leakedFiles.FullName)"
}
Write-Host "Publish payload is 100% clean of any database or demo artifacts." -ForegroundColor Green

if (-not $SkipInstaller) {
    Write-Host "=== 5. Building Inno Setup Installer ===" -ForegroundColor Cyan
    $isccPath = Get-Command "iscc" -ErrorAction SilentlyContinue
    if (-not $isccPath) {
        $commonIscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
        if (Test-Path $commonIscc) {
            $isccPath = $commonIscc
        }
    }
    if (-not $isccPath) {
        $userIscc = Join-Path ${env:LocalAppData} "Programs\Inno Setup 6\ISCC.exe"
        if (Test-Path $userIscc) {
            $isccPath = $userIscc
        }
    }

    if ($isccPath) {
        & $isccPath "installer\DualClip.iss"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Installer built successfully in dist/." -ForegroundColor Green
        } else {
            Write-Warning "ISCC compilation returned exit code $LASTEXITCODE"
        }
    } else {
        Write-Warning "Inno Setup Compiler (ISCC) not found in PATH. Skipping installer build."
    }
}

Write-Host "=== 6. Building Clean Single-File Portable ZIP ===" -ForegroundColor Cyan
$distDir = "dist"
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$portableStaging = "publish\portable-staging"
if (Test-Path $portableStaging) { Remove-Item -Recurse -Force $portableStaging }

# Publish single-file win-x64 executable for clean portable package
dotnet publish DualClip.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $portableStaging
if ($LASTEXITCODE -ne 0) { Write-Error "Portable single-file publish failed." }

if (Test-Path "LICENSE") {
    Copy-Item -Force "LICENSE" -Destination (Join-Path $portableStaging "LICENSE")
}

# Add portable marker
$portableMarker = Join-Path $portableStaging "portable.dat"
New-Item -ItemType File -Path $portableMarker -Force | Out-Null

# Set hidden attribute (+H) on portable.dat and non-executable items
Get-ChildItem -Path $portableStaging | Where-Object { $_.Name -ne "DualClip.exe" -and -not $_.PSIsContainer } | ForEach-Object {
    $_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden
}

$zipPath = Join-Path $distDir "DualClip-Portable-1.0.0.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

# Build ZIP preserving DOS Hidden attribute on non-EXE root files
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stagingAbs = (Resolve-Path $portableStaging).Path
$zipAbs = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $zipPath))

$archive = [System.IO.Compression.ZipFile]::Open($zipAbs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in (Get-ChildItem -Path $stagingAbs -Recurse -Force)) {
        if (-not $item.PSIsContainer) {
            $relPath = $item.FullName.Substring($stagingAbs.Length + 1)
            $entry = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Optimal)
            if ($item.Attributes -band [System.IO.FileAttributes]::Hidden) {
                # Store DOS Hidden attribute in ZipArchiveEntry.ExternalAttributes
                $entry.ExternalAttributes = 0x02
            }
        }
    }
} finally {
    $archive.Dispose()
}
Write-Host "Portable ZIP created successfully at $zipPath." -ForegroundColor Green

# Cleanup staging
Remove-Item -Recurse -Force $portableStaging

if ($ReleaseOutDir -and $ReleaseOutDir.Trim() -ne "") {
    Write-Host "=== 7. Copying Production Packages to $ReleaseOutDir ===" -ForegroundColor Cyan
    if (-not (Test-Path $ReleaseOutDir)) { New-Item -ItemType Directory -Path $ReleaseOutDir -Force | Out-Null }
    $releaseFiles = @(
        (Join-Path $distDir "DualClip-Setup-1.0.0.exe"),
        (Join-Path $distDir "DualClip-Portable-1.0.0.zip")
    )
    foreach ($releaseFile in $releaseFiles) {
        if (-not (Test-Path $releaseFile)) { Write-Error "Expected release artifact missing: $releaseFile" }
        Copy-Item -Force -Path $releaseFile -Destination (Join-Path $ReleaseOutDir (Split-Path $releaseFile -Leaf))
        Write-Host "Copied $(Split-Path $releaseFile -Leaf) to $ReleaseOutDir." -ForegroundColor Green
    }
} else {
    Write-Host "=== 7. Release Artifacts Ready in ./dist ===" -ForegroundColor Cyan
}

Write-Host "=== Release Pipeline Completed Successfully! ===" -ForegroundColor Green


