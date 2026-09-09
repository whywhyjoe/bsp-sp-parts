<#
.SYNOPSIS
Packs the hand-authored solution/ tree into an importable unmanaged solution
zip at packages/BspNotify_<version>.zip. Fully offline (no pac, no network):
the tree is already in PACKED layout (solution.xml + customizations.xml +
[Content_Types].xml at root, flow JSON under Workflows/), so packing is a
plain zip with forward-slash entry names.

After a first successful import, prefer pp-export.ps1 to round-trip the
solution from Dataverse — this script exists because the initial package was
authored locally.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$src = Join-Path $repo 'solution'
if (-not (Test-Path (Join-Path $src 'solution.xml'))) {
    throw ("solution/solution.xml not found at $src — solution/ is now the pac-UNPACKED tree " +
        "(round-tripped from Dataverse). This script only packs the original hand-authored PACKED layout; " +
        "to produce packages\BspNotify_<v>.zip from the live solution, run pp-export.ps1 -SolutionName BspNotify instead.")
}

$m = Select-String -Path (Join-Path $src 'solution.xml') -Pattern '<Version>([^<]+)</Version>'
$version = if ($m) { $m.Matches[0].Groups[1].Value } else { throw 'No <Version> in solution.xml' }

$pkgDir = Join-Path $repo 'packages'
New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null
$zipPath = Join-Path $pkgDir "BspNotify_$version.zip"
Remove-Item $zipPath -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem $src -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null
    }
} finally {
    $zip.Dispose()
}
$entries = ([System.IO.Compression.ZipFile]::OpenRead($zipPath)).Entries
Write-Host "PP-PACK-OK v$version -> $zipPath ($($entries.Count) entries: $(($entries | ForEach-Object FullName) -join ', '))"
