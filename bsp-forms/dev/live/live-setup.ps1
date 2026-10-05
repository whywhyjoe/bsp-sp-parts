param([switch]$SkipList)
# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# Live smoke setup for forms/gsi-digital-initiatives-intake.json on the dev site:
#   1. the 'Creative Digital Solutions Intake' test list — only the columns the
#      form writes, with the prod list's INTERNAL names (idempotent);
#   2. uploads bsp-forms.js, bsp-forms.css and the config to <code root>/bsp-forms/
#      (the prod layout, beside bsp-design/ and lib/) via PnP — not the OneDrive mirror.
# Then: live-page.ps1 -Ver <n> (test page), node live-submit.js (end-to-end + REST read-back).
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev
$siteRel = ([uri]$t.dev.siteUrl).AbsolutePath.TrimEnd('/')
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$listTitle = 'Creative Digital Solutions Intake'

if (-not $SkipList) {
  $list = Get-PnPList -Identity $listTitle -Connection $conn -ErrorAction SilentlyContinue
  if (-not $list) {
    $list = New-PnPList -Title $listTitle -Url 'Lists/CreativeServicesIntake' -Template GenericList -Connection $conn
    Write-Host "created list $listTitle"
  }
  $have = (Get-PnPField -List $listTitle -Connection $conn) | ForEach-Object InternalName
  $xml = [ordered]@{
    'Requestor' = '<Field Type="User" Name="Requestor" StaticName="Requestor" DisplayName="Requestor" Required="TRUE" UserSelectionMode="PeopleOnly" />'
    'Department' = '<Field Type="Text" Name="Department" StaticName="Department" DisplayName="Department" Required="TRUE" />'
    'Priority' = '<Field Type="Choice" Name="Priority" StaticName="Priority" DisplayName="Priority" Required="TRUE" Format="Dropdown"><CHOICES><CHOICE>Support Urgent: Item is down/nonfuctional</CHOICE><CHOICE>Support High: Item is degraded</CHOICE><CHOICE>Support: Correction/minor change requested</CHOICE><CHOICE>Feature request: New feature or functionality</CHOICE><CHOICE>Consultation: Meet to determine needs</CHOICE><CHOICE>New build: Includes apps, flows, reports and sites</CHOICE><CHOICE>Hard launch: New item/feature required by date</CHOICE></CHOICES></Field>'
    'RequestType' = '<Field Type="Choice" Name="RequestType" StaticName="RequestType" DisplayName="Request Type" Format="Dropdown"><CHOICES><CHOICE>Development/App</CHOICE><CHOICE>Development/Flow</CHOICE><CHOICE>Development/Sharepoint</CHOICE><CHOICE>Development/Reporting</CHOICE><CHOICE>Graphics/Decks</CHOICE><CHOICE>Graphics/2D</CHOICE><CHOICE>Graphics/Video</CHOICE><CHOICE>Newsletter/Social</CHOICE><CHOICE>Website/New</CHOICE><CHOICE>Website/Update</CHOICE><CHOICE>-----</CHOICE><CHOICE>Creative/Consult</CHOICE><CHOICE>Development/Consult</CHOICE><CHOICE>Website/Consult</CHOICE><CHOICE>Other</CHOICE></CHOICES></Field>'
    'Pillar_x002f_Partner' = '<Field Type="MultiChoice" Name="Pillar_x002f_Partner" StaticName="Pillar_x002f_Partner" DisplayName="Pillar/Partner" Required="TRUE"><CHOICES><CHOICE>BM I&amp;I</CHOICE><CHOICE>Cyber Security</CHOICE><CHOICE>EFM</CHOICE><CHOICE>Physical Security</CHOICE><CHOICE>RR&amp;C</CHOICE><CHOICE>----</CHOICE><CHOICE>GSI/Initiative Management</CHOICE><CHOICE>GSI/Comms</CHOICE><CHOICE>GSI/OCM</CHOICE><CHOICE>GSI/Strategy</CHOICE><CHOICE>GSI/Documentation</CHOICE><CHOICE>T&amp;O</CHOICE><CHOICE>BMO.com</CHOICE><CHOICE>Branch</CHOICE><CHOICE>Enterprise</CHOICE><CHOICE>Other</CHOICE></CHOICES></Field>'
    'field_6' = '<Field Type="DateTime" Name="field_6" StaticName="field_6" DisplayName="Requested Launch Date" Required="TRUE" Format="DateOnly" />'
    'field_9' = '<Field Type="Note" Name="field_9" StaticName="field_9" DisplayName="Description" Required="TRUE" NumLines="6" RichText="TRUE" RichTextMode="FullHtml" />'
    'UserBase' = '<Field Type="Text" Name="UserBase" StaticName="UserBase" DisplayName="UserBase" />'
  }
  foreach ($k in $xml.Keys) {
    if ($have -contains $k) { Write-Host "  have $k"; continue }
    Add-PnPFieldFromXml -List $listTitle -FieldXml $xml[$k] -Connection $conn | Out-Null
    Write-Host "  added $k"
  }
}

# engine + config (prod layout: <code root>/bsp-forms/ beside bsp-design/ and lib/)
$codeRel = "$siteRel/$($t.dev.roots.code)"
$folder = "$($t.dev.roots.code)/bsp-forms"
foreach ($f in 'bsp-forms.js', 'bsp-forms.css') {
  Add-PnPFile -Path (Join-Path $repo $f) -Folder $folder -Connection $conn | Out-Null
}
Add-PnPFile -Path (Join-Path $repo 'forms\gsi-digital-initiatives-intake.json') -Folder "$folder/forms" -Connection $conn | Out-Null
Write-Host "uploaded engine + config to $codeRel/bsp-forms/"
