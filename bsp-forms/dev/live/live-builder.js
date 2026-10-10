// DEV ONLY: the form builder against the real dev list BSPF Builder Test.
//   node live-builder.js           build: open SitePages/bsp-forms-builder.aspx (live-builder.ps1),
//                                  pick the list, check the column catalog the real schema gives,
//                                  build a form, download the JSON + stub to %TEMP%\bspf-dev\
//   (then: live-builder.ps1 -Publish -Ver <n>)
//   node live-builder.js --submit  open the published form, submit it, read the item back
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')); }

const SITE = tenants.dev.siteUrl.replace(/\/$/, '');
const SITE_REL = new URL(SITE).pathname.replace(/\/$/, '');
const OUT = path.join(os.tmpdir(), 'bspf-dev');
const J = { accept: 'application/json;odata=nometadata' };
const B = 'document.querySelector(".bfb")._x_dataStack[0]';

async function build(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') errors.push(e.message); });
  await page.goto(SITE + '/SitePages/bsp-forms-builder.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bspf-builder][data-bfb-state="ready"]', { timeout: 60000 });
  check('builder mounts on a real page', true);
  await page.evaluate(B + '.discardDraft && ' + B + '.discardDraft()');
  await page.click('.bfb-listchip');
  await page.waitForSelector('.bfb-listrow', { timeout: 30000 });
  const titles = await page.$$eval('.bfb-listrow strong', els => els.map(e => e.textContent.trim()));
  check('this site’s custom lists are offered', titles.includes('BSPF Builder Test') && titles.includes('Classic-URL-Requests'), titles.length + ' lists');
  await page.click('.bfb-listrow:has-text("BSPF Builder Test")');
  await page.waitForFunction(B.replace('document', 'document') + '.schema.state !== "loading"', null, { timeout: 30000 });
  const cat = await page.evaluate(B + '.catalogCols().map(c => ({ n: c.name, ok: c.ok, why: c.reason, t: c.type }))');
  const by = Object.fromEntries(cat.map(c => [c.n, c]));
  check('schema read from the real list', cat.length >= 25, cat.length + ' columns');
  check('excluded: CalcCol, LookupCol, NumPct, PicCol', ['CalcCol', 'LookupCol', 'NumPct', 'PicCol'].every(n => by[n] && !by[n].ok),
    ['CalcCol', 'LookupCol', 'NumPct', 'PicCol'].map(n => n + ':' + (by[n] ? by[n].ok : 'missing')).join(' '));
  check('mappable: _Under and _x0032_Num (EntityPropertyName follows the rule)', by._Under && by._Under.ok && by._x0032_Num && by._x0032_Num.ok);
  check('system columns left out', !by.Author && !by.Created && !by.ContentType, Object.keys(by).filter(n => /^(Author|Created|Editor|Modified|ContentType)$/.test(n)).join(','));
  const tgt = await page.evaluate(B + '.doc.target');
  check('target = this web + the list’s real URL', tgt.siteUrl === SITE_REL && tgt.listUrl === SITE_REL + '/Lists/BSPFBuilderTest', JSON.stringify(tgt));

  // build: one control per mapping, through the builder's own methods
  const plan = [['text', 'Required text', 'TxtReq'], ['choice', 'Level', 'ChoiceA'], ['number', 'Score', 'NumPlain'],
    ['person', 'Requester', 'Person'], ['multichoice', 'Colours', 'Multi'], ['date', 'Needed by', 'DateOnlyCol'],
    ['url', 'Reference link', 'LinkCol'], ['text', 'Underscore', '_Under']];
  await page.evaluate(({ plan }) => {
    const s = document.querySelector('.bfb')._x_dataStack[0];
    s.doc.form.title = 'Builder live test';
    s.doc.target.titleTemplate = '{form:title} — {user:name}';
    const sec = s.doc.pages[0].sections[0].id;
    plan.forEach(([kind, label, col]) => {
      s.addField(sec, kind);
      s.cur.label = label;
      s.labelInput();
      s.setColumn(col);
    });
    // a slider (0..100 from the column) and the signed-in user as requester
    s.select('field', 'score'); s.setDisplay('slider');
    s.select('field', 'requester'); s.setMe(true);
  }, { plan });
  await page.waitForTimeout(800);
  await page.evaluate(B + '.recheck()');
  const st = await page.evaluate('({ e: ' + B + '.nErr, w: ' + B + '.nWarn, issues: ' + B + '.issues.map(i => i.level + ": " + i.msg) })');
  check('a complete form has no problems', st.e === 0, JSON.stringify(st.issues));
  const fld = await page.evaluate(B + '.doc.pages[0].sections[0].fields');
  const f = Object.fromEntries(fld.map(x => [x.id, x]));
  check('TxtReq forced required, maxLength 255', f.requiredText.required === true && f.requiredText.validation.maxLength === 255);
  check('ChoiceA: the column’s choices + its default', JSON.stringify(f.level.choices.map(c => c.value)) === '["Low","Medium","High"]' && f.level.default === 'Medium');
  check('NumPlain bounds 0..100 from the column', f.score.validation.min === 0 && f.score.validation.max === 100);
  check('LinkCol → link; DateOnlyCol → no time', f.referenceLink.type === 'link' && !f.neededBy.includeTime);
  await page.locator('.bfb').screenshot({ path: path.join(os.tmpdir(), 'bfb-live-builder.png') });

  // download both files
  await page.evaluate(B + '.openDownload(); ' + B + '.dl.slug = "builder-live"');
  await page.waitForTimeout(300);
  fs.mkdirSync(OUT, { recursive: true });
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bfb-filecard:has-text(".json")')]);
  await dl.saveAs(path.join(OUT, 'builder-live.json'));
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bfb-filecard:has-text(".webpart.html")')]);
  await dl.saveAs(path.join(OUT, 'builder-live.webpart.html'));
  const json = JSON.parse(fs.readFileSync(path.join(OUT, 'builder-live.json'), 'utf8'));
  const stub = fs.readFileSync(path.join(OUT, 'builder-live.webpart.html'), 'utf8');
  const norm = await page.evaluate(cfg => BSPForms.normalize(cfg).errors, json);
  check('downloaded JSON loads (BSPForms.normalize)', norm.length === 0, JSON.stringify(norm));
  check('downloaded JSON: sendEmpty, $builder last', json.target.sendEmpty === true && Object.keys(json).pop() === '$builder');
  check('stub points at Code/bsp-forms/forms/builder-live.json + the engine', stub.includes('data-config="' + SITE_REL + '/FCUPortal/Code/bsp-forms/forms/builder-live.json"') || /data-config="[^"]*\/bsp-forms\/forms\/builder-live\.json"/.test(stub), stub.split('\n').filter(l => /data-config|script/.test(l)).join(' | '));
  check('no page errors (builder)', !errors.length, errors.join(' | '));
  await page.close();
}

