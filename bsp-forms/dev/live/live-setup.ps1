# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# Uploads bsp-forms.js, bsp-forms.css and forms/gsi-digital-initiatives-intake.json to
# <code root>/bsp-forms/ on the dev site (the prod layout, beside bsp-design/ and lib/) via PnP,
# not the OneDrive mirror. The list the form writes to is created by live-crosssite.js.
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
Write-Host "uploaded engine + 2 GSI configs to $codeRel/bsp-forms/"
