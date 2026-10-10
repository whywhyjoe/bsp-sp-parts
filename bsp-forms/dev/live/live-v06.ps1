# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# Uploads live-v06.json (the engine 0.6.0 live-test form, targeting BSPF Builder Test from
# live-builder-list.ps1) with __DEV_SITE__ set to the dev site, then builds its test page.
# Run live-setup.ps1 first (it uploads the engine). Then: node live-v06.js
param([string]$Ver = '60')
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev
$siteRel = ([uri]$t.dev.siteUrl).AbsolutePath.TrimEnd('/')
$cfgText = Get-Content (Join-Path $PSScriptRoot 'live-v06.json') -Raw
if (-not $cfgText.Contains('__DEV_SITE__')) { throw 'live-v06.json has no __DEV_SITE__ token' }
$devDir = Join-Path ([IO.Path]::GetTempPath()) 'bspf-dev'
New-Item -ItemType Directory -Force -Path $devDir | Out-Null
$out = Join-Path $devDir 'live-v06.json'
[IO.File]::WriteAllText($out, $cfgText.Replace('__DEV_SITE__', $siteRel))
Add-PnPFile -Path $out -Folder "$($t.dev.roots.code)/bsp-forms/forms" -Connection $conn | Out-Null
Write-Host "uploaded live-v06.json"
& (Join-Path $PSScriptRoot 'live-page.ps1') -PageName 'bsp-forms-v06-test' -Config 'live-v06.json' -Title 'BSP Forms - 0.6.0 (test)' -Ver $Ver
