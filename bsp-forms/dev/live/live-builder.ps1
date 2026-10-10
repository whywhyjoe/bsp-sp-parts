# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# The form builder on dev, in two steps around live-builder.js:
#   live-builder.ps1 -Ver <n>            upload the builder (+ run live-setup.ps1 first for the
#                                        engine) and (re)build SitePages/bsp-forms-builder.aspx
#   live-builder.ps1 -Publish -Ver <n>   upload the JSON live-builder.js downloaded
#                                        (%TEMP%\bspf-dev\builder-live.json) as forms/builder-live.json
#                                        and build its form page, bsp-forms-builder-live-test.aspx
param([string]$Ver = '1', [switch]$Publish)
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev
$siteRel = ([uri]$t.dev.siteUrl).AbsolutePath.TrimEnd('/')
$codeRel = "$siteRel/$($t.dev.roots.code)"
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$devDir = Join-Path ([IO.Path]::GetTempPath()) 'bspf-dev'

if ($Publish) {
  $json = Join-Path $devDir 'builder-live.json'
  if (-not (Test-Path $json)) { throw "no $json - run node live-builder.js first" }
  Add-PnPFile -Path $json -Folder "$($t.dev.roots.code)/bsp-forms/forms" -Connection $conn | Out-Null
  Write-Host "uploaded builder-live.json"
  & (Join-Path $PSScriptRoot 'live-page.ps1') -PageName 'bsp-forms-builder-live-test' -Config 'builder-live.json' -Title 'BSP Forms - builder output (test)' -Ver $Ver
  return
}

foreach ($f in 'bsp-forms-builder.js', 'bsp-forms-builder.css') {
  Add-PnPFile -Path (Join-Path $repo "builder\$f") -Folder "$($t.dev.roots.code)/bsp-forms/builder" -Connection $conn | Out-Null
}
Write-Host "uploaded the builder to $codeRel/bsp-forms/builder/"
$snippet = "<div data-bspf-builder></div>`n<script src=`"$codeRel/bsp-forms/bsp-forms.js?v=$Ver`"></script>`n<script src=`"$codeRel/bsp-forms/builder/bsp-forms-builder.js?v=$Ver`"></script>"
& (Join-Path $PSScriptRoot 'live-page.ps1') -PageName 'bsp-forms-builder' -Title 'BSP Forms - builder (dev)' -Snippet $snippet
