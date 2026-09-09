<#
.SYNOPSIS
Deploy this project's app/ assets to SharePoint. Modes: copy (implemented) |
push | sync-live (phase 3). Reads env.json + env.local.json via the resolver
and REFUSES to run if env.local.json is missing (the resolver enforces this).
copy mode writes into the OneDrive mirror folder; OneDrive sync carries the
files to the library (allow a short sync latency before verifying).
Also generates resolved-env.json (absolute URLs for THIS environment) into the
mirror — a deploy artifact, never committed.
#>
[CmdletBinding()]
param(
    [ValidateSet('copy', 'push', 'sync-live')][string]$Mode,
    # DEV-ONLY last-mile fallback when OneDrive sync is backed up: after the
    # mirror copy (mirror stays canonical), upload the artifacts directly via
    # PnP and verify SHA256 parity between mirror and live bytes. Never touches
    # sync configuration; OneDrive later syncs identical content.
    [switch]$DirectUpload,
    # push mode: note stamped into the Note metadata column on each file
    [string]$Note = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$resolvedJson = node (Join-Path $PSScriptRoot 'resolve.js') $repo
if ($LASTEXITCODE -ne 0) { throw "resolver failed: $resolvedJson" }
$resolved = $resolvedJson | ConvertFrom-Json
if (-not $Mode) { $Mode = $resolved.deploy.mode }

switch ($Mode) {
    'copy' {
        $mirror = $resolved.libraries.scripts.mirror
        if (-not $mirror) { throw "No mirror path resolved for the scripts library (root '$($resolved.libraries.scripts.root)') — check mirrors in tenants.local.json / env.local.json." }
        New-Item -ItemType Directory -Path $mirror -Force | Out-Null

        $sha = (git -C $repo rev-parse --short HEAD 2>$null); if (-not $sha) { $sha = 'uncommitted' }
        $resolved | Add-Member -NotePropertyName gitSha -NotePropertyValue "$sha" -Force
        $resolved | Add-Member -NotePropertyName deployedUtc -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
        $resolved | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $mirror 'resolved-env.json') -Encoding utf8

        $appDir = Join-Path $repo 'app'
        if (-not (Test-Path $appDir)) { throw "app/ directory not found at $appDir" }
        Copy-Item (Join-Path $appDir '*') $mirror -Recurse -Force
        # bsp-notify: the wrapper engine lives at the part root (repo contract)
        # but deploys alongside the ops so pages and the smoke test can load it.
        Copy-Item (Join-Path $repo 'bsp-notify.js') $mirror -Force
        $count = @(Get-ChildItem $appDir -Recurse -File).Count + 2

        # The mirror is an INTENTIONAL reparse point into OneDrive (same local
        # path on every machine) — expected, never something to "fix". Files only
        # reach the library if OneDrive is running; warn loudly if it is not.
        # If sync stays broken beyond that: read-only diagnostics only, then STOP
        # and tell the user. Never create OneDrive folders or change sync config.
        if (-not (Get-Process OneDrive -ErrorAction SilentlyContinue)) {
            Write-Warning 'DEPLOY-SYNC-BLOCKED: OneDrive is NOT running — the copied files will not sync to the library until it is. Ask the user to start OneDrive; do NOT attempt to repair sync configuration.'
        }
        Write-Host "DEPLOY-OK mode=copy files=$count gitSha=$sha mirror='$mirror' (OneDrive sync latency applies before files are live)"

        if ($DirectUpload) {
            if ($resolved.env -ne 'dev') { throw 'DirectUpload is dev-only (prod has no PnP PowerShell).' }
            . (Join-Path $HOME '.claude\skills\sp-env\scripts\sp-env-common.ps1')
            $conn = Connect-SpEnvDev
            $siteRelBase   = ([uri]$resolved.siteUrl).AbsolutePath
            $folderSiteRel = ([uri]$resolved.libraries.scripts.url).AbsolutePath.Substring($siteRelBase.Length).TrimStart('/')
            Resolve-PnPFolder -SiteRelativePath $folderSiteRel -Connection $conn | Out-Null
            $files = Get-ChildItem $mirror -Recurse -File
            $mismatch = @()
            foreach ($f in $files) {
                $rel = ($f.FullName.Substring($mirror.Length + 1)) -replace '\\', '/'
                $sub = if ($rel.Contains('/')) { $rel.Substring(0, $rel.LastIndexOf('/')) } else { '' }
                $targetFolder = if ($sub) { "$folderSiteRel/$sub" } else { $folderSiteRel }
                if ($sub) { Resolve-PnPFolder -SiteRelativePath $targetFolder -Connection $conn | Out-Null }
                Add-PnPFile -Path $f.FullName -Folder $targetFolder -Connection $conn | Out-Null
                $serverRel = ([uri]$resolved.libraries.scripts.url).AbsolutePath + '/' + $rel
                $stream = Get-PnPFile -Url $serverRel -AsMemoryStream -Connection $conn
                if ((Get-FileHash -InputStream $stream -Algorithm SHA256).Hash -ne (Get-FileHash $f.FullName -Algorithm SHA256).Hash) { $mismatch += $rel }
            }
            if ($mismatch) { throw "DIRECT-UPLOAD-PARITY-FAIL: $($mismatch -join ', ')" }
            Write-Host "DIRECT-UPLOAD-OK $(@($files).Count) file(s) live, SHA256 mirror parity MATCH (mirror remains canonical)."
        }
    }
    'push' {
        # Browser uploader with metadata stamping (BuildId/GitSha/DeployedBy/Note).
        # Dev: Playwright drives the harness upload op against a temp staging.
        # Prod: this prepares a PERSISTENT gitignored push-staging/ (app files +
        # fresh resolved-env.json) and tells the human what to do — the browser
        # file picker cannot carry folder structure, so push mode is FLAT-only.
        $appDir = Join-Path $repo 'app'
        if (-not (Test-Path $appDir)) { throw "app/ directory not found at $appDir" }
        if (@(Get-ChildItem $appDir -Directory).Count) {
            throw 'push mode is FLAT-only (the browser file picker cannot preserve subfolders) — app/ contains subdirectories; use copy mode instead.'
        }
        $sha = (git -C $repo rev-parse --short HEAD 2>$null); if (-not $sha) { $sha = 'uncommitted' }
        $resolved | Add-Member -NotePropertyName gitSha -NotePropertyValue "$sha" -Force
        $resolved | Add-Member -NotePropertyName deployedUtc -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force

        if ($resolved.env -eq 'dev') {
            $staging = Join-Path ([System.IO.Path]::GetTempPath()) ("sp-env-push-" + [guid]::NewGuid().ToString('n'))
            New-Item -ItemType Directory -Path $staging | Out-Null
            try {
                Copy-Item (Join-Path $appDir '*') $staging -Force
                $resolved | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $staging 'resolved-env.json') -Encoding utf8
                node (Join-Path $PSScriptRoot 'push-deploy.js') --staging $staging --note $Note
                if ($LASTEXITCODE -ne 0) { throw "push-deploy.js failed (exit $LASTEXITCODE)" }
            } finally {
                Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
            }
            Write-Host "DEPLOY-OK mode=push gitSha=$sha note='$Note' (metadata stamped; see PUSH-DEPLOY-RESULT above)"
        } else {
            $staging = Join-Path $repo 'push-staging'
            if (Test-Path $staging) { Remove-Item (Join-Path $staging '*') -Recurse -Force -ErrorAction SilentlyContinue }
            New-Item -ItemType Directory -Path $staging -Force | Out-Null
            Copy-Item (Join-Path $appDir '*') $staging -Force
            $resolved | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $staging 'resolved-env.json') -Encoding utf8
            Write-Host "DEPLOY-STAGED mode=push gitSha=$sha — push-staging\ is ready (gitignored)."
            Write-Host "HUMAN STEPS: open the harness page ($($resolved.pages.harness.path)), click 'run upload.js', select ALL files from push-staging\, set a Note, click Upload, then use 'copy results JSON' to report back."
        }
    }
    'sync-live' {
        # Stub: delegates to the project's existing Sync-Live pipeline if present.
        $syncLive = Join-Path $PSScriptRoot 'Sync-Live.ps1'
        if (Test-Path $syncLive) { & $syncLive; if ($LASTEXITCODE -ne 0) { throw "Sync-Live.ps1 failed (exit $LASTEXITCODE)" } }
        else { throw "sync-live is a stub: place your existing Sync-Live.ps1 pattern at $syncLive to enable it." }
    }
}
