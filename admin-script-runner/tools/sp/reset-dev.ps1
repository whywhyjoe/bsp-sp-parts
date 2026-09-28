<#
.SYNOPSIS
DEV-ONLY teardown: deletes everything env.json declares — lists (incl. TestRuns),
the app + harness pages, and the project's scripts-library folder. The template
page and shared libs are NEVER touched. After reset: deploy -> bootstrap-dev ->
run-harness provision -> run-harness verify.
#>
[CmdletBinding()]
param(
    [switch]$Force,
    # Lists whose title does not contain the project name are skipped by
    # default (protects unrelated/shared lists a manifest typo might name).
    [switch]$IncludeUnrelatedLists
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $HOME '.claude\skills\sp-env\scripts\sp-env-common.ps1')

$resolvedJson = node (Join-Path $PSScriptRoot 'resolve.js') $repo
if ($LASTEXITCODE -ne 0) { throw "resolver failed: $resolvedJson" }
$resolved = $resolvedJson | ConvertFrom-Json
if ($resolved.env -ne 'dev') { throw 'reset-dev runs on dev only.' }
if (-not $Force) { throw 'reset-dev deletes lists, pages, and the scripts folder. Rerun with -Force to confirm.' }

$conn = Connect-SpEnvDev
function ServerRel([string]$Url) { ([uri]$Url).AbsolutePath }

foreach ($name in ($resolved.lists.PSObject.Properties.Name)) {
    $title = $resolved.lists.$name.title
    if ($title -eq 'TestRuns') {
        # TestRuns is SHARED infrastructure — every project posts to it.
        # Resetting one project must never delete every project's history.
        Write-Host "[reset-dev] Skipping shared list 'TestRuns' (never deleted by reset)."
        continue
    }
    if ($resolved.project -and $title -notlike "*$($resolved.project)*" -and -not $IncludeUnrelatedLists) {
        Write-Host "[reset-dev] Skipping list '$title' — title does not contain project '$($resolved.project)' (use -IncludeUnrelatedLists to delete it anyway)."
        continue
    }
    if (Get-PnPList -Identity $title -Connection $conn -ErrorAction SilentlyContinue) {
        Remove-PnPList -Identity $title -Force -Connection $conn
        Write-Host "[reset-dev] Removed list '$title'"
    }
}
foreach ($pageName in ($resolved.pages.PSObject.Properties.Name)) {
    if ($pageName -eq 'template') { continue }
    $rel = ServerRel $resolved.pages.$pageName.url
    if (Get-PnPFile -Url $rel -Connection $conn -ErrorAction SilentlyContinue) {
        Remove-PnPFile -ServerRelativeUrl $rel -Force -Connection $conn
        Write-Host "[reset-dev] Removed page $rel"
    }
}
$folderRel = ServerRel $resolved.libraries.scripts.url
$parent = Split-Path $folderRel -Parent; $leaf = Split-Path $folderRel -Leaf
if (Get-PnPFolder -Url $folderRel -Connection $conn -ErrorAction SilentlyContinue) {
    Remove-PnPFolder -Name $leaf -Folder ($parent -replace '\\', '/') -Force -Connection $conn
    Write-Host "[reset-dev] Removed scripts folder $folderRel"
}
Write-Host 'RESET-DEV-OK'
