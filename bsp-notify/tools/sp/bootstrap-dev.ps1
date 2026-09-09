<#
.SYNOPSIS
DEV-ONLY one-time bootstrap (idempotent): ensures the TestRuns list exists and
creates the harness page by copying the site's template page (pages.template)
and rewriting its Script Editor Web Part token __SP_ENV_SCRIPT__ to this
project's harness.js. Uses the global sp-env skill's app-only PnP connection.
Run AFTER the first deploy has synced (harness.js must exist in the library).
Prod has no PnP PowerShell: there, a human creates the harness page once by
copying the template page and pointing its SEWP at harness.js.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $HOME '.claude\skills\sp-env\scripts\sp-env-common.ps1')

$resolvedJson = node (Join-Path $PSScriptRoot 'resolve.js') $repo
if ($LASTEXITCODE -ne 0) { throw "resolver failed: $resolvedJson" }
$resolved = $resolvedJson | ConvertFrom-Json
if ($resolved.env -ne 'dev') { throw 'bootstrap-dev runs on dev only.' }

$conn = Connect-SpEnvDev
function ServerRel([string]$Url) { ([uri]$Url).AbsolutePath }

# ---- TestRuns list ----
$tr = Get-PnPList -Identity 'TestRuns' -Connection $conn -ErrorAction SilentlyContinue
if (-not $tr) {
    New-PnPList -Title 'TestRuns' -Template GenericList -Connection $conn | Out-Null
    Add-PnPField -List 'TestRuns' -DisplayName 'Suite' -InternalName 'Suite' -Type Text -AddToDefaultView -Connection $conn | Out-Null
    Add-PnPField -List 'TestRuns' -DisplayName 'Passed' -InternalName 'Passed' -Type Boolean -AddToDefaultView -Connection $conn | Out-Null
    Add-PnPField -List 'TestRuns' -DisplayName 'Results' -InternalName 'Results' -Type Note -Connection $conn | Out-Null
    Add-PnPField -List 'TestRuns' -DisplayName 'GitSha' -InternalName 'GitSha' -Type Text -Connection $conn | Out-Null
    Write-Host '[bootstrap-dev] TestRuns list created.'
} else { Write-Host '[bootstrap-dev] TestRuns list exists.' }

# ---- harness page from template page ----
$harnessRel  = ServerRel $resolved.pages.harness.url
$templateRel = ServerRel $resolved.pages.template.url
$harnessJs   = "$($resolved.libraries.scripts.url)/harness.js"

$existing = Get-PnPFile -Url $harnessRel -Connection $conn -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[bootstrap-dev] Harness page exists: $harnessRel"
} else {
    $tpl = Get-PnPFile -Url $templateRel -Connection $conn -ErrorAction SilentlyContinue
    if (-not $tpl) {
        # Auto-create the template page with the Modern Script Editor web part
        # (installed on the dev site; componentId verified live in the pilot).
        Write-Host '[bootstrap-dev] Template page missing — creating it with the Modern Script Editor web part.'
        $sewpComponentId = '3a328f0a-99c4-4b28-95ab-fe0847f657a3'
        $snippet = "<div id=`"sp-env-harness`"></div>`n<div id=`"sp-env-app-root`"></div>`n<script src=`"__SP_ENV_SCRIPT__`"></script>"
        $pageName = [System.IO.Path]::GetFileNameWithoutExtension($resolved.pages.template.path)
        try {
            Add-PnPPage -Name $pageName -LayoutType Article -Connection $conn | Out-Null
            $props = @{ script = $snippet; title = 'sp-env template'; removePadding = $false; spPageContextInfo = $false } | ConvertTo-Json -Compress
            Add-PnPPageWebPart -Page $pageName -Component $sewpComponentId -WebPartProperties $props -Connection $conn
            Set-PnPPage -Identity $pageName -Publish -Connection $conn | Out-Null
        } catch {
            throw "Could not auto-create the template page (is the Modern Script Editor web part [$sewpComponentId] installed on this site?): $($_.Exception.Message.Split("`n")[0]). Manual fallback: create '$($resolved.pages.template.path)' with a Script Editor Web Part containing the __SP_ENV_SCRIPT__ token (see app/sewp-snippet.html)."
        }
        $tplLeaf = Split-Path $templateRel -Leaf
        $tplItem = Get-PnPListItem -List 'Site Pages' -Connection $conn -PageSize 500 |
            Where-Object { $_['FileLeafRef'] -eq $tplLeaf } | Select-Object -First 1
        if (-not $tplItem -or ([string]$tplItem['CanvasContent1']) -notmatch '__SP_ENV_SCRIPT__') {
            throw 'Template page was created but the __SP_ENV_SCRIPT__ token did not land in CanvasContent1 — inspect the page before proceeding.'
        }
        Write-Host '[bootstrap-dev] Template page created; token verified in CanvasContent1.'
    }
    Copy-PnPFile -SourceUrl $templateRel -TargetUrl $harnessRel -Force -Connection $conn
    $leaf = Split-Path $harnessRel -Leaf
    $item = Get-PnPListItem -List 'Site Pages' -Connection $conn -PageSize 500 |
        Where-Object { $_['FileLeafRef'] -eq $leaf } | Select-Object -First 1
    if (-not $item) { throw "Copied harness page but cannot find its list item ($leaf)." }
    $canvas = [string]$item['CanvasContent1']
    if ($canvas -notmatch '__SP_ENV_SCRIPT__') { throw "Template page has no __SP_ENV_SCRIPT__ token in its canvas — fix the template page's SEWP content." }
    # LITERAL replacement — PowerShell -replace treats the substitution as a
    # regex template ($& etc.), which can silently write the wrong URL.
    Set-PnPListItem -List 'Site Pages' -Identity $item.Id -Values @{ CanvasContent1 = $canvas.Replace('__SP_ENV_SCRIPT__', $harnessJs) } -Connection $conn | Out-Null
    # The item update lands as a draft on versioned page libraries — publish so
    # ordinary readers get the rewritten page, then verify what published.
    try {
        $hf = Get-PnPFile -Url $harnessRel -AsFileObject -Connection $conn
        $hf.Publish('sp-env bootstrap')
        Invoke-PnPQuery -Connection $conn
    } catch { Write-Warning "[bootstrap-dev] Publish failed/unnecessary ($($_.Exception.Message.Split("`n")[0])) — confirm readers see the rewrite." }
    # SharePoint HTML-encodes the stored canvas (':' becomes '&#58;'), so
    # decode numeric entities before matching — the raw -like check was a
    # false negative when the rewrite had in fact landed (found live).
    $check = (Get-PnPListItem -List 'Site Pages' -Id $item.Id -Fields CanvasContent1 -Connection $conn)['CanvasContent1']
    $checkDecoded = [regex]::Replace("$check", '&#(\d+);', { param($m) [char][int]$m.Groups[1].Value })
    if ($checkDecoded -notlike "*$harnessJs*") { throw 'Harness page rewrite did not stick — CanvasContent1 lacks the harness.js URL.' }
    Write-Host "[bootstrap-dev] Harness page created from template, SEWP -> $harnessJs (published, rewrite verified)"
}
Write-Host 'BOOTSTRAP-DEV-OK'
