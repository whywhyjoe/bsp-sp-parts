// DEV ONLY: engine 0.6.0 live test (page from live-v06.ps1) against BSPF Builder Test.
// Two submits, read back over REST:
//   A (Full path): @me requester with a real login, a cleared optional choice and an untouched
//     optional text on columns WITH defaults (sendEmpty must save them empty, not the default),
//     an unset dropdown on a column with a default (null, not 7), slider by keyboard,
//     choicesWhen on a yes/no, business-day date (a weekend is rejected), people, link, and the
//     '_Under' column (saved as OData__Under).
//   B (Short path, endWhen on page 1): page 2's columns are left out, so SharePoint applies
//     NumDefault's default (7) there — the opposite of A — and page-1 empties are still null.
// Creates two items in the dev list each run.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')); }

const SITE = tenants.dev.siteUrl.replace(/\/$/, '');
const PAGE = SITE + '/SitePages/bsp-forms-v06-test.aspx';
const LIST_API = SITE + "/_api/web/GetList('" + encodeURIComponent(new URL(SITE).pathname + '/Lists/BSPFBuilderTest') + "')";
const J = { accept: 'application/json;odata=nometadata' };

const st = page => page.evaluate(() => { const d = document.querySelector('.bspf')._x_dataStack[0]; return { page: d.page, view: d.view, values: JSON.parse(JSON.stringify(d.values)), errors: JSON.parse(JSON.stringify(d.errors)) }; });
async function pick(page, field, text) {
  await page.click(`[data-bspf-field="${field}"] .bspf-combo__control`);
  await page.click(`[data-bspf-field="${field}"] .bspf-combo__option:visible:has-text("${text}")`);
  await page.waitForTimeout(150);
}
async function btn(page, text) {
  await page.waitForTimeout(150);
  const ok = await page.evaluate(t => {
    const b = [...document.querySelectorAll('.bspf button')].find(x => x.textContent.trim().startsWith(t) && x.offsetParent !== null);
    if (b) b.click();
    return !!b;
  }, text);
  if (!ok) throw new Error('no visible button ' + text);
}
async function lastItem(page) {
  return page.evaluate(async ({ api, J }) => (await (await fetch(api + "/items?$top=1&$orderby=Id desc&$select=Id,Title,TxtReq,ChoiceA,TxtDefault,ChoiceReqDef,Multi,NumDefault,NumPlain,DateOnlyCol,PersonId,PeopleId,LinkCol,OData__Under", { headers: J })).json()).value[0], { api: LIST_API, J });
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') errors.push(e.message); });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.$$eval('.bspf-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  check('doctor: every mapped column OK (incl. _Under)', doctor.length === 12 && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; ') || doctor.length + ' rows');
  await page.evaluate(() => { const d = document.querySelector('.bspf-doctor'); if (d) d.remove(); });
  const me = await page.evaluate(async J => (await (await fetch(location.origin + new URL(location.href).pathname.replace(/\/SitePages\/.*$/, '') + '/_api/web/currentuser?$select=Id,Title', { headers: J })).json()), J);

  // ---- A: Full path
  await page.waitForTimeout(800);
  let s = await st(page);
  check('@me: requester prefilled with the signed-in user', s.values.requester.length === 1 && s.values.requester[0].text === me.Title, JSON.stringify(s.values.requester));
  check('two pages apply before any answer… only page 1', JSON.stringify(await page.evaluate(() => document.querySelector('.bspf')._x_dataStack[0].activePages())) === '[0]');
  await pick(page, 'path', 'Full');
  await page.fill('[data-bspf-field="txtReq"] input', 'A full');
  await pick(page, 'level', 'High');
  check('optional choice shows a clear button', await page.locator('[data-bspf-field="level"] .bspf-clear').isVisible());
  await page.click('[data-bspf-field="level"] .bspf-clear');
  await pick(page, 'reqDef', 'Urgent');
  check('required choice has no clear button', (await page.locator('[data-bspf-field="reqDef"] .bspf-clear').count()) === 0);
  s = await st(page);
  check('cleared choice is empty', s.values.level === '', JSON.stringify(s.values.level));
  await btn(page, 'Next');
  await page.waitForTimeout(300);
  check('Full → page 2', (await st(page)).page === 1);
  await page.click('[data-bspf-field="warm"] .switch');
  await page.waitForTimeout(150);
  const opts = await page.$$eval('[data-bspf-field="colours"] .bspf-combo__option', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent.trim()));
  check('choicesWhen: warm → Red only', JSON.stringify(opts) === '["Red"]', JSON.stringify(opts));
  await page.click('[data-bspf-field="colours"] .bspf-combo__control');
  await page.click('[data-bspf-field="colours"] .bspf-combo__option:visible:has-text("Red")');
  await page.keyboard.press('Escape');
  await page.focus('[data-bspf-field="numPlain"] input[type="range"]');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const minDate = await page.evaluate(() => document.querySelector('.bspf')._x_dataStack[0].minDate('dateOnly'));
  const minAttr = await page.getAttribute('[data-bspf-field="dateOnly"] input', 'min');
  check('date picker min = earliest allowed date', minAttr === minDate && /^\d{4}-\d{2}-\d{2}$/.test(minDate), minAttr + ' / ' + minDate);
  const sat = (() => { const d = new Date(minDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); })();
  await page.fill('[data-bspf-field="dateOnly"] input', sat);
  await page.locator('[data-bspf-field="dateOnly"] input').blur();
  await page.waitForTimeout(200);
  check('a Saturday past the lead time is rejected', !!(await st(page)).errors.dateOnly, sat + ' → ' + (await st(page)).errors.dateOnly);
  await page.fill('[data-bspf-field="dateOnly"] input', minDate);
  await page.locator('[data-bspf-field="dateOnly"] input').blur();
  await page.waitForTimeout(200);
  check('the earliest allowed date passes', !(await st(page)).errors.dateOnly, (await st(page)).errors.dateOnly);
  await page.click('[data-bspf-field="people"] .bspf-people__input');
  await page.fill('[data-bspf-field="people"] .bspf-people__input', me.Title.slice(0, 4));
  await page.waitForSelector('[data-bspf-field="people"] .bspf-people__option', { timeout: 15000 });
  await page.locator('[data-bspf-field="people"] .bspf-people__option').first().click();
  await page.fill('[data-bspf-field="link"] input[type="url"]', 'https://example.com/v06');
  await page.fill('[data-bspf-field="link"] input[type="text"]', 'Example v06');
  await page.fill('[data-bspf-field="under"] input', 'u-val');
  s = await st(page);
  check('slider set by keyboard (unset → 53)', s.values.numPlain === 53, JSON.stringify(s.values.numPlain));
  check('dropdown left unset', s.values.numDefault === '');
  await page.locator('.bspf').screenshot({ path: path.join(os.tmpdir(), 'v06-live-page2.png') });
  const before = await lastItem(page);
  await btn(page, 'Submit');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 30000 });
  const a = await lastItem(page);
  console.log('A:', JSON.stringify(a));
  check('A: a new item', a && (!before || a.Id > before.Id));
  check('A: cleared ChoiceA saved empty, not its default Medium', a.ChoiceA === null, JSON.stringify(a.ChoiceA));
  check('A: untouched TxtDefault saved empty, not Hello', a.TxtDefault === null, JSON.stringify(a.TxtDefault));
  check('A: unset dropdown NumDefault saved empty, not 7', a.NumDefault === null, JSON.stringify(a.NumDefault));
  check('A: slider value', a.NumPlain === 53, JSON.stringify(a.NumPlain));
  check('A: multichoice', JSON.stringify(a.Multi) === '["Red"]', JSON.stringify(a.Multi));
  check('A: date', String(a.DateOnlyCol || '').length > 0, a.DateOnlyCol);
  check('A: @me requester resolved to my user id', a.PersonId === me.Id, a.PersonId + ' vs ' + me.Id);
  check('A: people', Array.isArray(a.PeopleId) && a.PeopleId.length === 1, JSON.stringify(a.PeopleId));
  check('A: link', a.LinkCol && a.LinkCol.Url === 'https://example.com/v06' && a.LinkCol.Description === 'Example v06', JSON.stringify(a.LinkCol));
  check('A: _Under saved via OData__Under', a.OData__Under === 'u-val', JSON.stringify(a.OData__Under));
  check('A: required choice + text + title', a.ChoiceReqDef === 'Urgent' && a.TxtReq === 'A full' && /Full/.test(a.Title), a.Title);

  // ---- B: Short path (endWhen) after "Submit another"
  await btn(page, 'Submit another');
  await page.waitForTimeout(1200);
  s = await st(page);
  check('Submit another: @me refilled', s.values.requester.length === 1 && s.values.requester[0].text === me.Title);
  await pick(page, 'path', 'Short');
  const navB = await page.evaluate(() => [...document.querySelectorAll('.bspf-nav button')].filter(b => b.offsetParent).map(b => b.textContent.trim()));
  check('endWhen: Submit on page 1, no Next', navB.indexOf('Next') < 0 && navB.some(t => /^Submit/.test(t)), JSON.stringify(navB));
  await page.fill('[data-bspf-field="txtReq"] input', 'B short');
  await pick(page, 'reqDef', 'Standard');
  await btn(page, 'Submit');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 30000 });
  const b = await lastItem(page);
  console.log('B:', JSON.stringify(b));
  check('B: a second new item', b.Id > a.Id);
  check('B: page-1 empties still empty (sendEmpty)', b.ChoiceA === null && b.TxtDefault === null, JSON.stringify([b.ChoiceA, b.TxtDefault]));
  check('B: skipped page left out → NumDefault gets its default 7', b.NumDefault === 7, JSON.stringify(b.NumDefault));
  check('B: skipped page left out → no _Under, no Multi', b.OData__Under === null && !b.Multi, JSON.stringify([b.OData__Under, b.Multi]));
  check('B: title says Short', /Short/.test(b.Title), b.Title);
  check('no page errors', !errors.length, errors.join(' | '));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
