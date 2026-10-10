# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# BSPF Builder Test: one column of every type the form builder maps, plus the ones it must
# refuse, on the dev site. Used by the B0 schema probe (live-builder-probe.js) and later by the
# builder's live tests. Idempotent: existing columns are left alone. -Reset recycles the list first.
param([switch]$Reset)
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$conn = Connect-SpEnvDev
$url = 'Lists/BSPFBuilderTest'

if ($Reset -and (Get-PnPList -Identity $url -Connection $conn -ErrorAction SilentlyContinue)) {
  Remove-PnPList -Identity $url -Recycle -Force -Connection $conn
  Write-Host 'recycled the old list'
}
$list = Get-PnPList -Identity $url -Connection $conn -ErrorAction SilentlyContinue
if (-not $list) {
  New-PnPList -Title 'BSPF Builder Test' -Url $url -Template GenericList -Connection $conn | Out-Null
  Write-Host 'created list BSPF Builder Test'
}
# a lookup target (the classic-link fixture list, from live-classic-lists.ps1)
$redirects = Get-PnPList -Identity 'Lists/Classic-URL-Redirects' -Connection $conn -ErrorAction SilentlyContinue

$fields = [ordered]@{
  'TxtShort'      = '<Field Type="Text" Name="TxtShort" StaticName="TxtShort" DisplayName="TxtShort" MaxLength="50" />'
  'TxtReq'        = '<Field Type="Text" Name="TxtReq" StaticName="TxtReq" DisplayName="TxtReq" Required="TRUE" />'
  'TxtDefault'    = '<Field Type="Text" Name="TxtDefault" StaticName="TxtDefault" DisplayName="TxtDefault"><Default>Hello</Default></Field>'
  'NotePlain'     = '<Field Type="Note" Name="NotePlain" StaticName="NotePlain" DisplayName="NotePlain" NumLines="6" RichText="FALSE" />'
  'NoteRich'      = '<Field Type="Note" Name="NoteRich" StaticName="NoteRich" DisplayName="NoteRich" NumLines="6" RichText="TRUE" RichTextMode="FullHtml" />'
  'NumPlain'      = '<Field Type="Number" Name="NumPlain" StaticName="NumPlain" DisplayName="NumPlain" Min="0" Max="100" Decimals="0" />'
  'NumDefault'    = '<Field Type="Number" Name="NumDefault" StaticName="NumDefault" DisplayName="NumDefault"><Default>7</Default></Field>'
  'NumPct'        = '<Field Type="Number" Name="NumPct" StaticName="NumPct" DisplayName="NumPct" Percentage="TRUE" />'
  'Money'         = '<Field Type="Currency" Name="Money" StaticName="Money" DisplayName="Money" LCID="4105" />'
  'ChoiceA'       = '<Field Type="Choice" Name="ChoiceA" StaticName="ChoiceA" DisplayName="ChoiceA" FillInChoice="FALSE" Format="Dropdown"><Default>Medium</Default><CHOICES><CHOICE>Low</CHOICE><CHOICE>Medium</CHOICE><CHOICE>High</CHOICE></CHOICES></Field>'
  'ChoiceFill'    = '<Field Type="Choice" Name="ChoiceFill" StaticName="ChoiceFill" DisplayName="ChoiceFill" FillInChoice="TRUE" Format="Dropdown"><CHOICES><CHOICE>Alpha</CHOICE><CHOICE>Beta</CHOICE></CHOICES></Field>'
  'ChoiceReqDef'  = '<Field Type="Choice" Name="ChoiceReqDef" StaticName="ChoiceReqDef" DisplayName="ChoiceReqDef" Required="TRUE" Format="Dropdown"><Default>Standard</Default><CHOICES><CHOICE>Standard</CHOICE><CHOICE>Urgent</CHOICE></CHOICES></Field>'
  'Multi'         = '<Field Type="MultiChoice" Name="Multi" StaticName="Multi" DisplayName="Multi" FillInChoice="FALSE"><CHOICES><CHOICE>Red</CHOICE><CHOICE>Green</CHOICE><CHOICE>Blue</CHOICE></CHOICES></Field>'
  'DateOnlyCol'   = '<Field Type="DateTime" Name="DateOnlyCol" StaticName="DateOnlyCol" DisplayName="DateOnlyCol" Format="DateOnly" />'
  'DateTimeCol'   = '<Field Type="DateTime" Name="DateTimeCol" StaticName="DateTimeCol" DisplayName="DateTimeCol" Format="DateTime" />'
  'YesNo'         = '<Field Type="Boolean" Name="YesNo" StaticName="YesNo" DisplayName="YesNo"><Default>0</Default></Field>'
  'Person'        = '<Field Type="User" Name="Person" StaticName="Person" DisplayName="Person" UserSelectionMode="PeopleOnly" List="UserInfo" ShowField="ImnName" />'
  'People'        = '<Field Type="UserMulti" Name="People" StaticName="People" DisplayName="People" UserSelectionMode="PeopleOnly" Mult="TRUE" List="UserInfo" ShowField="ImnName" />'
  'LinkCol'       = '<Field Type="URL" Name="LinkCol" StaticName="LinkCol" DisplayName="LinkCol" Format="Hyperlink" />'
  'PicCol'        = '<Field Type="URL" Name="PicCol" StaticName="PicCol" DisplayName="PicCol" Format="Image" />'
  'UniqueCode'    = '<Field Type="Text" Name="UniqueCode" StaticName="UniqueCode" DisplayName="UniqueCode" EnforceUniqueValues="TRUE" Indexed="TRUE" />'
  'EvenNum'       = '<Field Type="Number" Name="EvenNum" StaticName="EvenNum" DisplayName="EvenNum"><Validation Message="Must be even">=MOD([EvenNum],2)=0</Validation></Field>'
  'CalcCol'       = '<Field Type="Calculated" Name="CalcCol" StaticName="CalcCol" DisplayName="CalcCol" ResultType="Text"><Formula>=Title&amp;"!"</Formula><FieldRefs><FieldRef Name="Title" /></FieldRefs></Field>'
  '_Under'        = '<Field Type="Text" Name="_Under" StaticName="_Under" DisplayName="_Under" />'
}
if ($redirects) {
  $fields['LookupCol'] = "<Field Type=`"Lookup`" Name=`"LookupCol`" StaticName=`"LookupCol`" DisplayName=`"LookupCol`" List=`"{$($redirects.Id)}`" ShowField=`"Title`" />"
}

$have = (Get-PnPField -List $url -Connection $conn) | ForEach-Object InternalName
foreach ($k in $fields.Keys) {
  if ($have -contains $k) { Write-Host "  have $k"; continue }
  Add-PnPFieldFromXml -List $url -FieldXml $fields[$k] -Connection $conn | Out-Null
  Write-Host "  added $k"
}
# a column whose display name starts with a digit: SharePoint encodes the internal name (_x0032_...)
if (-not ((Get-PnPField -List $url -Connection $conn) | Where-Object { $_.Title -eq '2Num' })) {
  Add-PnPField -List $url -DisplayName '2Num' -InternalName '2Num' -Type Number -Connection $conn | Out-Null
  Write-Host '  added 2Num'
}
(Get-PnPField -List $url -Connection $conn) | Where-Object { -not $_.Hidden -and -not $_.FromBaseType -or $_.InternalName -eq 'Title' } |
  ForEach-Object { '{0,-16} {1,-12} req={2}' -f $_.InternalName, $_.TypeAsString, $_.Required }
