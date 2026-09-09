<#
.SYNOPSIS
DEV-ONLY: import packages/BspNotify_<version>.zip into the dev Power Platform
environment with the deployment settings file, activating the flow. Prod
import is a human maker-portal task (pp-import.md runbook).

Prereqs (one-time on this machine):
  1. pac auth profile for the dev admin (pac auth list — one exists already).
  2. deploymentSettings.local.json next to this script (gitignored — it holds
     tenant values). Generate it with pp-make-settings.ps1.

Usage: pwsh -File tools/sp/pp-import-dev.ps1 [-Version 1.0.0.0]
#>
[CmdletBinding()]
param(
    [string]$Version = '1.0.0.0'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$resolvedJson = node (Join-Path $PSScriptRoot 'resolve.js') $repo
if ($LASTEXITCODE -ne 0) { throw "resolver failed: $resolvedJson" }
$resolved = $resolvedJson | ConvertFrom-Json
if ($resolved.env -ne 'dev') { throw 'pp-import-dev runs on dev only (prod import is a human maker-portal step).' }

$pac = (Get-Command pac -ErrorAction SilentlyContinue).Source
if (-not $pac) { $pac = Join-Path $HOME '.dotnet\tools\pac.exe' }
if (-not (Test-Path $pac)) { throw 'pac CLI not found.' }

$tenants = Get-Content (Join-Path $HOME '.claude\skills\sp-env\tenants.local.json') -Raw | ConvertFrom-Json
$envId = $tenants.dev.powerPlatform.environmentId
if (-not $envId) { throw 'tenants.local.json dev.powerPlatform.environmentId missing.' }

$zip = Join-Path $repo "packages\BspNotify_$Version.zip"
if (-not (Test-Path $zip)) { throw "$zip not found — run pp-pack.ps1 first." }
$settings = Join-Path $PSScriptRoot 'deploymentSettings.local.json'
if (-not (Test-Path $settings)) { throw "$settings missing — run pp-make-settings.ps1 first (it needs the dev connection ids from 'pac connection list')." }

& $pac solution import --environment $envId --path $zip --settings-file $settings --activate-plugins --publish-changes --async --max-async-wait-time 15
if ($LASTEXITCODE -ne 0) { throw "pac solution import failed (exit $LASTEXITCODE)" }
Write-Host 'PP-IMPORT-DEV-OK — verify: flow "BSP Notify" is On in the maker portal, then queue an item and watch it go Sent.'
