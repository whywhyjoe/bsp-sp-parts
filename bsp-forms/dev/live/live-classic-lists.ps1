# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# The two lists forms/classic-url-request.json uses, on the dev site (prod: /sites/FCUPortal),
# with the column names that config assumes. Idempotent; seeds Classic-URL-Redirects with rows
# the live test (live-classic.js) looks up — one name carries special characters on purpose.
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev

function Ensure-List([string]$name, [hashtable]$fields) {
  $list = Get-PnPList -Identity "Lists/$name" -Connection $conn -ErrorAction SilentlyContinue
  if (-not $list) {
    New-PnPList -Title $name -Url "Lists/$name" -Template GenericList -Connection $conn | Out-Null
    Write-Host "created list $name"
  }
  $have = (Get-PnPField -List "Lists/$name" -Connection $conn) | ForEach-Object InternalName
  foreach ($k in $fields.Keys) {
    if ($have -contains $k) { Write-Host "  have $k"; continue }
    Add-PnPFieldFromXml -List "Lists/$name" -FieldXml $fields[$k] -Connection $conn | Out-Null
    Write-Host "  added $k"
  }
}

Ensure-List 'Classic-URL-Requests' @{
  'Link'              = '<Field Type="Text" Name="Link" StaticName="Link" DisplayName="Link" MaxLength="255" />'
  'ResourceName'      = '<Field Type="Text" Name="ResourceName" StaticName="ResourceName" DisplayName="ResourceName" MaxLength="255" />'
  'SourceDescription' = '<Field Type="Note" Name="SourceDescription" StaticName="SourceDescription" DisplayName="SourceDescription" NumLines="6" RichText="FALSE" />'
}
Ensure-List 'Classic-URL-Redirects' @{
  'ResourceName' = '<Field Type="Text" Name="ResourceName" StaticName="ResourceName" DisplayName="ResourceName" MaxLength="255" />'
  'URL'          = '<Field Type="URL" Name="URL" StaticName="URL" DisplayName="URL" Format="Hyperlink" />'
}

$seed = @(
  @{ name = "Policy Library & Forms (Q3/Q4) - Ops"; url = "$($t.dev.siteUrl)/SitePages/bsp-forms-gsi-intake-test.aspx" }
  # an apostrophe exercises the OData literal escaping ('' inside the filter)
  @{ name = "Director's Handbook"; url = "$($t.dev.siteUrl)/SitePages/bsp-forms-gsi-creative-test.aspx" }
)
$rows = Get-PnPListItem -List 'Lists/Classic-URL-Redirects' -Connection $conn
foreach ($s in $seed) {
  if ($rows | Where-Object { $_['ResourceName'] -eq $s.name }) { Write-Host "  seed row exists: $($s.name)"; continue }
  Add-PnPListItem -List 'Lists/Classic-URL-Redirects' -Values @{ Title = $s.name; ResourceName = $s.name; URL = "$($s.url), $($s.name)" } -Connection $conn | Out-Null
  Write-Host "  seeded: $($s.name)"
}
