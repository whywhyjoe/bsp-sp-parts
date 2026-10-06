// DEV ONLY: drive the live GSI Digital & Creative intake (page from
//   live-page.ps1 -PageName bsp-forms-gsi-creative-test -Config gsi-digital-creative-intake.json)
// end to end and read the created items back via REST from the cross-site twin list
// (live-crosssite.js). The engine's business clock is pinned with the BSPForms.clock seam to
// Friday 17:00 Eastern, so the urgent prompt behaves the same whenever this runs; the dates it
// enters are in 2030, so the real-clock past-date rule never interferes.
// Creates two real items in the dev twin list each run. Screenshots go to the OS temp dir.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const OUT = os.tmpdir();
const FRI_5PM_ET = Date.parse('2030-01-11T22:00:00Z'); // January: ET = UTC-5
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')); }

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
async function person(page, field, q) {
  const inp = page.locator(`[data-bspf-field="${field}"] .bspf-people__input`);
  await inp.click(); await inp.fill(q);
  await page.waitForSelector(`[data-bspf-field="${field}"] .bspf-people__option`, { timeout: 15000 });
  await page.locator(`[data-bspf-field="${field}"] .bspf-people__option`).first().click();
}
async function afterSubmit(page) {
  await page.waitForFunction(() => {
    const done = document.querySelector('.bspf-done');
    if (done && done.offsetParent !== null) return true;
    const err = document.querySelector('.bspf__pageerror');
    return !!(err && err.offsetParent !== null && !document.querySelector('.bspf .spinner:not([style*="none"])'));
  }, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const done = document.querySelector('.bspf-done');
    if (done && done.offsetParent !== null) return 'done';
    const errs = [...document.querySelectorAll('.bspf .field__error')].filter(e => e.offsetParent !== null).map(e => e.innerText);
    return 'error: ' + document.querySelector('.bspf__pageerror').innerText + ' | ' + errs.join('; ');
  });
}

