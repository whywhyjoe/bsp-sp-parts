// DEV ONLY: drive the live GSI intake form (page from live-page.ps1) end to end and read the
// created items back via REST. Uses the sp-env Playwright profile; screenshots go to the OS temp dir.
// Creates two real items in the dev test list each run.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const OUT = os.tmpdir();
const LIST = 'Creative Digital Solutions Intake';
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')); }

async function navClick(page, text) {
  await page.waitForTimeout(150);
  const ok = await page.evaluate((t) => {
    const btns = [...document.querySelectorAll('.bspf button')].filter(b => b.textContent.trim().startsWith(t) && b.offsetParent !== null);
    if (!btns.length) return false; btns[0].click(); return true;
  }, text);
  if (!ok) throw new Error('navClick: no visible button "' + text + '"');
}
async function pick(page, field, text) {
  await page.click(`[data-bspf-field="${field}"] .bspf-combo__control`);
  await page.click(`[data-bspf-field="${field}"] .bspf-combo__option:has-text("${text}")`);
  await page.keyboard.press('Escape');
}
async function afterSubmit(page) {
  await page.waitForFunction(() => {
    const done = document.querySelector('.bspf-done');
    if (done && done.offsetParent !== null) return true;
    const err = document.querySelector('.bspf__pageerror');
    const busy = document.querySelector('.bspf [aria-busy="true"], .bspf .spinner');
    return !!(err && err.offsetParent !== null && !(busy && busy.offsetParent !== null));
  }, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const done = document.querySelector('.bspf-done');
    if (done && done.offsetParent !== null) return 'done';
    const err = document.querySelector('.bspf__pageerror');
    const fieldErrs = [...document.querySelectorAll('.bspf .field__error')].filter(e => e.offsetParent !== null).map(e => (e.closest('[data-bspf-field]') || {}).getAttribute ? e.closest('[data-bspf-field]').getAttribute('data-bspf-field') + ': ' + e.innerText : e.innerText);
    return 'error: ' + (err ? err.innerText : '') + ' | ' + fieldErrs.join('; ');
  });
}
const visible = (page, field) => page.locator(`[data-bspf-field="${field}"]`).isVisible();
function ymd(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

(async () => {
  const site = tenants.dev.siteUrl;
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1280, height: 1000 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (/BSP Forms/.test(m.text()) || m.type() === 'error') errs.push(m.type() + ': ' + m.text()); });
  await page.goto(site + '/SitePages/bsp-forms-gsi-intake-test.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.evaluate(() => Array.from(document.querySelectorAll('.bspf-doctor tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())));
  console.log('DOCTOR:\n' + doctor.map(r => '  ' + r.join(' | ')).join('\n'));
  check('doctor: no Problem rows', doctor.length && !doctor.some(r => r[4] === 'Problem'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; ') || 'all OK');

  const before = await page.evaluate(async (s) => (await (await fetch(s + "/_api/web/lists/getbytitle('Creative Digital Solutions Intake')/items?$select=Id&$orderby=Id desc&$top=1", { headers: { accept: 'application/json;odata=nometadata' } })).json()).value, site);
  const lastId = before.length ? before[0].Id : 0;

  // ---- submission 1: Support High + date + attachment, explicit title
  check('requestedBy hidden before a support type is chosen', !(await visible(page, 'requestedBy')));
  await navClick(page, 'Submit request');
  await page.waitForTimeout(400);
  check('empty submit rejected', await page.locator('.bspf__pageerror').isVisible());

  await page.fill('[data-bspf-field="title"] input', 'Live test 1 — support high');
  await page.click('.bspf-people__input');
  await page.fill('.bspf-people__input', 'joe');
  await page.waitForSelector('.bspf-people__option', { timeout: 15000 });
  await page.locator('.bspf-people__option').first().click();
  await page.fill('[data-bspf-field="department"] input', 'FCU Digital (dev test)');

  await pick(page, 'supportType', 'Hard launch');
  check('requestedBy visible for Hard launch', await visible(page, 'requestedBy'));
  await pick(page, 'supportType', 'Feature request');
  check('requestedBy hidden for Feature request', !(await visible(page, 'requestedBy')));
  await pick(page, 'supportType', 'Consultation');
  check('requestedBy hidden for Consultation', !(await visible(page, 'requestedBy')));
  await pick(page, 'supportType', 'New build');
  check('requestedBy hidden for New build', !(await visible(page, 'requestedBy')));
  await pick(page, 'supportType', 'Support Urgent');
  check('requestedBy visible for Support Urgent', await visible(page, 'requestedBy'));
  await pick(page, 'supportType', 'Support: Correction');
  check('requestedBy visible for Support: Correction', await visible(page, 'requestedBy'));
  await pick(page, 'supportType', 'Support High');
  check('requestedBy visible for Support High', await visible(page, 'requestedBy'));

  await page.fill('[data-bspf-field="requestedBy"] input', ymd(-1));
  await navClick(page, 'Submit request');
  await page.waitForTimeout(500);
  check('past requested-by date blocked', await page.locator('[data-bspf-field="requestedBy"] .field__error').isVisible());
  await page.fill('[data-bspf-field="requestedBy"] input', ymd(10));

  await pick(page, 'requestType', 'Development/Sharepoint');
  await pick(page, 'pillar', 'RR&C');
  await pick(page, 'pillar', 'GSI/OCM');
  await page.fill('[data-bspf-field="description"] textarea', 'Line one of the description.\nLine two, after a newline.');
  await page.fill('[data-bspf-field="userBase"] input', 'FCU employees');
  await page.setInputFiles('input[type="file"]', [{ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('dev test attachment') }]);
  await page.screenshot({ path: path.join(OUT, 'live-filled.png'), fullPage: true });
  await navClick(page, 'Submit request');
  const r1 = await afterSubmit(page);
  check('submission 1 → confirmation', r1 === 'done', r1);
  await page.screenshot({ path: path.join(OUT, 'live-done.png'), fullPage: true });

  // ---- submission 2: Feature request (no date), blank title → titleTemplate
  await navClick(page, 'Submit another');
  await page.waitForTimeout(600);
  await page.click('.bspf-people__input');
  await page.fill('.bspf-people__input', 'joe');
  await page.waitForSelector('.bspf-people__option', { timeout: 15000 });
  await page.locator('.bspf-people__option').first().click();
  await page.fill('[data-bspf-field="department"] input', 'Team Two');
  await pick(page, 'supportType', 'Hard launch');
  await page.fill('[data-bspf-field="requestedBy"] input', ymd(5));
  await pick(page, 'supportType', 'Feature request');   // hides the date again: it must NOT be submitted
  await pick(page, 'pillar', 'Other');
  await page.fill('[data-bspf-field="description"] textarea', 'Second test, no date.');
  await navClick(page, 'Submit request');
  const r2 = await afterSubmit(page);
  check('submission 2 → confirmation (list-required field_6 left empty)', r2 === 'done', r2);

  // ---- read back
  const items = await page.evaluate(async ({ s, id }) => {
    const u = s + "/_api/web/lists/getbytitle('Creative Digital Solutions Intake')/items?$filter=Id gt " + id +
      '&$select=Id,Title,RequestorId,Requestor/Title,Department,Priority,field_6,RequestType,Pillar_x002f_Partner,field_9,UserBase,Attachments,AttachmentFiles/FileName&$expand=Requestor,AttachmentFiles&$orderby=Id';
    return (await (await fetch(u, { headers: { accept: 'application/json;odata=nometadata' } })).json()).value;
  }, { s: site, id: lastId });
  console.log('ITEMS:', JSON.stringify(items, null, 1));
  const [a, b] = items;
  check('two items created', items.length === 2, items.length);
  if (a) {
    check('1: Title as typed', a.Title === 'Live test 1 — support high', a.Title);
    check('1: Requestor resolved', !!a.RequestorId, a.Requestor && a.Requestor.Title);
    check('1: Department', a.Department === 'FCU Digital (dev test)');
    check('1: Priority', a.Priority === 'Support High: Item is degraded', a.Priority);
    check('1: field_6 set to requested date', a.field_6 && a.field_6.slice(0, 10) >= ymd(9), a.field_6);
    check('1: RequestType', a.RequestType === 'Development/Sharepoint');
    check('1: Pillar multi', JSON.stringify(a.Pillar_x002f_Partner) === JSON.stringify(['RR&C', 'GSI/OCM']), JSON.stringify(a.Pillar_x002f_Partner));
    check('1: field_9 has text', /Line one/.test(a.field_9 || ''), JSON.stringify(a.field_9));
    check('1: UserBase', a.UserBase === 'FCU employees');
    check('1: attachment uploaded', a.Attachments && a.AttachmentFiles.length === 1, a.AttachmentFiles.map(f => f.FileName).join());
  }
  if (b) {
    check('2: Title from template', /^Team Two request — /.test(b.Title || ''), b.Title);
    check('2: Priority Feature request', b.Priority === 'Feature request: New feature or functionality');
    check('2: hidden field_6 not submitted', b.field_6 === null, b.field_6);
    check('2: no RequestType', b.RequestType === null);
  }
  console.log('CONSOLE:', JSON.stringify(errs.filter(e => !/registerIcons|contentSourceFilter|Failed to load resource/.test(e))));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
