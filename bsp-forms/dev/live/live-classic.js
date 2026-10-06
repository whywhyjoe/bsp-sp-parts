// DEV ONLY: drive the live classic-link form (page from
//   live-page.ps1 -PageName bsp-forms-classic-url-test -Config classic-url-request.json)
// through found / not-found / bad-link, and read the saved requests back via REST.
// Lists come from live-classic-lists.ps1; the converter is the dev stand-in live-setup.ps1 sets.
// Creates three real items in the dev Classic-URL-Requests list each run.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const OUT = os.tmpdir();
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')); }

const SITE = tenants.dev.siteUrl.replace(/\/$/, '');
const PAGE = SITE + '/SitePages/bsp-forms-classic-url-test.aspx';
const CONVERTER = SITE; // live-setup.ps1 stand-in
const NAME = 'Policy Library & Forms (Q3/Q4) - Ops'; // seeded by live-classic-lists.ps1
const OLD = 'https://old.example/sites/FCU/Pages/Policy Library.aspx?id=7&view=all';
const J = { accept: 'application/json;odata=nometadata' };

async function open(ctx, params) {
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') page.__errors.push(e.message); });
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  await page.goto(PAGE + (qs ? '?' + qs : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  return page;
}
async function submit(page) {
  await page.fill('[data-bspf-field="sourceDescription"] textarea', 'Live test: the Policy hub page, left nav.');
  await page.evaluate(() => { [...document.querySelectorAll('.bspf button')].find(b => /Get new link/.test(b.textContent)).click(); });
  await page.waitForSelector('.bspf-result', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1280, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SITE).origin });
  const listApi = SITE + "/_api/web/GetList('" + encodeURIComponent(new URL(SITE).pathname + '/Lists/Classic-URL-Requests') + "')";

  // ---- found
  let page = await open(ctx, { Link: OLD, ResourceName: NAME });
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.evaluate(() => Array.from(document.querySelectorAll('.bspf-doctor tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())));
  console.log('DOCTOR:\n' + doctor.map(r => '  ' + r.join(' | ')).join('\n'));
  check('doctor: requests + lookup lists all OK', doctor.length === 5 && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; '));
  const before = await page.evaluate(async ({ s, J }) => (await (await fetch(s + '/items?$select=Id&$orderby=Id desc&$top=1', { headers: J })).json()).value, { s: listApi, J });
  const lastId = before.length ? before[0].Id : 0;
  check('ResourceName displayed decoded', (await page.locator('.bspf-readonly__value').textContent()) === NAME);
  await page.evaluate(() => { const d = document.querySelector('.bspf-doctor'); if (d) d.remove(); });
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'classic-form.png') });
  await submit(page);
  const href = await page.locator('.bspf-result__link').getAttribute('href');
  check('found → link to the redirect row URL', href === SITE + '/SitePages/bsp-forms-gsi-intake-test.aspx', href);
  check('found → link text is the resource name', (await page.locator('.bspf-result__link').textContent()).trim() === NAME);
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'classic-found.png') });
  check('no page errors (found)', !page.__errors.length, page.__errors.join(' | '));
  await page.close();

  // ---- found, apostrophe in the name (OData escaping)
  page = await open(ctx, { Link: OLD, ResourceName: "Director's Handbook" });
  await submit(page);
  const href2 = await page.locator('.bspf-result__link').getAttribute('href');
  check("apostrophe name → found", href2 === SITE + '/SitePages/bsp-forms-gsi-creative-test.aspx', href2);
  await page.close();

  // ---- not found: copy + countdown + redirect
  page = await open(ctx, { Link: OLD, ResourceName: 'No Such Resource' });
  await submit(page);
  check('not found → converter message', /copied to your clipboard/.test(await page.locator('.bspf-result').textContent()));
  check('original link on the clipboard', (await page.evaluate(() => navigator.clipboard.readText())) === OLD);
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'classic-notfound.png') });
  await page.waitForURL(u => u.href.replace(/\/$/, '') === CONVERTER || u.href.startsWith(CONVERTER + '/SitePages/Home'), { timeout: 15000 }).catch(() => {});
  check('redirects to the converter after the countdown', page.url().startsWith(CONVERTER) && !/classic-url-test/.test(page.url()), page.url());
  await page.close();

  // ---- bad link: straight to the converter
  page = await open(ctx, { ResourceName: NAME });
  check('missing Link → converter screen, no form', await page.locator('.bspf-result').isVisible() && !(await page.locator('form.bspf__body').isVisible()));
  await page.waitForURL(u => !/classic-url-test/.test(u.href), { timeout: 15000 }).catch(() => {});
  check('missing Link → redirects', !/classic-url-test/.test(page.url()), page.url());
  await page.close();

  // ---- read back
  page = await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  const items = await page.evaluate(async ({ s, id, J }) => (await (await fetch(s + '/items?$filter=Id gt ' + id +
    '&$select=Id,Title,Link,ResourceName,SourceDescription&$orderby=Id', { headers: J })).json()).value, { s: listApi, id: lastId, J });
  console.log('ITEMS:', JSON.stringify(items));
  check('three requests saved', items.length === 3, items.length);
  if (items[0]) {
    check('1: Link + ResourceName + SourceDescription', items[0].Link === OLD && items[0].ResourceName === NAME && /Policy hub/.test(items[0].SourceDescription));
    check('1: Title from template', items[0].Title === 'Classic link: ' + NAME, items[0].Title);
  }
  if (items[2]) check('3: unmatched name saved too', items[2].ResourceName === 'No Such Resource');
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