(async () => {
  const site = tenants.dev.siteUrl;
  const listApi = tenants.dev.tenantRoot.replace(/\/$/, '') + "/_api/web/GetList('" + encodeURIComponent('/Lists/Creative Services Intake') + "')";
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(t => { window.BSPForms = window.BSPForms || {}; window.BSPForms.clock = () => t; }, FRI_5PM_ET);
  const page = ctx.pages()[0] || await ctx.newPage();
  const errs = [];
  // SharePoint's own chrome throws two message-less errors on every load; ignore those
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') errs.push(e.message); });
  await page.goto(site + '/SitePages/bsp-forms-gsi-creative-test.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.evaluate(() => Array.from(document.querySelectorAll('.bspf-doctor tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())));
  console.log('DOCTOR:\n' + doctor.map(r => '  ' + r.join(' | ')).join('\n'));
  check('doctor: every row OK', doctor.length === 11 && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; ') || doctor.length + ' rows');
  const look = await page.evaluate(() => ({
    grids: [...document.querySelectorAll('.bspf-fields--2')].map(g => getComputedStyle(g).gridTemplateColumns.split(' ').length),
    unresolved: [...new Set([...document.querySelectorAll('.bspf use')].map(u => u.getAttribute('href')).filter(h => !document.getElementById(h.slice(1))))],
    headIcon: (document.querySelector('.bspf__head-icon') || {}).naturalWidth,
    sw: (document.querySelector('[data-bspf-field="priority"] .switch') || {}).textContent
  }));
  check('three 2-column sections', look.grids.length === 3 && look.grids.every(n => n === 2), JSON.stringify(look.grids));
  check('every sprite <use> resolves; brand icon loads', !look.unresolved.length && look.headIcon > 0, look.unresolved.join(',') + ' / ' + look.headIcon);
  check('Priority switch starts on "Standard"', (look.sw || '').trim() === 'Standard', look.sw);

  const before = await page.evaluate(async (s) => (await (await fetch(s + '/items?$select=Id&$orderby=Id desc&$top=1', { headers: { accept: 'application/json;odata=nometadata' } })).json()).value, listApi);
  const lastId = before.length ? before[0].Id : 0;
  const dlg = page.locator('.bspf-dialog');
  const sw = page.locator('[data-bspf-field="priority"] input[type="checkbox"]');
  const date = page.locator('[data-bspf-field="launchDate"] input');

  // ---- submission 1: next-business-day launch, user clicks OK -> Urgent
  await page.fill('[data-bspf-field="title"] input', 'Creative live test 1 — urgent');
  await person(page, 'requestor', 'joe');
  await page.fill('[data-bspf-field="department"] input', 'FCU Digital (dev test)');
  await person(page, 'partners', 'joe');
  await pick(page, 'requestType', 'Graphics/Decks');
  await pick(page, 'pillar', 'GSI/Comms');
  await date.fill('2030-01-14'); // Mon 5pm ET = 8 working hours after Fri 5pm: within one business day
  await page.waitForTimeout(400);
  check('next-business-day date → prompt', await dlg.isVisible());
  check('prompt text and buttons', await page.evaluate(() => {
    const d = document.querySelector('.bspf-dialog');
    return /next business day requests, your intake will be marked urgent/i.test(d.innerText) &&
      d.querySelector('.bspf-dialog__ok').textContent === 'OK' && d.querySelector('.bspf-dialog__alt').textContent === 'Change to 48 hours';
  }));
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'creative-prompt.png') }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, 'creative-prompt-page.png') });
  await page.click('.bspf-dialog__ok');
  await page.waitForTimeout(250);
  check('OK → Urgent, locked, note shown', (await sw.isChecked()) && (await sw.isDisabled()) &&
    await page.locator('[data-bspf-field="priority"] .bspf-field__lock').isVisible());
  await page.fill('[data-bspf-field="description"] textarea', 'Deck refresh.\nSecond line.');
  await page.fill('[data-bspf-field="links"] textarea', '/sites/x/page-one\n/sites/x/page-two');
  await pick(page, 'translation', 'Yes');
  await page.setInputFiles('input[type="file"]', [{ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('dev test attachment') }]);
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'creative-filled.png') });
  await navClick(page, 'Submit request');
  const r1 = await afterSubmit(page);
  check('submission 1 → confirmation', r1 === 'done', r1);

  // ---- submission 2: same date, user picks "Change to 48 hours" -> Tue, Standard
  await navClick(page, 'Submit another');
  await page.waitForTimeout(600);
  await person(page, 'requestor', 'joe');
  await page.fill('[data-bspf-field="department"] input', 'Team Two');
  await pick(page, 'pillar', 'Other');
  await date.fill('2030-01-14');
  await page.waitForTimeout(400);
  check('prompt again after reset', await dlg.isVisible());
  await page.click('.bspf-dialog__alt');
  await page.waitForTimeout(250);
  check('"Change to 48 hours" → Tue 2030-01-15, Standard, unlocked',
    (await date.inputValue()) === '2030-01-15' && !(await sw.isChecked()) && !(await sw.isDisabled()), await date.inputValue());
  await page.fill('[data-bspf-field="description"] textarea', 'Second test, moved date.');
  await navClick(page, 'Submit request');
  const r2 = await afterSubmit(page);
  check('submission 2 → confirmation', r2 === 'done', r2);

  // ---- read back
  const items = await page.evaluate(async ({ s, id }) => {
    const u = s + '/items?$filter=Id gt ' + id +
      '&$select=Id,Title,Requestor/Title,PartnersId,Department,Priority,field_6,RequestType,Pillar_x002f_Partner,field_9,field_7,TranslationRequired,Attachments,AttachmentFiles/FileName&$expand=Requestor,AttachmentFiles&$orderby=Id';
    return (await (await fetch(u, { headers: { accept: 'application/json;odata=nometadata' } })).json()).value;
  }, { s: listApi, id: lastId });
  console.log('ITEMS:', JSON.stringify(items, null, 1));
  const [a, b] = items;
  check('two items created', items.length === 2, items.length);
  if (a) {
    check('1: Priority "Urgent" (not a list choice — REST accepts it)', a.Priority === 'Urgent', a.Priority);
    check('1: launch date kept (Mon 2030-01-14)', /^2030-01-14/.test(a.field_6 || ''), a.field_6);
    check('1: Partners saved', a.PartnersId && (a.PartnersId.results || a.PartnersId).length === 1, JSON.stringify(a.PartnersId));
    check('1: Links/Location keeps line breaks', /page-one<br\s*\/?>\/sites\/x\/page-two/.test(a.field_7 || ''), JSON.stringify(a.field_7));
    check('1: Description keeps line breaks', /Deck refresh\.<br\s*\/?>Second line\./.test(a.field_9 || ''));
    check('1: Translation Required = Yes', a.TranslationRequired === 'Yes');
    check('1: RequestType + Pillar', a.RequestType === 'Graphics/Decks' && JSON.stringify(a.Pillar_x002f_Partner) === '["GSI/Comms"]');
    check('1: attachment uploaded', a.Attachments && a.AttachmentFiles.length === 1);
  }
  if (b) {
    check('2: Priority "Standard"', b.Priority === 'Standard', b.Priority);
    check('2: date moved to Tue 2030-01-15', /^2030-01-15/.test(b.field_6 || ''), b.field_6);
    check('2: Title from template', /^Team Two request — /.test(b.Title || ''), b.Title);
    check('2: Translation left blank', b.TranslationRequired === null, b.TranslationRequired);
  }
  check('no page errors', !errs.length, errs.join(' | '));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
