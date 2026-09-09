<#
.SYNOPSIS
Generates deploymentSettings.local.json (gitignored — tenant values never go
in the repo) for pp-import-dev.ps1. Site URL comes from the resolver; the
shared mailbox, Teams error recipient, and the three dev connection ids are
parameters. Find connection ids with:  pac connection list
(the SharePoint, Office 365 Outlook, and Microsoft Teams connections of the
dev admin — create any missing one once in the maker portal).

Usage:
  pwsh -File tools/sp/pp-make-settings.ps1 `
    -SharedMailbox bsp-notify@<devdomain> -TeamsErrorRecipient <user@devdomain> `
    -SharePointConnectionId <guid> -OutlookConnectionId <guid> -TeamsConnectionId <guid>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SharedMailbox,
    [Parameter(Mandatory)][string]$TeamsErrorRecipient,
    [Parameter(Mandatory)][string]$SharePointConnectionId,
    [Parameter(Mandatory)][string]$OutlookConnectionId,
    [Parameter(Mandatory)][string]$TeamsConnectionId
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$resolvedJson = node (Join-Path $PSScriptRoot 'resolve.js') $repo
if ($LASTEXITCODE -ne 0) { throw "resolver failed: $resolvedJson" }
$resolved = $resolvedJson | ConvertFrom-Json

$settings = [ordered]@{
    EnvironmentVariables = @(
        @{ SchemaName = 'bsp_BspNotifySiteUrl'; Value = $resolved.siteUrl },
        @{ SchemaName = 'bsp_BspNotifyListName'; Value = $resolved.lists.notifications.title },
        @{ SchemaName = 'bsp_BspNotifySharedMailbox'; Value = $SharedMailbox },
        @{ SchemaName = 'bsp_BspNotifyTeamsErrorRecipient'; Value = $TeamsErrorRecipient }
    )
    ConnectionReferences = @(
        @{ LogicalName = 'bsp_BspNotifySharePoint'; ConnectionId = $SharePointConnectionId; ConnectorId = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline' },
        @{ LogicalName = 'bsp_BspNotifyOutlook'; ConnectionId = $OutlookConnectionId; ConnectorId = '/providers/Microsoft.PowerApps/apis/shared_office365' },
        @{ LogicalName = 'bsp_BspNotifyTeams'; ConnectionId = $TeamsConnectionId; ConnectorId = '/providers/Microsoft.PowerApps/apis/shared_teams' }
    )
}
$out = Join-Path $PSScriptRoot 'deploymentSettings.local.json'
$settings | ConvertTo-Json -Depth 5 | Set-Content $out -Encoding utf8
Write-Host "PP-MAKE-SETTINGS-OK -> $out (siteUrl and list name from the resolver; NEVER commit this file)"
