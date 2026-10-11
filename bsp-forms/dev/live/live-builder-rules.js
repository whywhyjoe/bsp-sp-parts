// DEV ONLY: Phase 3 of the form builder against the real dev list BSPF Builder Test.
//   node live-builder-rules.js           build a branching form with the builder (show-when page,
//                                        end-when, choice limit, business-day date rule, "are you
//                                        sure?", redirect), run it in the builder's PREVIEW on the real
//                                        page and prove the preview writes nothing to SharePoint,
//                                        then download it to %TEMP%\bspf-dev\builder-rules.json
//   (then: live-builder.ps1 -Publish -Name builder-rules -Ver <n>)
//   node live-builder-rules.js --submit  submit the published form down both branches; read back
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }

const SITE = tenants.dev.siteUrl.replace(/\/$/, '');
const SITE_REL = new URL(SITE).pathname.replace(/\/$/, '');
const OUT = path.join(os.tmpdir(), 'bspf-dev');
const J = { accept: 'application/json;odata=nometadata' };
const B = 'document.querySelector(".bfb")._x_dataStack[0]';
const API = SITE + "/_api/web/GetList('" + encodeURIComponent(SITE_REL + '/Lists/BSPFBuilderTest') + "')/items?$top=1&$orderby=Id desc&$select=Id,Title,TxtReq,ChoiceA,Multi,DateOnlyCol,PersonId";

async function clickBtn(scope, re) {
  await scope.page().waitForTimeout(150);
  const ok = await scope.evaluate((el, src) => {
    const r = new RegExp(src);
    const b = [...el.querySelectorAll('button')].find(x => x.offsetParent && r.test(x.textContent.trim()));
    if (b) b.click();
    return !!b;
  }, re.source);
  if (!ok) throw new Error('no visible button ' + re);
}