async function submit(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') errors.push(e.message); });
  await page.goto(SITE + '/SitePages/bsp-forms-builder-live-test.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.$$eval('.bspf-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  check('doctor: every row OK on the builder’s output', doctor.length === 9 && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; ') || doctor.length + ' rows');
  await page.evaluate(() => { const d = document.querySelector('.bspf-doctor'); if (d) d.remove(); });
  const me = await page.evaluate(async J => (await (await fetch(location.origin + location.pathname.replace(/\/SitePages\/.*$/, '') + '/_api/web/currentuser?$select=Id,Title', { headers: J })).json()), J);
  await page.waitForTimeout(1000);
  const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.fill('[data-bspf-field="requiredText"] input', 'From the builder');
  await page.focus('[data-bspf-field="score"] input[type="range"]');
  await page.keyboard.press('End');
  await page.click('[data-bspf-field="colours"] .bspf-combo__control');
  await page.click('[data-bspf-field="colours"] .bspf-combo__option:has-text("Blue")');
  await page.keyboard.press('Escape');
  await page.fill('[data-bspf-field="neededBy"] input', due);
  await page.fill('[data-bspf-field="referenceLink"] input[type="url"]', 'https://example.com/builder');
  await page.fill('[data-bspf-field="underscore"] input', 'via builder');
  const api = SITE + "/_api/web/GetList('" + encodeURIComponent(SITE_REL + '/Lists/BSPFBuilderTest') + "')/items?$top=1&$orderby=Id desc&$select=Id,Title,TxtReq,ChoiceA,NumPlain,PersonId,Multi,DateOnlyCol,LinkCol,OData__Under";
  const before = await page.evaluate(async ({ api, J }) => (await (await fetch(api, { headers: J })).json()).value[0], { api, J });
  await page.evaluate(() => [...document.querySelectorAll('.bspf button')].find(b => /^Submit/.test(b.textContent.trim()) && b.offsetParent).click());
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 30000 });
  const it = await page.evaluate(async ({ api, J }) => (await (await fetch(api, { headers: J })).json()).value[0], { api, J });
  console.log('ITEM:', JSON.stringify(it));
  check('a new item', it && (!before || it.Id > before.Id));
  check('Title from the item title template', /^Builder live test — /.test(it.Title), it.Title);
  check('TxtReq + ChoiceA default Medium', it.TxtReq === 'From the builder' && it.ChoiceA === 'Medium', JSON.stringify([it.TxtReq, it.ChoiceA]));
  check('slider End → 100', it.NumPlain === 100, it.NumPlain);
  check('@me requester', it.PersonId === me.Id, it.PersonId + ' vs ' + me.Id);
  check('multichoice, date, link', JSON.stringify(it.Multi) === '["Blue"]' && String(it.DateOnlyCol).slice(0, 10) === due && it.LinkCol && it.LinkCol.Url === 'https://example.com/builder');
  check('_Under via OData__Under', it.OData__Under === 'via builder', it.OData__Under);
  check('no page errors (form)', !errors.length, errors.join(' | '));
  await page.close();
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1400, height: 1200 }, acceptDownloads: true });
  if (process.argv.includes('--submit')) await submit(ctx); else await build(ctx);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
