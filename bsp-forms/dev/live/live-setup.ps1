# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# Uploads bsp-forms.js, bsp-forms.css and the live configs to <code root>/bsp-forms/ on the dev
# site (the prod layout, beside bsp-design/ and lib/) via PnP, not the OneDrive mirror, plus the
# bilingual library to the lib root. The lists come from live-crosssite.js (GSI),
# live-classic-lists.ps1 and live-zone-lists.js.
# Order: node live-crosssite.js (once) -> live-setup.ps1 -> live-page.ps1 -Ver <n> -> node live-submit.js
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev
$siteRel = ([uri]$t.dev.siteUrl).AbsolutePath.TrimEnd('/')
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# engine + config (prod layout: <code root>/bsp-forms/ beside bsp-design/ and lib/)
$codeRel = "$siteRel/$($t.dev.roots.code)"
$folder = "$($t.dev.roots.code)/bsp-forms"
foreach ($f in 'bsp-forms.js', 'bsp-forms.css') {
  Add-PnPFile -Path (Join-Path $repo $f) -Folder $folder -Connection $conn | Out-Null
}
# The repo config targets PROD's list site; on dev the twin list lives on the tenant root site
# (live-crosssite.js), so the uploaded copy swaps only target.siteUrl - listUrl is identical.
$prodSite = '"siteUrl": "/sites/FCUCommunicationsSecurityAwareness"'
$devDir = Join-Path ([IO.Path]::GetTempPath()) 'bspf-dev'
New-Item -ItemType Directory -Force -Path $devDir | Out-Null
foreach ($name in 'gsi-digital-initiatives-intake.json', 'gsi-digital-creative-intake.json') {
  $cfgText = Get-Content (Join-Path $repo "forms\$name") -Raw
  if (-not $cfgText.Contains($prodSite)) { throw "$name no longer has $prodSite - update live-setup.ps1" }
  $devCfg = Join-Path $devDir $name
  [IO.File]::WriteAllText($devCfg, $cfgText.Replace($prodSite, '"siteUrl": "/"'))
  Add-PnPFile -Path $devCfg -Folder "$folder/forms" -Connection $conn | Out-Null
}
# classic-url-request.json: its lists are on prod /sites/FCUPortal; on dev they're on the dev site
# (live-classic-lists.ps1). The converter URL is empty in the repo until the user supplies it, so
# dev points it at the dev site's home page as a stand-in redirect target.
$name = 'classic-url-request.json'
$cfgText = Get-Content (Join-Path $repo "forms\$name") -Raw
$prodPortal = '"siteUrl": "/sites/FCUPortal"'
if (-not $cfgText.Contains($prodPortal)) { throw "$name no longer has $prodPortal - update live-setup.ps1" }
$cfgText = $cfgText.Replace($prodPortal, "`"siteUrl`": `"$siteRel`"")
$cfgText = [regex]::Replace($cfgText, '"converterUrl":\s*"[^"]*"', "`"converterUrl`": `"$($t.dev.siteUrl)`"")
[IO.File]::WriteAllText((Join-Path $devDir $name), $cfgText)
Add-PnPFile -Path (Join-Path $devDir $name) -Folder "$folder/forms" -Connection $conn | Out-Null
# ps-zone-attestation.json: prod's lists are on /teams/FCUWebDatastores, a different site from the
# page; on dev the twins are on the tenant root site (live-zone-lists.js), so both siteUrl lines
# swap to "/". The empty job aid URL becomes the dev site's home page, so the card shows.
$name = 'ps-zone-attestation.json'
$cfgText = Get-Content (Join-Path $repo "forms\$name") -Raw
$prodStore = '"siteUrl": "/teams/FCUWebDatastores"'
if (([regex]::Matches($cfgText, [regex]::Escape($prodStore))).Count -ne 2) { throw "$name no longer has two $prodStore lines - update live-setup.ps1" }
$cfgText = $cfgText.Replace($prodStore, '"siteUrl": "/"')
if ($cfgText -notmatch '"jobAidUrl":\s*""') { throw "$name no longer has an empty jobAidUrl - update live-setup.ps1" }
$cfgText = [regex]::Replace($cfgText, '"jobAidUrl":\s*""', "`"jobAidUrl`": `"$($t.dev.siteUrl)`"")
[IO.File]::WriteAllText((Join-Path $devDir $name), $cfgText)
Add-PnPFile -Path (Join-Path $devDir $name) -Folder "$folder/forms" -Connection $conn | Out-Null
# the bilingual library, which bilingual forms load from the shared lib folder
$bilingual = Join-Path (Split-Path $repo -Parent) 'bilingual\intl.js'
Add-PnPFile -Path $bilingual -Folder $t.dev.roots.lib -Connection $conn | Out-Null
Write-Host "uploaded engine + 4 configs (2 GSI, classic-url-request, ps-zone-attestation) to $codeRel/bsp-forms/, intl.js to $siteRel/$($t.dev.roots.lib)/"