async function build(ctx) {
  const page = await ctx.newPage();
  const errors = [], writesSeen = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') errors.push(e.message); });
  // anything that would write: item adds, attachments, ensureUser
  page.on('request', r => { if (r.method() === 'POST' && /\/items|AttachmentFiles|ensureuser/i.test(r.url())) writesSeen.push(r.method() + ' ' + r.url()); });
  await page.goto(SITE + '/SitePages/bsp-forms-builder.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bspf-builder][data-bfb-state="ready"]', { timeout: 60000 });
  await page.evaluate(B + '.discardDraft()');
  await page.click('.bfb-listchip');
  await page.waitForSelector('.bfb-listrow', { timeout: 30000 });
  await page.click('.bfb-listrow:has-text("BSPF Builder Test")');
  await page.waitForFunction(B + '.schema.state === "ready"', null, { timeout: 30000 });

  await page.evaluate(() => {
    const s = document.querySelector('.bfb')._x_dataStack[0];
    s.doc.form.title = 'Builder rules test';
    s.doc.target.titleTemplate = '{form:title} — {date}';
    const sec = s.doc.pages[0].sections[0].id;
    s.addField(sec, 'person'); s.curField().label = 'Requester'; s.labelInput(); s.setColumn('Person'); s.setMe(true);
    s.addField(sec, 'text'); s.curField().label = 'Required text'; s.labelInput(); s.setColumn('TxtReq');
    s.addField(sec, 'choice'); s.curField().label = 'Level'; s.labelInput(); s.setColumn('ChoiceA');
    delete s.curField().default; // start empty, so the branch is chosen on purpose
    s.curField().required = true;
    s.addField(sec, 'boolean'); s.curField().label = 'Extra details'; s.labelInput(); s.setLogicOnly(true);
    // page 1 ends the form when Level is High
    s.select('page', s.doc.pages[0].id);
    s.addCond('page', 'endWhen');
    const end = s.rr('page', 'endWhen').rows[0];
    s.setCondField(end, 'level'); s.setCondOp(end, 'equals'); end.value = 'High';
    // page 2 shows when Extra details is on
    s.addPage();
    const p2 = s.doc.pages[1];
    s.select('page', p2.id); s.addCond('page', 'visibleWhen');
    const show = s.rr('page', 'visibleWhen').rows[0];
    s.setCondField(show, 'extraDetails'); s.setCondOp(show, 'on');
    const sec2 = p2.sections[0].id;
    s.addField(sec2, 'multichoice'); s.curField().label = 'Colours'; s.labelInput(); s.setColumn('Multi');
    s.setCwOn(true); s.setCwDriver('level');
    // Low → Red only; Medium → Green, Blue
    ['Green', 'Blue'].forEach(v => s.cwToggle('Low', v));
    s.cwToggle('Medium', 'Red');
    s.addField(sec2, 'date'); s.curField().label = 'Needed by'; s.labelInput(); s.setColumn('DateOnlyCol'); s.curField().required = true;
    s.addDateRule('biz');
    s.setConfirmOn(true);
    s.setRedirectOn(true); s.doc.confirmation.redirect.url = location.pathname.replace(/\/SitePages\/.*$/, '') + '/SitePages/Home.aspx'; s.doc.confirmation.redirect.seconds = 2;
  });
  await page.waitForTimeout(1000);
  const st = await page.evaluate('(' + B + '.flush(), { e: ' + B + '.nErr, issues: ' + B + '.issues.map(i => i.level + ": " + i.msg) })');
  check('the branching form has no problems', st.e === 0, st.issues);
  const json = JSON.parse(await page.evaluate(B + '.jsonText()'));
  check('JSON: page 1 endWhen Level = High; page 2 visibleWhen extraDetails on', JSON.stringify(json.pages[0].endWhen) === '{"field":"level","op":"equals","value":"High"}' &&
    JSON.stringify(json.pages[1].visibleWhen) === '{"field":"extraDetails","op":"equals","value":true}', [json.pages[0].endWhen, json.pages[1].visibleWhen]);
  const colours = json.pages[1].sections[0].fields[0];
  check('JSON: choice limit Low → Red, Medium → Green+Blue, High → all', JSON.stringify(colours.choicesWhen.map) === '{"Low":["Red"],"Medium":["Green","Blue"],"High":["Red","Green","Blue"]}', colours.choicesWhen);
  const needed = json.pages[1].sections[0].fields[1];
  check('JSON: business days + blocking weekdays + Toronto business hours', JSON.stringify(needed.rules) === '[{"op":"minBusinessDays","days":2,"mode":"block"},{"op":"businessDay","mode":"block"}]' && json.form.businessHours.timeZone === 'America/Toronto', needed.rules);

  // ---- the preview, on the real page: live reads, no writes, no navigation
  if (!(await page.evaluate(B + '.pv.on'))) await page.evaluate(B + '.togglePreview()');
  await page.waitForSelector('.bfb-preview__stage .bspf', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const pv = page.locator('.bfb-preview__stage');
  check('preview has its own Alpine scope', await page.evaluate(() => document.querySelector('.bfb-preview__stage .bspf')._x_dataStack.length === 1));
  const me = await page.evaluate(async J => (await (await fetch(location.origin + location.pathname.replace(/\/SitePages\/.*$/, '') + '/_api/web/currentuser?$select=Id,Title', { headers: J })).json()), J);
  check('preview: @me from the real user', (await pv.locator('[data-bspf-field="requester"] .bspf-people__tag').textContent()).includes(me.Title));
  await pv.locator('[data-bspf-field="requiredText"] input').fill('Preview only');
  await pv.locator('[data-bspf-field="level"] .bspf-combo__control').click();
  await pv.locator('[data-bspf-field="level"] .bspf-combo__option:has-text("Low")').click();
  await pv.locator('[data-bspf-field="extraDetails"] .switch').click();
  await page.waitForTimeout(300);
  check('preview: page 2 joins the stepper when Extra details is on', (await pv.locator('.stepper__step:visible').count()) === 2);
  await clickBtn(pv, /^Next$/);
  await page.waitForTimeout(400);
  const opts = await pv.locator('[data-bspf-field="colours"] .bspf-combo__option').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent.trim()));
  check('preview: Low → only Red offered', JSON.stringify(opts) === '["Red"]', opts);
  await pv.locator('[data-bspf-field="colours"] .bspf-combo__control').click();
  await pv.locator('[data-bspf-field="colours"] .bspf-combo__option:has-text("Red")').click();
  await page.keyboard.press('Escape');
  const min = await pv.locator('[data-bspf-field="neededBy"] input').getAttribute('min');
  await pv.locator('[data-bspf-field="neededBy"] input').fill(min);
  await clickBtn(pv, /^Submit/);
  await page.waitForSelector('.bfb-preview__stage .bspf-dialog:visible', { timeout: 5000 });
  check('preview: "are you sure?" with Yes / No', /Yes/.test(await pv.locator('.bspf-dialog__ok').textContent()) && /No/.test(await pv.locator('.bspf-dialog__alt').textContent()));
  await pv.locator('.bspf-dialog__ok').click();
  await page.waitForSelector('.bfb-preview__stage .bspf-done:visible', { timeout: 10000 });
  const url0 = page.url();
  await page.waitForTimeout(3500);
  check('preview: the redirect is only described, the page stays', page.url() === url0 && /would go to/.test(await pv.locator('.bspf-done').textContent()));
  check('preview: NO write reached SharePoint (items / attachments / ensureuser)', writesSeen.length === 0, writesSeen);
  await page.waitForTimeout(700);
  const saved = JSON.parse(await page.evaluate(B + '.pv.json || "[]"'));
  const add = saved.find(w => w.op === 'addItem');
  check('preview: "what would be saved" has the item', add && add.payload.ChoiceA === 'Low' && JSON.stringify(add.payload.Multi) === '{"results":["Red"]}' && add.payload.TxtReq === 'Preview only', add && add.payload);
  await page.locator('.bfb').screenshot({ path: path.join(os.tmpdir(), 'bfb-live-p3.png') });

  // download
  await page.evaluate(B + '.openDownload(); ' + B + '.dl.slug = "builder-rules"');
  await page.waitForTimeout(300);
  fs.mkdirSync(OUT, { recursive: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bfb-filecard:has-text(".json")')]);
  await dl.saveAs(path.join(OUT, 'builder-rules.json'));
  const norm = await page.evaluate(cfg => BSPForms.normalize(cfg).errors, JSON.parse(fs.readFileSync(path.join(OUT, 'builder-rules.json'), 'utf8')));
  check('downloaded JSON loads', norm.length === 0, norm);
  check('no page errors (builder)', !errors.length, errors.join(' | '));
  await page.close();
}

async function submit(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') errors.push(e.message); });
  const FORM = SITE + '/SitePages/bsp-forms-builder-rules-test.aspx';
  async function open() {
    await page.goto(FORM, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
    await page.waitForTimeout(1200);
  }
  async function last() { return page.evaluate(async ({ API, J }) => (await (await fetch(API, { headers: J })).json()).value[0], { API, J }); }
  await open();
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.$$eval('.bspf-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  check('doctor: every row OK', doctor.length && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; ') || doctor.length + ' rows');
  await page.evaluate(() => { const d = document.querySelector('.bspf-doctor'); if (d) d.remove(); });
  const form = page.locator('.bspf');
  // A: Low + extra → page 2 → Red + a date
  const before = await last();
  await page.fill('[data-bspf-field="requiredText"] input', 'Branch A');
  await page.click('[data-bspf-field="level"] .bspf-combo__control');
  await page.click('[data-bspf-field="level"] .bspf-combo__option:has-text("Low")');
  await page.click('[data-bspf-field="extraDetails"] .switch');
  await clickBtn(form, /^Next$/);
  await page.waitForTimeout(300);
  await page.click('[data-bspf-field="colours"] .bspf-combo__control');
  await page.click('[data-bspf-field="colours"] .bspf-combo__option:has-text("Red")');
  await page.keyboard.press('Escape');
  const min = await page.getAttribute('[data-bspf-field="neededBy"] input', 'min');
  await page.fill('[data-bspf-field="neededBy"] input', min);
  await clickBtn(form, /^Submit/);
  await page.waitForSelector('.bspf-dialog:visible', { timeout: 5000 });
  await page.click('.bspf-dialog__ok');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 30000 });
  const a = await last();
  console.log('A:', JSON.stringify(a));
  check('A: saved down the long branch', a.Id > (before ? before.Id : 0) && a.TxtReq === 'Branch A' && a.ChoiceA === 'Low' && JSON.stringify(a.Multi) === '["Red"]' && String(a.DateOnlyCol).slice(0, 10) === min, a);
  await page.waitForURL(u => !/builder-rules-test/.test(u.href), { timeout: 8000 }).catch(() => {});
  check('A: the confirmation redirect ran', !/builder-rules-test/.test(page.url()), page.url());
  // B: High → the form ends on page 1
  await open();
  await page.fill('[data-bspf-field="requiredText"] input', 'Branch B');
  await page.click('[data-bspf-field="level"] .bspf-combo__control');
  await page.click('[data-bspf-field="level"] .bspf-combo__option:has-text("High")');
  await page.click('[data-bspf-field="extraDetails"] .switch'); // on, but High ends the form first
  const nav = await page.$$eval('.bspf-nav button', bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim()));
  check('B: High → Submit on page 1, no Next', !nav.includes('Next') && nav.some(t => /^Submit/.test(t)), nav);
  await clickBtn(form, /^Submit/);
  await page.waitForSelector('.bspf-dialog:visible', { timeout: 5000 });
  await page.click('.bspf-dialog__ok');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 30000 });
  const b = await last();
  console.log('B:', JSON.stringify(b));
  check('B: saved, page-2 columns absent', b.Id > a.Id && b.ChoiceA === 'High' && !b.Multi && !b.DateOnlyCol, b);
  check('no page errors (form)', !errors.length, errors.join(' | '));
  await page.close();
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1700, height: 1200 }, acceptDownloads: true });
  if (process.argv.includes('--submit')) await submit(ctx); else await build(ctx);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
