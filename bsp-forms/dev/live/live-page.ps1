param([string]$PageName = 'bsp-forms-gsi-intake-test', [string]$Config = 'gsi-digital-initiatives-intake.json',
      [string]$Title = 'BSP Forms - GSI intake (test)', [string]$Ver = '1', [switch]$NoValidate)
# DEV ONLY: (re)create a test page (default bsp-forms-gsi-intake-test.aspx, -Config picks the form) from the site's _app-template.aspx (working Modern Script
# Editor web part) and replace its SEWP script with the bsp-forms snippet. Bump -Ver on every
# engine upload. (Add-PnPPageWebPart -Component <guid> saves the SEWP with a null webPartId on
# this tenant - an empty shell - which is why the page is copied from the template instead.)
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev
$siteRel = ([uri]$t.dev.siteUrl).AbsolutePath.TrimEnd('/')
$codeRel = "$siteRel/$($t.dev.roots.code)"
$pagesRel = "$siteRel/SitePages"

function J([string]$s) { $b = [char]92; $s.Replace('<', "${b}u003C").Replace('>', "${b}u003E").Replace('"', "${b}u0022").Replace("`n", "${b}n") }
$old = J "<div id=`"sp-env-harness`"></div>`n<div id=`"sp-env-app-root`"></div>`n<script src=`"__SP_ENV_SCRIPT__`"></script>"
$validate = if ($NoValidate) { '' } else { ' data-validate' }
$new = J "<div data-bsp-form$validate data-config=`"$codeRel/bsp-forms/forms/$Config`"></div>`n<script src=`"$codeRel/bsp-forms/bsp-forms.js?v=$Ver`"></script>"

$target = "$pagesRel/$PageName.aspx"
if (Get-PnPFile -Url $target -Connection $conn -ErrorAction SilentlyContinue) {
  Remove-PnPFile -ServerRelativeUrl $target -Recycle -Force -Connection $conn
  Write-Host "recycled old $PageName.aspx"
}
Copy-PnPFile -SourceUrl "$pagesRel/_app-template.aspx" -TargetUrl $target -Force -Connection $conn
$item = Get-PnPFile -Url $target -AsListItem -Connection $conn
$canvas = [string]$item['CanvasContent1']
if (-not $canvas.Contains($old)) { throw 'template SEWP script string not found verbatim - inspect _app-template.aspx' }
Set-PnPListItem -List 'Site Pages' -Identity $item.Id -Values @{ CanvasContent1 = $canvas.Replace($old, $new); Title = $Title } -Connection $conn | Out-Null
Set-PnPPage -Identity $PageName -Publish -Connection $conn | Out-Null
$check = [string](Get-PnPFile -Url $target -AsListItem -Connection $conn)['CanvasContent1']
if (-not $check.Contains('data-bsp-form')) { throw 'rewrite did not land' }
Write-Host "PAGE: $($t.dev.siteUrl)/SitePages/$PageName.aspx (published, rewrite verified)"
