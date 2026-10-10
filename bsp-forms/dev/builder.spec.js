/*! BSP Forms · dev/builder.spec.js — headless regression suite for the form builder (dev-only) */
/*
 * Drives the builder harness (builder/dev/builder.dev.html: mock tenant with
 * three lists, one of them the B0 column set of the dev list "BSPF Builder
 * Test") through BUILDER-PLAN Phase 2: list picker + catalog, every control
 * kind and its mapping, schema-forced settings, list switching, logic-only,
 * each B7 schema check, ids + the reference walker, ordering (buttons and
 * drag & drop), undo/redo, autosave, download — and then loads the
 * downloaded JSON into the ENGINE harness and submits it.
 * Never ships.
 *
 * Run (static server on :8000 from the folder holding bsp-sp-parts/ and
 * bsp-design-system/):
 *   node bsp-sp-parts/bsp-forms/dev/builder.spec.js [builderUrl]
 *
 * builderUrl defaults to
 *   http://localhost:8000/bsp-sp-parts/bsp-forms/builder/dev/builder.dev.html
 * ONLY=testIds,testOrdering runs a subset. CHROMIUM=/path pins the browser.
 * Screenshots land in os.tmpdir(): bfb-outline.png, bfb-choice.png,
 * bfb-catalog.png, bfb-download.png.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILDER = process.argv[2] || 'http://localhost:8000/bsp-sp-parts/bsp-forms/builder/dev/builder.dev.html';
const ENGINE = BUILDER.replace(/builder\/dev\/builder\.dev\.html.*$/, 'dev/index.html');
const SHOTS = os.tmpdir();
const DL_DIR = path.join(os.tmpdir(), 'bfb-downloads');
const SOFIA = { key: 'i:0#.f|membership|sofia.chen@example.com', text: 'Sofia Chen', email: 'sofia.chen@example.com' };

let failures = 0, total = 0;
function check(name, ok, detail) {
  total++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  [' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ']'));
  if (!ok) failures++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = a => a.slice().sort();

async function launch() {
  return chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */
// run fn(s, arg) in the page against the builder's Alpine state
const ST = 'document.querySelector(".bfb")._x_dataStack[0]';
function ev(page, fn, arg) {
  return page.evaluate(({ src, arg, ST }) => {
    const s = eval(ST); // eslint-disable-line no-eval
    return eval('(' + src + ')')(s, arg); // eslint-disable-line no-eval
  }, { src: fn.toString(), arg: arg === undefined ? null : arg, ST });
}
const docOf = page => ev(page, s => JSON.parse(JSON.stringify(s.doc)));
const fieldOf = (page, id) => ev(page, (s, id) => { const l = s.loc('field', id); return l ? JSON.parse(JSON.stringify(l.f)) : null; }, id);
const issuesOf = page => ev(page, s => { s.recheck(); return JSON.parse(JSON.stringify(s.issues)); });
const settle = (page, ms) => page.waitForTimeout(ms == null ? 420 : ms); // > the 300 ms change debounce

async function openBuilder(browser, opts) {
  opts = opts || {};
  const ctx = opts.ctx || await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.__errors = [];
  page.__console = [];
  page.on('pageerror', e => { page.__errors.push(e.message); if (process.env.DEBUG) console.log('    PAGEERROR ' + e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) page.__console.push(m.text()); });
  await gotoBuilder(page, opts.fresh !== false);
  return { ctx, page };
}
async function gotoBuilder(page, fresh) {
  await page.goto(BUILDER + (fresh ? '?fresh' : ''));
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-bspf-builder]');
    return m && /ready|error/.test(m.getAttribute('data-bfb-state') || '') && document.querySelector('.bfb') && document.querySelector('.bfb')._x_dataStack;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(150);
}
async function clickIn(page, sel) {
  const ok = await page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
  if (!ok) throw new Error('clickIn: nothing matches ' + sel);
  await page.waitForTimeout(80);
}
// click the first element matching sel whose trimmed text matches re
async function clickText(page, sel, re) {
  const ok = await page.evaluate(({ sel, src, flags }) => {
    const r = new RegExp(src, flags);
    const e = [...document.querySelectorAll(sel)].find(x => r.test(x.textContent.trim()));
    if (!e) return false;
    e.click();
    return true;
  }, { sel, src: re.source, flags: re.flags });
  if (!ok) throw new Error('clickText: no ' + sel + ' matching ' + re);
  await page.waitForTimeout(80);
}
// rendered = has a box (fixed-position scrims have no offsetParent, so don't use it)
const isVisible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
const downloadDisabled = page => page.evaluate(() => [...document.querySelectorAll('.bfb-bar .btn--primary')].find(b => /Download/.test(b.textContent)).disabled);

// open the picker and pick a list; confirm:true accepts a "Switch lists?" dialog
async function pickList(page, title, opts) {
  opts = opts || {};
  await clickIn(page, '.bfb-listchip');
  await page.waitForFunction(() => document.querySelectorAll('.bfb-pick .bfb-listrow').length > 0 &&
    document.querySelector('.bfb-pick .bfb-lists').offsetParent !== null, null, { timeout: 5000 });
  await clickText(page, '.bfb-pick .bfb-listrow', new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  if (opts.confirm) {
    await page.waitForTimeout(80);
    const asked = await ev(page, s => s.ask.open);
    if (asked) await clickIn(page, '.bfb-ask .btn--primary');
  }
  if (opts.expectAsk) return;
  await page.waitForFunction(new Function('t', 'const s = ' + ST + '; return s.schema.state === "ready" && s.listTitle() === t;'), title, { timeout: 5000 });
  await page.waitForTimeout(80);
}
// add a control through the outline's palette; returns its id
async function addControl(page, secId, label) {
  await page.evaluate(id => {
    const n = document.querySelector('[data-bfb-node="section:' + id + '"]');
    n.closest('.bfb-section').querySelector('.bfb-add__btn').click();
  }, secId);
  await page.waitForTimeout(60);
  const ok = await page.evaluate(({ id, label }) => {
    const n = document.querySelector('[data-bfb-node="section:' + id + '"]');
    const it = [...n.closest('.bfb-section').querySelectorAll('.bfb-palette__item')].find(b => b.textContent.trim() === label);
    if (!it) return false;
    it.click();
    return true;
  }, { id: secId, label });
  if (!ok) throw new Error('addControl: no palette item "' + label + '"');
  await page.waitForTimeout(80);
  return ev(page, s => s.sel.id);
}
async function selectNode(page, t, id) {
  await clickIn(page, '[data-bfb-node="' + t + ':' + (id || '') + '"] .bfb-node__main');
}
// pick a column in the selected control's Column select (real change event)
async function mapCol(page, id, col) {
  await selectNode(page, 'field', id);
  await page.selectOption('#bfb-col-' + id, col);
  await page.waitForTimeout(80);
}
const colOptions = (page, id) => page.evaluate(id => [...document.querySelectorAll('#bfb-col-' + id + ' option')].map(o => o.value).filter(Boolean), id);
// a switch in the properties pane, by its label text
const switchOf = (page, text) => page.evaluate(t => {
  const l = [...document.querySelectorAll('.bfb-props label.switch')].find(x => x.textContent.trim() === t);
  if (!l) return null;
  const i = l.querySelector('input');
  return { checked: i.checked, disabled: i.disabled };
}, text);
async function toggleSwitch(page, text) {
  const ok = await page.evaluate(t => {
    const l = [...document.querySelectorAll('.bfb-props label.switch')].find(x => x.textContent.trim() === t);
    if (!l) return false;
    l.querySelector('input').click();
    return true;
  }, text);
  if (!ok) throw new Error('toggleSwitch: no switch "' + text + '"');
  await page.waitForTimeout(80);
}
// the properties-pane input under a field label
function propInput(page, label) {
  return page.locator('.bfb-props .bfb-prop').filter({ has: page.locator('label.field__label', { hasText: new RegExp('^' + label + '$') }) }).locator('input, textarea').first();
}
const has = (issues, re, level) => issues.some(i => re.test(i.msg) && (!level || i.level === level));
const issueLine = issues => issues.map(i => i.level[0] + ':' + i.source[0] + ':' + i.msg).join(' | ');

// a crafted document on the currently picked list: base = a valid form
function craft(base, fields, extra) {
  const d = JSON.parse(JSON.stringify(base));
  d.target.titleTemplate = '{form:title}';
  d.pages = [{ id: 'page1', title: 'Page 1', sections: [{ id: 'section1', title: '', fields: [
    { id: 'req', type: 'text', label: 'Req', column: 'TxtReq', required: true, validation: { maxLength: 255 }, $builder: { kind: 'text' } }
  ].concat(fields || []) }] }];
  if (extra) extra(d);
  return d;
}
async function runDoc(page, doc) {
  return ev(page, (s, d) => { s.doc = d; s.recheck(); return JSON.parse(JSON.stringify(s.issues)); }, doc);
}

/* ------------------------------------------------------------------
   1 + 2. Boot, list picker, catalog, required columns
   ------------------------------------------------------------------ */
async function testBootAndCatalog(browser) {
  console.log('boot:');
  const { ctx, page } = await openBuilder(browser);
  check('builder mounts (data-bfb-state="ready")', await page.getAttribute('[data-bspf-builder]', 'data-bfb-state') === 'ready');
  check('BSPFormsBuilder.version + core exposed', await page.evaluate(() => !!(window.BSPFormsBuilder && BSPFormsBuilder.version && BSPFormsBuilder.core && BSPFormsBuilder.core.computeIssues)));
  let iss = await issuesOf(page);
  check('initial issues include "Pick the SharePoint list…"', has(iss, /^Pick the SharePoint list/, 'error'), issueLine(iss));
  check('Download is disabled', await downloadDisabled(page));
  const engIss = iss.find(i => /target\.listTitle, target\.listUrl or target\.listId is required/.test(i.msg));
  // the engine's own "no list" error says the same thing, so it's folded into the builder's
  check('…and not repeated by the engine\'s "target.listUrl … is required"; 1 issue', iss.length === 1 && !engIss, issueLine(iss));
  check('issues button says "1 problem"', /1 problem\b/.test(await page.locator('.bfb-issuesbtn').textContent()), await page.locator('.bfb-issuesbtn').textContent());
  check('outline has one page and one section', same(await ev(page, s => s.doc.pages.map(p => p.sections.length)), [1]));

  console.log('list picker + catalog:');
  await clickIn(page, '.bfb-listchip');
  await page.waitForFunction(() => document.querySelectorAll('.bfb-pick .bfb-listrow').length > 0, null, { timeout: 5000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.bfb-pick .bfb-listrow strong')].map(e => e.textContent));
  check('picker shows the 3 mock lists', same(rows, ['BSPF Builder Test', 'IT Requests', 'No Attachments']), rows);
  check('"No Attachments" row is flagged "no attachments"', await page.evaluate(() => {
    const r = [...document.querySelectorAll('.bfb-pick .bfb-listrow')].find(x => /No Attachments/.test(x.textContent));
    const f = [...r.querySelectorAll('.bfb-flag')].find(x => /no attachments/.test(x.textContent));
    return !!f && f.offsetParent !== null;
  }));
  await clickText(page, '.bfb-pick .bfb-listrow', /^BSPF Builder Test/);
  await page.waitForFunction(new Function('const s = ' + ST + '; return s.schema.state === "ready" && s.listTitle() === "BSPF Builder Test";'), null, { timeout: 5000 });
  check('picker closes after a pick', !(await ev(page, s => s.pick.open)));
  const cat = await ev(page, s => s.schema.catalog.cols.map(c => ({ name: c.name, ok: c.ok, reason: c.reason, type: c.type })));
  const byName = Object.fromEntries(cat.map(c => [c.name, c]));
  for (const [name, re] of [['CalcCol', /read-only/i], ['LookupCol', /lookup/i], ['NumPct', /percent/i], ['PicCol', /picture/i]]) {
    const c = byName[name];
    check('catalog: ' + name + ' NOT mappable — ' + (c && c.reason), !!c && !c.ok && re.test(c.reason), c);
  }
  const mappable = ['Title', 'TxtShort', 'TxtReq', 'TxtDefault', 'NotePlain', 'NoteRich', 'NumPlain', 'NumDefault', 'Money', 'ChoiceA', 'ChoiceFill',
    'ChoiceReqDef', 'Multi', 'DateOnlyCol', 'DateTimeCol', 'YesNo', 'Person', 'People', 'LinkCol', 'UniqueCode', 'EvenNum', '_Under', '_x0032_Num'];
  const notOk = mappable.filter(n => !byName[n] || !byName[n].ok);
  check('catalog: mappable — ' + mappable.length + ' columns incl. TxtShort, ChoiceA, Multi, Person, People, LinkCol, _Under, _x0032_Num', !notOk.length, notOk);
  check('catalog: exactly 27 columns, Title first', cat.length === 27 && cat[0].name === 'Title', cat.length + ' first=' + (cat[0] && cat[0].name));
  check('catalog: no system columns (ID, Created, Modified, Author, Editor, Attachments, ContentType)',
    !cat.some(c => /^(ID|Created|Modified|Author|Editor|Attachments|ContentType|_UIVersionString)$/.test(c.name)));
  // the filter itself, on a schema that has them
  const sys = await page.evaluate(() => {
    const core = BSPFormsBuilder.core;
    const fd = (n, t, x) => Object.assign({ InternalName: n, EntityPropertyName: n, Title: n, TypeAsString: t, FromBaseType: false, Hidden: false, ReadOnlyField: false }, x || {});
    const c = core.buildCatalog({ list: {}, fields: [
      fd('Created', 'DateTime', { FromBaseType: true, ReadOnlyField: true }), fd('Author', 'User', { FromBaseType: true }),
      fd('Title', 'Text', { FromBaseType: true, Required: true }), fd('Secret', 'Text', { Hidden: true }),
      fd('Mine', 'Text'), fd('Odd', 'Text', { EntityPropertyName: 'OddRenamed' }), fd('Tax', 'TaxonomyFieldType'), fd('Cnt', 'Counter'),
      fd('Geo', 'Geolocation'), fd('Pic', 'Thumbnail'), fd('Mul', 'LookupMulti'), fd('Weird', 'WorkflowStatus')
    ] });
    return c.cols.map(x => x.name + ':' + (x.ok ? 'ok' : 'no'));
  });
  check('buildCatalog: FromBaseType (except Title) and Hidden dropped', same(sys.map(x => x.split(':')[0]).sort(), ['Cnt', 'Geo', 'Mine', 'Mul', 'Odd', 'Pic', 'Tax', 'Title', 'Weird']), sys);
  check('classify: EntityPropertyName mismatch, taxonomy, counter, location, image, multi-lookup, unknown type → not mappable',
    same(sys.filter(x => /:no$/.test(x)).map(x => x.split(':')[0]).sort(), ['Cnt', 'Geo', 'Mul', 'Odd', 'Pic', 'Tax', 'Weird']), sys);
  // DOM: greyed with the reason
  const dom = await page.evaluate(() => [...document.querySelectorAll('.bfb-col.is-off')].map(r => r.querySelector('.bfb-col__title').textContent + '=' + (r.querySelector('.bfb-col__why') || {}).textContent));
  check('catalog pane greys the 4 excluded columns with their reason', same(dom.map(x => x.split('=')[0]).sort(), ['CalcCol', 'LookupCol', 'NumPct', 'PicCol']) && dom.every(x => /=\S/.test(x)), dom);
  const doc = await docOf(page);
  check('target.siteUrl = /sites/FCUPortal, listUrl = the list\'s server-relative URL',
    doc.target.siteUrl === '/sites/FCUPortal' && doc.target.listUrl === '/sites/FCUPortal/Lists/BSPFBuilderTest' && !doc.target.listId && !doc.target.listTitle, doc.target);
  check('$builder.list = { siteUrl, listId, listTitle, listUrl }', same(doc.$builder.list, { siteUrl: '/sites/FCUPortal', listId: 'c279b324-0000-4000-8000-000000000001',
    listTitle: 'BSPF Builder Test', listUrl: '/sites/FCUPortal/Lists/BSPFBuilderTest' }), doc.$builder.list);
  check('target.sendEmpty stays true', doc.target.sendEmpty === true);
  check('list chip shows the list', /BSPF Builder Test/.test(await page.locator('.bfb-listchip').textContent()));
  iss = await issuesOf(page);
  check('"Pick the SharePoint list" gone', !has(iss, /^Pick the SharePoint list/));
  check('required: Title issue (no template, no mapping)', has(iss, /^The list requires a Title/, 'error'), issueLine(iss));
  check('required: TxtReq issue', has(iss, /^The list requires “TxtReq”\. Add a required control/, 'error'), issueLine(iss));
  check('required WITH default: ChoiceReqDef raises nothing', !iss.some(i => /ChoiceReqDef/.test(i.msg)), issueLine(iss));
  check('catalog: ChoiceReqDef says "required — its default is saved"', await page.evaluate(() => {
    const r = [...document.querySelectorAll('.bfb-col')].find(x => x.querySelector('.bfb-col__title').textContent === 'ChoiceReqDef');
    return /its default is saved/.test(r.querySelector('.bfb-col__state').textContent);
  }));
  check('catalog: TxtReq flagged "required — not mapped" (is-req)', await page.evaluate(() => {
    const r = [...document.querySelectorAll('.bfb-col')].find(x => x.querySelector('.bfb-col__title').textContent === 'TxtReq');
    const s = r.querySelector('.bfb-col__free');
    return /required — not mapped/.test(s.textContent) && s.classList.contains('is-req');
  }));
  await page.screenshot({ path: path.join(SHOTS, 'bfb-catalog.png'), fullPage: true });

  // the item title satisfies Title; only fixed text or an always-filled token counts
  await propInput(page, 'Item title').fill('{form:title}');
  await settle(page);
  iss = await issuesOf(page);
  check('item title "{form:title}" clears the Title issue', !has(iss, /requires a Title/), issueLine(iss));
  check('catalog: Title now "the item title fills it"', await page.evaluate(() => {
    const r = [...document.querySelectorAll('.bfb-col')].find(x => x.querySelector('.bfb-col__title').textContent === 'Title');
    return /item title fills it/.test(r.querySelector('.bfb-col__state').textContent);
  }));
  const tf = await page.evaluate(() => ['{field:a}', '{form:title}', 'Req {field:a}', '{date}', '  ', '{field:a}{field:b}', '{now}'].map(BSPFormsBuilder.core.templateAlwaysFilled));
  check('templateAlwaysFilled: field-only tokens / blank → false; literal text or always tokens → true', same(tf, [false, true, true, true, false, false, true]), tf);
  await propInput(page, 'Item title').fill('');
  await settle(page);
  // mapping Title instead
  const t = await addControl(page, 'section1', 'Single line text');
  await mapCol(page, t, 'Title');
  const r = await addControl(page, 'section1', 'Single line text');
  await mapCol(page, r, 'TxtReq');
  await settle(page);
  iss = await issuesOf(page);
  check('a required control mapped to Title clears the Title issue', !has(iss, /requires a Title/), issueLine(iss));
  check('a control mapped to TxtReq clears the TxtReq issue', !has(iss, /requires “TxtReq”/), issueLine(iss));
  check('form is now error-free and Download enabled', (await ev(page, s => s.nErr)) === 0 && !(await downloadDisabled(page)), issueLine(iss));
  await selectNode(page, 'form'); // the catalog lives in the form pane
  check('catalog marks used columns "← <control>"', await page.evaluate(() => {
    const r = [...document.querySelectorAll('.bfb-col')].find(x => x.querySelector('.bfb-col__title').textContent === 'TxtReq');
    return r.classList.contains('is-used') && /← /.test(r.querySelector('.bfb-col__state').textContent);
  }));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  check('no console errors', page.__console.length === 0, page.__console.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   3 + 4. Every control kind, mapping, compatible options, schema-forced
   ------------------------------------------------------------------ */
const TEXT_COLS = ['Title', 'TxtShort', 'TxtReq', 'TxtDefault', 'UniqueCode', '_Under'];
const NOTE_COLS = ['NotePlain', 'NoteRich'];
const CHOICE_COLS = ['ChoiceA', 'ChoiceFill', 'ChoiceReqDef'];
const EXPECT_OPTS = {
  text: TEXT_COLS.concat(NOTE_COLS),
  textarea: NOTE_COLS.concat(TEXT_COLS),
  number: ['NumPlain', 'NumDefault', 'Money', 'EvenNum', '_x0032_Num'],
  boolean: ['YesNo'].concat(CHOICE_COLS, TEXT_COLS),
  choice: CHOICE_COLS.concat(TEXT_COLS),
  multichoice: ['Multi'],
  date: ['DateOnlyCol', 'DateTimeCol'],
  person: ['Person', 'People'],
  url: ['LinkCol'].concat(TEXT_COLS)
};
async function testControls(browser) {
  console.log('every control kind + mapping:');
  const { ctx, page } = await openBuilder(browser);
  await pickList(page, 'BSPF Builder Test');
  const labels = [['text', 'Single line text'], ['textarea', 'Multi-line text'], ['number', 'Number'], ['boolean', 'Yes / No'], ['choice', 'Choice'],
    ['multichoice', 'Multi-choice'], ['date', 'Date'], ['person', 'Person'], ['url', 'URL'], ['heading', 'Heading'], ['note', 'Note'], ['currentUser', 'Current user card']];
  const pal = await page.evaluate(() => {
    document.querySelector('.bfb-add__btn').click();
    return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.bfb-palette__item')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim())), 60));
  });
  await page.evaluate(() => document.querySelector('.bfb-add__btn').click());
  check('palette lists the 12 kinds', same(pal, labels.map(l => l[1])), pal);
  const ids = {};
  for (const [kind, label] of labels) ids[kind] = await addControl(page, 'section1', label);
  const fs0 = await ev(page, s => s.doc.pages[0].sections[0].fields.map(f => ({ id: f.id, type: f.type, kind: f.$builder.kind, auto: f.$builder.autoId })));
  check('12 controls added, one per kind, auto ids', fs0.length === 12 && same(fs0.map(f => f.kind), labels.map(l => l[0])) && fs0.every(f => f.auto), fs0);
  check('engine types: text, textarea, number, boolean, choice, multichoice, date, person, link, heading, note, currentUser',
    same(fs0.map(f => f.type), ['text', 'textarea', 'number', 'boolean', 'choice', 'multichoice', 'date', 'person', 'link', 'heading', 'note', 'currentUser']), fs0.map(f => f.type));
  await settle(page);
  let iss = await issuesOf(page);
  const unmapped = iss.filter(i => /isn’t saved anywhere/.test(i.msg)).map(i => i.sel.id);
  check('9 value controls unmapped → 9 errors; statics none', same(sorted(unmapped), sorted(['text', 'textarea', 'number', 'boolean', 'choice', 'multichoice', 'date', 'person', 'url'].map(k => ids[k]))), unmapped);

  // compatible options only, for every value kind
  for (const kind of Object.keys(EXPECT_OPTS)) {
    await selectNode(page, 'field', ids[kind]);
    const o = await colOptions(page, ids[kind]);
    check('Column select for ' + kind + ' offers only ' + (kind === 'date' ? 'DateTime columns' : 'compatible columns'), same(sorted(o), sorted(EXPECT_OPTS[kind])), o);
  }
  for (const kind of ['heading', 'note', 'currentUser']) {
    await selectNode(page, 'field', ids[kind]);
    check(kind + ': no Column select (static)', (await page.locator('.bfb-props select.select').count()) === 0);
  }

  // text
  await mapCol(page, ids.text, 'TxtShort');
  let f = await fieldOf(page, ids.text);
  check('text → TxtShort: column set, validation.maxLength 50', f.column === 'TxtShort' && f.validation && f.validation.maxLength === 50, f);
  check('…Max length input shows 50, capped at 50', await page.evaluate(() => {
    const l = [...document.querySelectorAll('.bfb-props .field__label')].find(x => x.textContent === 'Max length');
    const i = l.parentElement.querySelector('input');
    return i.value === '50' && i.max === '50';
  }));
  check('outline shows "→ TxtShort" pill', await page.evaluate(id => /→ TxtShort/.test(document.querySelector('[data-bfb-node="field:' + id + '"] .bfb-colpill').textContent), ids.text));
  // textarea
  await mapCol(page, ids.textarea, 'NoteRich');
  f = await fieldOf(page, ids.textarea);
  check('textarea → NoteRich: richText true', f.column === 'NoteRich' && f.richText === true, f);
  await mapCol(page, ids.textarea, 'NotePlain');
  f = await fieldOf(page, ids.textarea);
  check('textarea → NotePlain: richText false', f.column === 'NotePlain' && f.richText === false, f);
  // number
  await mapCol(page, ids.number, 'NumPlain');
  f = await fieldOf(page, ids.number);
  check('number → NumPlain: min 0, max 100, type number', f.type === 'number' && f.validation.min === 0 && f.validation.max === 100, f);
  await mapCol(page, ids.number, 'Money');
  f = await fieldOf(page, ids.number);
  check('number → Money: type currency', f.type === 'currency' && f.column === 'Money', f);
  // boolean
  await mapCol(page, ids.boolean, 'YesNo');
  f = await fieldOf(page, ids.boolean);
  check('boolean → YesNo: no values, default false (column default "0")', !('values' in f) && f.default === false, f);
  let sw = await switchOf(page, 'Save words instead of yes/no');
  check('…"Save words" switch off + disabled', sw && !sw.checked && sw.disabled, sw);
  await mapCol(page, ids.boolean, 'ChoiceA');
  f = await fieldOf(page, ids.boolean);
  check('boolean → ChoiceA: saved as words (values on/off)', f.values && f.values.on === 'Yes' && f.values.off === 'No' && !('default' in f), f);
  sw = await switchOf(page, 'Save words instead of yes/no');
  check('…"Save words" switch on + disabled', sw && sw.checked && sw.disabled, sw);
  await settle(page);
  iss = await issuesOf(page);
  check('…warns that "Yes"/"No" aren\'t ChoiceA choices', has(iss, /“Yes” isn’t one of “ChoiceA”’s choices/, 'warn') && has(iss, /“No” isn’t one of/, 'warn'), issueLine(iss));
  // choice
  await mapCol(page, ids.choice, 'ChoiceA');
  f = await fieldOf(page, ids.choice);
  check('choice → ChoiceA: the column\'s 3 choices', same(f.choices.map(c => c.value), ['Low', 'Medium', 'High']), f.choices);
  check('…default "Medium" (the column default)', f.default === 'Medium', f.default);
  check('…choices editor shows 3 fixed rows, no "Add a choice"', await page.evaluate(() => document.querySelectorAll('.bfb-props .bfb-choice').length === 3 &&
    ![...document.querySelectorAll('.bfb-props .btn')].some(b => /Add a choice/.test(b.textContent) && b.offsetParent !== null)));
  sw = await switchOf(page, 'Offer “Other” (type your own)');
  check('…"Other" switch disabled (no FillInChoice)', sw && sw.disabled && !sw.checked, sw);
  await page.screenshot({ path: path.join(SHOTS, 'bfb-choice.png'), fullPage: true });
  // untick one choice: a subset stays
  await page.evaluate(() => [...document.querySelectorAll('.bfb-props .bfb-choice')].find(r => /High/.test(r.textContent)).querySelector('input[type=checkbox]').click());
  await page.waitForTimeout(80);
  f = await fieldOf(page, ids.choice);
  check('…unticking "High" leaves a subset [Low, Medium] (still 3 rows, one off)', same(f.choices.map(c => c.value), ['Low', 'Medium']) &&
    await page.evaluate(() => document.querySelectorAll('.bfb-props .bfb-choice.is-off').length === 1), f.choices);
  await mapCol(page, ids.choice, 'ChoiceFill');
  sw = await switchOf(page, 'Offer “Other” (type your own)');
  check('choice → ChoiceFill: choices Alpha/Beta, "Other" allowed', same((await fieldOf(page, ids.choice)).choices.map(c => c.value), ['Alpha', 'Beta']) && sw && !sw.disabled, sw);
  await mapCol(page, ids.choice, 'ChoiceA');
  // multichoice
  await mapCol(page, ids.multichoice, 'Multi');
  f = await fieldOf(page, ids.multichoice);
  check('multichoice → Multi: Red/Green/Blue', same(f.choices.map(c => c.value), ['Red', 'Green', 'Blue']) && f.type === 'multichoice', f.choices);
  // date
  await selectNode(page, 'field', ids.date);
  await toggleSwitch(page, 'Include a time');
  check('date: "Include a time" on while unmapped', (await fieldOf(page, ids.date)).includeTime === true);
  await mapCol(page, ids.date, 'DateOnlyCol');
  f = await fieldOf(page, ids.date);
  sw = await switchOf(page, 'Include a time');
  check('date → DateOnlyCol: includeTime removed, switch disabled', !('includeTime' in f) && sw && sw.disabled && !sw.checked, { f, sw });
  await mapCol(page, ids.date, 'DateTimeCol');
  sw = await switchOf(page, 'Include a time');
  check('date → DateTimeCol: switch enabled again', sw && !sw.disabled, sw);
  // person
  await mapCol(page, ids.person, 'People');
  f = await fieldOf(page, ids.person);
  sw = await switchOf(page, 'Allow several people');
  check('person → People: multiple true, switch disabled (set by the column)', f.multiple === true && sw && sw.disabled && sw.checked, { f, sw });
  await mapCol(page, ids.person, 'Person');
  f = await fieldOf(page, ids.person);
  check('person → Person: multiple false', f.multiple === false, f);
  // url
  await mapCol(page, ids.url, 'LinkCol');
  f = await fieldOf(page, ids.url);
  check('url → LinkCol: type link', f.type === 'link' && f.column === 'LinkCol' && !(f.validation && f.validation.url), f);
  await mapCol(page, ids.url, 'TxtShort');
  f = await fieldOf(page, ids.url);
  check('url → TxtShort: type text + validation.url', f.type === 'text' && f.validation && f.validation.url === true, f);
  await settle(page);
  iss = await issuesOf(page);
  const urlIss = iss.filter(i => i.sel && i.sel.id === ids.url && i.level === 'error');
  // BUG (see the report): mapping a URL control to a Text column never caps
  // maxLength, and the URL card has no "Max length" input — so the error
  // below can't be fixed from the UI and the form can't be downloaded
  check('fixed: url → Text column: no unfixable "holds at most N characters" error', !urlIss.length, issueLine(urlIss));
  await mapCol(page, ids.url, 'LinkCol');
  // schema-forced required
  console.log('schema-forced:');
  const req = await addControl(page, 'section1', 'Single line text');
  sw = await switchOf(page, 'Required');
  check('unmapped text: Required switch enabled, off', sw && !sw.disabled && !sw.checked, sw);
  await mapCol(page, req, 'TxtReq');
  f = await fieldOf(page, req);
  sw = await switchOf(page, 'Required');
  check('text → TxtReq: required forced true, switch disabled', f.required === true && sw && sw.checked && sw.disabled, { f, sw });
  check('…hint "The list requires this column" shown', await page.evaluate(() => [...document.querySelectorAll('.bfb-props .field__hint')].some(p => /list requires this column/.test(p.textContent) && p.offsetParent !== null)));
  check('…outline shows the required star', await page.evaluate(id => { const s = document.querySelector('[data-bfb-node="field:' + id + '"] .bfb-req'); return !!s && s.offsetParent !== null; }, req));
  await mapCol(page, ids.text, 'TxtDefault');
  f = await fieldOf(page, ids.text);
  check('text → TxtDefault: default "Hello" shown (column default), maxLength 50 kept (≤ 255)', f.default === 'Hello' && f.validation.maxLength === 50, f);
  await mapCol(page, ids.number, 'NumDefault');
  f = await fieldOf(page, ids.number);
  check('number → NumDefault: default 7 (a number), type number', f.default === 7 && f.type === 'number', f);
  await page.selectOption('#bfb-col-' + ids.number, '');
  await page.waitForTimeout(80);
  f = await fieldOf(page, ids.number);
  check('picking "— Pick a column —" unmaps (column + default removed)', !('column' in f) && !('default' in f), f);
  await mapCol(page, ids.number, 'NumPlain');
  await settle(page);
  iss = await issuesOf(page);
  check('no engine errors with all 12 kinds mapped', !iss.some(i => i.source === 'engine'), issueLine(iss.filter(i => i.source === 'engine')));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   5 + 6. Switching lists; unmapped vs logic-only
   ------------------------------------------------------------------ */
async function testSwitchAndLogicOnly(browser) {
  console.log('switching lists:');
  let { ctx, page } = await openBuilder(browser);
  await pickList(page, 'BSPF Builder Test');
  const a = await addControl(page, 'section1', 'Single line text');
  await mapCol(page, a, 'TxtShort');
  const b = await addControl(page, 'section1', 'Choice');
  await mapCol(page, b, 'ChoiceA');
  const h = await addControl(page, 'section1', 'Heading');
  await settle(page);
  await pickList(page, 'IT Requests', { expectAsk: true });
  check('a confirm dialog appears ("Switch lists?", 2 mappings)', await isVisible(page, '.bfb-ask') &&
    /Switch lists\?/.test(await page.locator('.bfb-ask .dialog__title').textContent()) && /\(2\)/.test(await page.locator('#bfb-ask-m').textContent()));
  await clickText(page, '.bfb-ask .btn', /^Cancel$/);
  let d = await docOf(page);
  check('cancel: mappings kept, list unchanged', d.pages[0].sections[0].fields[0].column === 'TxtShort' && d.pages[0].sections[0].fields[1].column === 'ChoiceA' &&
    d.$builder.list.listTitle === 'BSPF Builder Test' && !(await isVisible(page, '.bfb-ask')), d.$builder.list);
  await clickText(page, '.bfb-pick .bfb-listrow', /^IT Requests/);
  await page.waitForTimeout(80);
  await clickIn(page, '.bfb-ask .btn--primary');
  await page.waitForFunction(new Function('const s = ' + ST + '; return s.schema.state === "ready" && s.listTitle() === "IT Requests";'), null, { timeout: 5000 });
  d = await docOf(page);
  const fs1 = d.pages[0].sections[0].fields;
  check('confirm: every column removed', fs1.every(f => !('column' in f)), fs1.map(f => f.column));
  check('…controls kept (3) with their choices', same(fs1.map(f => f.id), [a, b, h]) && same(fs1[1].choices.map(c => c.value), ['Low', 'Medium', 'High']), fs1.map(f => f.id));
  check('…choice default from the old column dropped', !('default' in fs1[1]), fs1[1]);
  check('…$builder.list.listTitle "IT Requests", target.listUrl follows', d.$builder.list.listTitle === 'IT Requests' && d.target.listUrl === '/sites/FCUPortal/Lists/IT Requests', d.$builder.list);
  check('…no sharedColumns', !('sharedColumns' in d));
  check('…the picker closed', !(await ev(page, s => s.pick.open)));
  // picking the same list again does nothing (no dialog)
  await pickList(page, 'IT Requests');
  check('re-picking the current list: no dialog', !(await ev(page, s => s.ask.open)));
  // undo brings the mappings back (the message promises it)
  await settle(page);
  await ev(page, s => s.undo());
  await page.waitForTimeout(100);
  d = await docOf(page);
  check('undo after a switch restores the mappings', d.pages[0].sections[0].fields[0].column === 'TxtShort', d.pages[0].sections[0].fields.map(f => f.column));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  console.log('unmapped vs logic-only:');
  ({ ctx, page } = await openBuilder(browser));
  await pickList(page, 'BSPF Builder Test');
  await propInput(page, 'Item title').fill('{form:title}');
  const r = await addControl(page, 'section1', 'Single line text');
  await mapCol(page, r, 'TxtReq');
  await settle(page);
  let iss = await issuesOf(page);
  check('valid baseline: 0 errors, Download enabled', (await ev(page, s => s.nErr)) === 0 && !(await downloadDisabled(page)), issueLine(iss));
  const n = await addControl(page, 'section1', 'Number');
  await settle(page);
  iss = await issuesOf(page);
  check('unmapped value control → error on it', iss.some(i => i.level === 'error' && i.sel.id === n && /isn’t saved anywhere/.test(i.msg)), issueLine(iss));
  check('…Download disabled', await downloadDisabled(page));
  check('…outline pill "not mapped" + error class', await page.evaluate(id => {
    const node = document.querySelector('[data-bfb-node="field:' + id + '"]');
    return node.classList.contains('has-error') && /not mapped/.test(node.querySelector('.bfb-colpill--error').textContent);
  }, n));
  await ev(page, s => s.openDownload());
  await page.waitForTimeout(100);
  const od = await ev(page, s => ({ show: s.showIssues, dl: s.dl.open }));
  check('…openDownload() with errors opens the issues list, not the dialog', od.show && !od.dl && await isVisible(page, '.bfb-issues'),
    JSON.stringify(od) + ' drawer=' + await page.evaluate(() => { const e = document.querySelector('.bfb-issues'); return e && (e.style.display + '/' + e.getClientRects().length); }));
  await ev(page, s => { s.showIssues = false; });
  await selectNode(page, 'field', n);
  await toggleSwitch(page, 'Not saved (logic only)');
  await settle(page);
  iss = await issuesOf(page);
  let f = await fieldOf(page, n);
  check('"Not saved (logic only)" clears the error', !iss.some(i => i.sel.id === n && i.level === 'error') && (await ev(page, s => s.nErr)) === 0, issueLine(iss));
  check('…$builder.logicOnly true, no column; Download enabled', f.$builder.logicOnly === true && !('column' in f) && !(await downloadDisabled(page)), f);
  check('…Column select hidden, outline pill "not saved"', !(await isVisible(page, '#bfb-col-' + n)) &&
    await page.evaluate(id => /not saved/.test(document.querySelector('[data-bfb-node="field:' + id + '"] .bfb-colpill--muted').textContent), n));
  check('…serialized as "$builder": { kind, logicOnly } (kept, engine ignores it)', await ev(page, (s, id) => {
    const j = JSON.parse(s.jsonText());
    const x = j.pages[0].sections[0].fields.find(q => q.id === id);
    return JSON.stringify(x.$builder) === '{"kind":"number","logicOnly":true}';
  }, n));
  await toggleSwitch(page, 'Not saved (logic only)');
  await settle(page);
  check('toggling it off brings the error back', (await ev(page, s => s.nErr)) === 1 && await downloadDisabled(page));
  // logic-only + a column is an error (crafted: the UI can't make it)
  await ev(page, (s, id) => { const l = s.loc('field', id); l.f.$builder.logicOnly = true; l.f.column = 'NumPlain'; }, n);
  iss = await issuesOf(page);
  check('logic-only AND a column → error', has(iss, /is marked “not saved” but has a column/, 'error'), issueLine(iss));
  // mapping a logic-only control clears the flag
  // (the Column select is hidden while logic-only, so call the setter)
  await ev(page, (s, id) => { delete s.loc('field', id).f.column; s.select('field', id); s.setColumn('NumPlain'); }, n);
  f = await fieldOf(page, n);
  check('mapping a column clears logicOnly', !(f.$builder && f.$builder.logicOnly) && f.column === 'NumPlain', f);
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   7. Every B7 schema check on a crafted case + an engine error
   ------------------------------------------------------------------ */
async function testChecks(browser) {
  console.log('B7 schema checks:');
  const { ctx, page } = await openBuilder(browser);
  await pickList(page, 'BSPF Builder Test');
  const base = await docOf(page);
  let iss = await runDoc(page, craft(base));
  check('crafted baseline: no errors, no warnings', iss.length === 0, issueLine(iss));
  const K = (kind) => ({ kind });
  const cases = [
    ['choice value not in the column', [{ id: 'c', type: 'choice', label: 'C', column: 'ChoiceA', choices: [{ value: 'Low' }, { value: 'Bogus' }], $builder: K('choice') }],
      /“Bogus” isn’t a choice of “ChoiceA”/, 'error'],
    ['multichoice value not in the column', [{ id: 'm', type: 'multichoice', label: 'M', column: 'Multi', choices: ['Red', 'Pink', 'Teal'], $builder: K('multichoice') }],
      /“Pink”, “Teal” aren’t choices of “Multi”/, 'error'],
    ['fillIn on a column without FillInChoice', [{ id: 'c', type: 'choice', label: 'C', column: 'ChoiceA', choices: [{ value: 'Low' }], fillIn: true, $builder: K('choice') }],
      /doesn’t allow fill-in values/, 'error'],
    ['empty choice list', [{ id: 'c', type: 'choice', label: 'C', column: 'ChoiceA', choices: [], $builder: K('choice') }], /has no choices/, 'error'],
    ['maxLength over the column MaxLength', [{ id: 't', type: 'text', label: 'T', column: 'TxtShort', validation: { maxLength: 80 }, $builder: K('text') }],
      /“TxtShort” holds at most 50 characters/, 'error'],
    ['no maxLength on a 50-char column', [{ id: 't', type: 'text', label: 'T', column: 'TxtShort', $builder: K('text') }], /holds at most 50 characters/, 'error'],
    ['number min below the column minimum', [{ id: 'n', type: 'number', label: 'N', column: 'NumPlain', validation: { min: -5, max: 100 }, $builder: K('number') }],
      /accepts nothing below 0/, 'error'],
    ['number max above the column maximum', [{ id: 'n', type: 'number', label: 'N', column: 'NumPlain', validation: { min: 0, max: 500 }, $builder: K('number') }],
      /accepts nothing above 100/, 'error'],
    ['date-only column + includeTime', [{ id: 'd', type: 'date', label: 'D', column: 'DateOnlyCol', includeTime: true, $builder: K('date') }], /is date-only, so it can’t take a time/, 'error'],
    ['multiple people on a User column (error)', [{ id: 'p', type: 'person', label: 'P', column: 'Person', multiple: true, $builder: K('person') }], /allows several people, but “Person” holds one/, 'error'],
    ['one person on a UserMulti column (warn)', [{ id: 'p', type: 'person', label: 'P', column: 'People', multiple: false, $builder: K('person') }], /allows one person; “People” could hold several/, 'warn'],
    ['unique column (warn)', [{ id: 'u', type: 'text', label: 'U', column: 'UniqueCode', validation: { maxLength: 255 }, $builder: K('text') }], /“UniqueCode” must be unique/, 'warn'],
    ['column validation formula (warn)', [{ id: 'e', type: 'number', label: 'E', column: 'EvenNum', $builder: K('number') }], /“EvenNum” has a validation formula/, 'warn'],
    ['a column missing from the schema', [{ id: 'g', type: 'text', label: 'G', column: 'Gone', validation: { maxLength: 10 }, $builder: K('text') }], /saves to “Gone”, which the list doesn’t have/, 'error'],
    ['an excluded column (read-only)', [{ id: 'x', type: 'text', label: 'X', column: 'CalcCol', $builder: K('text') }], /saves to “CalcCol”: Read-only/, 'error'],
    ['an excluded column (percent)', [{ id: 'x', type: 'number', label: 'X', column: 'NumPct', $builder: K('number') }], /saves to “NumPct”: A percent column/, 'error'],
    ['an incompatible column type', [{ id: 'x', type: 'date', label: 'X', column: 'NumPlain', $builder: K('date') }], /\(Date\) can’t save to a Number column/, 'error'],
    ['Note column for a single-line control (warn)', [{ id: 'x', type: 'text', label: 'X', column: 'NotePlain', $builder: K('text') }], /saves to a Note column — it works/, 'warn'],
    ['hyperlink column without link mode', [{ id: 'x', type: 'text', label: 'X', column: 'LinkCol', validation: { url: true }, $builder: K('url') }], /needs the URL control’s link mode/, 'error'],
    ['required column, control not required', [], /saves to a column the list requires, so it must be required/, 'error', d => { delete d.pages[0].sections[0].fields[0].required; }],
    ['dropdown without bounds', [{ id: 'n', type: 'number', label: 'N', column: 'NumDefault', display: 'dropdown', validation: { integer: true }, $builder: K('number') }],
      /a dropdown needs a whole-number minimum and maximum/, 'error'],
    ['slider without bounds', [{ id: 'n', type: 'number', label: 'N', column: 'NumDefault', display: 'slider', validation: { integer: true, min: 1 }, $builder: K('number') }],
      /a slider needs a whole-number minimum and maximum/, 'error'],
    ['dropdown over 200 numbers', [{ id: 'n', type: 'number', label: 'N', column: 'NumDefault', display: 'dropdown', validation: { integer: true, min: 0, max: 500 }, $builder: K('number') }],
      /a dropdown lists at most 200 numbers/, 'error'],
    ['dangling {field:ghost} in the item title', [], /target\.titleTemplate refers to “ghost”, which no control has/, 'error', d => { d.target.titleTemplate = '{form:title} {field:ghost}'; }],
    ['shared column without show-when rules (warn)', [{ id: 's1', type: 'text', label: 'S1', column: 'TxtDefault', validation: { maxLength: 255 }, $builder: K('text') },
      { id: 's2', type: 'text', label: 'S2', column: 'TxtDefault', validation: { maxLength: 255 }, $builder: K('text') }], /“TxtDefault” is saved by 2 controls \(s1, s2\)/, 'warn']
  ];
  for (const [name, fields, re, level, extra] of cases) {
    iss = await runDoc(page, craft(base, fields, extra));
    check(name + ' → ' + level, has(iss, re, level), issueLine(iss));
  }
  // required columns, path-aware
  const drv = { id: 'drv', type: 'boolean', label: 'Drv', $builder: { kind: 'boolean', logicOnly: true } };
  const PATH = /The list requires “TxtReq”, but not every path through the form fills it in/;
  iss = await runDoc(page, craft(base, [], d => {
    const req = d.pages[0].sections[0].fields.pop();
    req.visibleWhen = { field: 'drv', op: 'equals', value: true };
    d.pages[0].sections[0].fields.push(drv, req);
  }));
  check('required column mapped only by a control with visibleWhen → path-aware error', has(iss, PATH, 'error'), issueLine(iss));
  iss = await runDoc(page, craft(base, [], d => {
    const req = d.pages[0].sections[0].fields.pop();
    d.pages[0].sections[0].fields.push(drv);
    d.pages.push({ id: 'page2', title: 'Page 2', visibleWhen: { field: 'drv', op: 'equals', value: true }, sections: [{ id: 'section2', title: '', fields: [req] }] });
  }));
  check('…mapped only on a page with visibleWhen → error', has(iss, PATH, 'error'), issueLine(iss));
  iss = await runDoc(page, craft(base, [], d => {
    const req = d.pages[0].sections[0].fields.pop();
    d.pages[0].sections[0].fields.push(drv);
    d.pages[0].sections.push({ id: 'section2', title: 'Hidden', visibleWhen: { field: 'drv', op: 'equals', value: true }, fields: [req] });
  }));
  check('…mapped only in a section with visibleWhen → error', has(iss, PATH, 'error'), issueLine(iss));
  iss = await runDoc(page, craft(base, [], d => {
    const req = d.pages[0].sections[0].fields.pop();
    d.pages[0].sections[0].fields.push(drv);
    d.pages[0].endWhen = { field: 'drv', op: 'equals', value: true };
    d.pages.push({ id: 'page2', title: 'Page 2', sections: [{ id: 'section2', title: '', fields: [req] }] });
  }));
  check('…mapped only after a page with endWhen → error', has(iss, PATH, 'error'), issueLine(iss));
  iss = await runDoc(page, craft(base, [], d => {
    d.pages[0].sections[0].fields.push(drv);
    d.pages.push({ id: 'page2', title: 'Page 2', visibleWhen: { field: 'drv', op: 'equals', value: true }, sections: [{ id: 'section2', title: '', fields: [] }] });
  }));
  check('…an unconditional copy on page 1 satisfies it (no error)', !has(iss, PATH), issueLine(iss));
  iss = await runDoc(page, craft(base, [], d => {
    d.pages[0].sections[0].fields = [];
    d.target.set = { TxtReq: '{user:name}' };
  }));
  check('…target.set satisfies a required column', !has(iss, /requires “TxtReq”/), issueLine(iss));
  // attachments
  iss = await runDoc(page, craft(base, [], d => { d.attachments = { enabled: true, maxFiles: 6, maxFileSizeMb: 11 }; }));
  check('attachments maxFiles 6 → "at most 5 files"', has(iss, /Attachments: at most 5 files/, 'error'), issueLine(iss));
  check('attachments maxFileSizeMb 11 → "at most 10 MB"', has(iss, /Attachments: at most 10 MB per file/, 'error'), issueLine(iss));
  check('…on a list WITH attachments: no "turned off" error', !has(iss, /attachments turned off/), issueLine(iss));
  iss = await runDoc(page, craft(base, [], d => { d.attachments = { enabled: true }; }));
  check('attachments with no limits set → engine defaults (10 files) flagged', has(iss, /at most 5 files/, 'error'), issueLine(iss));
  // engine error, labelled "engine"
  iss = await runDoc(page, craft(base, [], d => { d.pages[0].sections[0].columns = 3; }));
  const eng = iss.filter(i => i.source === 'engine');
  check('section columns: 3 → an engine-sourced error', eng.length > 0 && eng.every(i => i.level === 'error') && eng.some(i => /columns/.test(i.msg)), issueLine(iss));
  await settle(page);
  await ev(page, s => { s.showIssues = true; });
  await page.waitForTimeout(100);
  check('…the issues drawer labels it "Engine"', await page.evaluate(() => [...document.querySelectorAll('.bfb-issue-row')].some(r =>
    r.querySelector('.bfb-src').textContent === 'Engine' && /columns/.test(r.textContent))));
  // engine error naming a field → selects it
  iss = await runDoc(page, craft(base, [{ id: 'pat', type: 'text', label: 'Pat', column: 'TxtDefault', validation: { maxLength: 255, pattern: '(' }, $builder: K('text') }]));
  const pe = iss.find(i => i.source === 'engine');
  check('an engine error naming a field points at it (sel.id "pat")', !!pe && pe.sel && pe.sel.t === 'field' && pe.sel.id === 'pat', pe);
  // a list-level validation formula (the mock has none: crafted schema)
  const lv = await page.evaluate(() => {
    const core = BSPFormsBuilder.core;
    const cat = core.buildCatalog({ list: { validationFormula: '=[A]>0', enableAttachments: true },
      fields: [{ InternalName: 'Title', EntityPropertyName: 'Title', Title: 'Title', TypeAsString: 'Text', FromBaseType: true, Required: false }] });
    const doc = core.newDoc();
    doc.target.listUrl = '/x';
    return core.computeIssues(doc, { state: 'ready', catalog: cat }).map(i => i.level + ':' + i.msg);
  });
  check('a list ValidationFormula → warn', lv.some(x => /^warn:The list has a validation formula/.test(x)), lv);
  const se = await page.evaluate(() => {
    const doc = BSPFormsBuilder.core.newDoc();
    doc.target.listUrl = '/x';
    return BSPFormsBuilder.core.computeIssues(doc, { state: 'error', err: 'boom', catalog: null }).map(i => i.level + ':' + i.msg);
  });
  check('a schema read error → error "couldn’t be read: boom"', se.some(x => /^error:The list’s columns couldn’t be read: boom/.test(x)), se);
  // attachments on a list without them
  await runDoc(page, craft(base, [], d => { d.pages[0].sections[0].fields = []; }));
  await settle(page);
  await pickList(page, 'No Attachments');
  const base2 = await docOf(page);
  iss = await runDoc(page, Object.assign(base2, { attachments: { enabled: true, maxFiles: 3, maxFileSizeMb: 5 } }, { target: Object.assign(base2.target, { titleTemplate: '{form:title}' }) }));
  check('attachments enabled on "No Attachments" → error', has(iss, /Attachments are on, but the list has attachments turned off/, 'error'), issueLine(iss));
  check('…and nothing else', iss.length === 1, issueLine(iss));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   8. Ids + references
   ------------------------------------------------------------------ */
async function testIds(browser) {
  console.log('ids + references:');
  const { ctx, page } = await openBuilder(browser);
  await pickList(page, 'BSPF Builder Test');
  const id0 = await addControl(page, 'section1', 'Single line text');
  check('new control: id from the kind label (singleLineText), auto', id0 === 'singleLineText' && (await fieldOf(page, id0)).$builder.autoId === true, id0);
  await propInput(page, 'Label').fill('Contact email');
  await page.waitForTimeout(80);
  let s = await ev(page, s => ({ sel: s.sel.id, draft: s.idDraft, ids: s.doc.pages[0].sections[0].fields.map(f => f.id) }));
  check('typing label "Contact email" → id contactEmail (selection + id box follow)', s.sel === 'contactEmail' && s.draft === 'contactEmail' && same(s.ids, ['contactEmail']), s);
  // a second control can't take the same auto id
  const id2 = await addControl(page, 'section1', 'Single line text');
  await propInput(page, 'Label').fill('Contact email');
  await page.waitForTimeout(80);
  check('a second "Contact email" → contactEmail2', (await ev(page, s => s.sel.id)) === 'contactEmail2', await ev(page, s => s.sel.id));
  await propInput(page, 'Label').fill('Backup');
  await page.waitForTimeout(80);
  // the token chip adds {field:contactEmail} to the item title
  await selectNode(page, 'form');
  const chips = await page.evaluate(() => [...document.querySelectorAll('.bfb-tokens .bfb-chip')].map(b => b.textContent));
  check('item-title chips offer {field:contactEmail} and {field:backup}', chips.includes('{field:contactEmail}') && chips.includes('{field:backup}'), chips);
  await clickText(page, '.bfb-tokens .bfb-chip', /^\{form:title\}$/);
  await clickText(page, '.bfb-tokens .bfb-chip', /^\{field:contactEmail\}$/);
  check('chips append tokens: "{form:title} {field:contactEmail}"', (await ev(page, s => s.doc.target.titleTemplate)) === '{form:title} {field:contactEmail}');
  // auto id still follows the label — and carries the reference
  await selectNode(page, 'field', 'contactEmail');
  await propInput(page, 'Label').fill('Work email');
  await page.waitForTimeout(80);
  s = await ev(page, s => ({ sel: s.sel.id, tpl: s.doc.target.titleTemplate }));
  check('relabel "Work email" → id workEmail, template token rewritten', s.sel === 'workEmail' && s.tpl === '{form:title} {field:workEmail}', s);
  check('"Used by" lists target.titleTemplate', await page.evaluate(() => [...document.querySelectorAll('.bfb-refs .bfb-flag')].some(e => e.textContent === 'target.titleTemplate')));
  // manual id edit
  const idBox = page.locator('.bfb-props input.bfb-mono');
  await idBox.fill('emailAddr');
  await idBox.press('Enter');
  await page.waitForTimeout(80);
  s = await ev(page, s => { const f = s.cur; return { sel: s.sel.id, id: f.id, auto: f.$builder.autoId, tpl: s.doc.target.titleTemplate, err: s.idErr }; });
  check('manual id "emailAddr": renamed, autoId false, token rewritten', s.id === 'emailAddr' && s.sel === 'emailAddr' && s.auto === false && s.tpl === '{form:title} {field:emailAddr}' && !s.err, s);
  await propInput(page, 'Label').fill('Something else');
  await page.waitForTimeout(80);
  check('after a manual edit the id no longer follows the label', (await ev(page, s => s.cur.id)) === 'emailAddr');
  // invalid + duplicate
  await idBox.fill('9abc');
  await idBox.press('Enter');
  await page.waitForTimeout(80);
  s = await ev(page, s => ({ id: s.cur.id, err: s.idErr }));
  check('invalid id "9abc" rejected with a message', s.id === 'emailAddr' && /Letters, digits and _ only/.test(s.err) && await isVisible(page, '.bfb-props .field__error'), s);
  await idBox.fill('has space');
  await idBox.press('Enter');
  check('invalid id "has space" rejected', (await ev(page, s => s.cur.id)) === 'emailAddr');
  await idBox.fill('backup');
  await idBox.press('Enter');
  await page.waitForTimeout(80);
  s = await ev(page, s => ({ id: s.cur.id, err: s.idErr }));
  check('duplicate id "backup" rejected with a message', s.id === 'emailAddr' && /Another control already has that id/.test(s.err), s);
  await idBox.fill('emailAddr');
  await idBox.press('Enter');
  check('re-entering the current id clears the message', (await ev(page, s => s.idErr)) === '');
  // delete blocked while referenced
  await clickIn(page, '[data-bfb-node="field:emailAddr"] [aria-label="Delete control"]');
  s = await ev(page, s => ({ note: s.note, ask: s.ask.open }));
  check('deleting a control the title template uses is blocked with a note', !s.ask && /Can’t delete yet/.test(s.note) && /target\.titleTemplate/.test(s.note) && await isVisible(page, '.bfb-note'), s);
  check('…control still there', !!(await fieldOf(page, 'emailAddr')));
  await ev(page, s => { s.doc.target.titleTemplate = '{form:title}'; });
  await clickIn(page, '[data-bfb-node="field:emailAddr"] [aria-label="Delete control"]');
  check('after removing the token: a confirm dialog', await ev(page, s => s.ask.open && /Delete control\?/.test(s.ask.title)));
  await clickIn(page, '.bfb-ask .btn--primary');
  check('…confirm deletes it', !(await fieldOf(page, 'emailAddr')) && (await ev(page, s => s.sel.t)) === 'form');
  // a section/page with a referenced control is blocked too; its own rules don't block
  await ev(page, s => { s.doc.target.titleTemplate = '{field:backup}'; });
  await clickIn(page, '[data-bfb-node="section:section1"] [aria-label="Delete section"]');
  check('deleting a section whose control is referenced → blocked', /Can’t delete yet/.test(await ev(page, s => s.note)) && !(await ev(page, s => s.ask.open)));
  await ev(page, s => { s.doc.target.titleTemplate = ''; const f = s.loc('field', 'backup').f; f.visibleWhen = { field: 'backup', op: 'notEmpty' }; });
  await clickIn(page, '[data-bfb-node="field:backup"] [aria-label="Delete control"]');
  check('a control\'s own rules don\'t block its delete', await ev(page, s => s.ask.open));
  await clickText(page, '.bfb-ask .btn', /^Cancel$/);
  check('…Cancel keeps it', !!(await fieldOf(page, 'backup')) && !(await ev(page, s => s.ask.open)));
  // a page needs a section, a form needs a page
  await clickIn(page, '[data-bfb-node="page:page1"] [aria-label="Delete page"]');
  check('the only page can\'t be deleted', /at least one page/.test(await ev(page, s => s.note)));
  await clickIn(page, '[data-bfb-node="section:section1"] [aria-label="Delete section"]');
  check('the only section can\'t be deleted', /at least one section/.test(await ev(page, s => s.note)));
  // duplicate: new id, no column (a copy isn't a shared variant)
  await mapCol(page, 'backup', 'TxtShort');
  await clickIn(page, '[data-bfb-node="field:backup"] [aria-label="Duplicate control"]');
  const dup = await ev(page, s => JSON.parse(JSON.stringify(s.cur)));
  check('duplicate → "backupCopy", no column, autoId false', dup.id === 'backupCopy' && !('column' in dup) && dup.$builder.autoId === false, dup);

  console.log('reference walker (core.refsTo / renameRefs):');
  const hand = {
    form: { title: 'R' },
    target: { titleTemplate: 'Req {field:a} by {user:name} ({field:ab})', set: { Notes: '{field:a} / {field:b}', Other: 'fixed' } },
    confirmation: { title: 'Thanks {field:a}', message: { en: 'EN {field:a}', fr: 'FR {field:a}' }, redirect: { url: '/r?x={field:a}' } },
    submitConfirm: { title: 'Sure?', message: 'Send {field:a}?' },
    afterSubmit: {
      lookup: { matchField: 'a' },
      found: { title: '{field:a} found', message: 'ok', copy: '{field:a}', link: { text: 'Open {field:a}' }, redirect: { url: '/x?q={field:a}' } },
      notFound: { title: { en: 'No {field:a}', fr: 'Pas de {field:a}' } }
    },
    queryError: { message: 'Error for {field:a}' },
    pages: [
      { id: 'p1', sections: [{ id: 's1', fields: [
        { id: 'a', type: 'choice' },
        { id: 'ab', type: 'text' },
        { id: 'b', type: 'date', rules: [{ op: 'after', compareTo: 'a' }, { op: 'after', compareTo: '@today' }] },
        { id: 'c', type: 'choice', choicesWhen: { field: 'a', map: {} },
          visibleWhen: { all: [{ field: 'a', op: 'equals', value: 'x' }, { any: [{ field: 'b', op: 'isEmpty' }, { not: { field: 'a', op: 'in', value: [] } }, { field: 'b', op: 'after', compareTo: 'a' }] }] },
          lockWhen: { field: 'a', op: 'equals', value: 'y' } },
        { id: 'd', type: 'date', prompt: { confirm: { set: { b: '', a: 'Urgent', c: 'x' } } } }
      ] }] },
      { id: 'p2', visibleWhen: { field: 'a', op: 'notEmpty' }, endWhen: { not: { field: 'a', op: 'isEmpty' } },
        sections: [{ id: 's2', visibleWhen: { field: 'a', op: 'equals', value: 'z' }, fields: [] }] }
    ]
  };
  const w = await page.evaluate(doc => {
    const core = BSPFormsBuilder.core;
    const before = core.refsTo(doc, 'a');
    const beforeAb = core.refsTo(doc, 'ab');
    core.renameRefs(doc, 'a', 'z');
    return { before, beforeAb, afterA: core.refsTo(doc, 'a'), afterZ: core.refsTo(doc, 'z'), doc, dang: core.danglingRefs(doc).map(d => d.id + '@' + d.where) };
  }, hand);
  const wantWhere = ['page "p2" show-when', 'page "p2" end-when', 'section "s2" show-when', 'field "c" show-when', 'field "c" lockWhen', 'field "b" date rule',
    'field "c" choicesWhen', 'field "d" prompt.confirm.set', 'target.titleTemplate', 'target.set.Notes', 'confirmation.title', 'confirmation.message.en',
    'confirmation.message.fr', 'confirmation.redirect.url', 'submitConfirm.message', 'afterSubmit.lookup.matchField', 'afterSubmit.found.title', 'afterSubmit.found.copy',
    'afterSubmit.found.link.text', 'afterSubmit.found.redirect.url', 'afterSubmit.notFound.title.en', 'afterSubmit.notFound.title.fr', 'queryError.message'];
  const got = [...new Set(w.before)];
  const missing = wantWhere.filter(x => !got.includes(x));
  check('refsTo finds every site (' + wantWhere.length + ' places)', !missing.length, 'missing: ' + missing.join(', ') + ' · got: ' + got.join(', '));
  check('…nested all/any/not: 3 hits in c\'s show-when (field ×2 + a compareTo)', w.before.filter(x => x === 'field "c" show-when').length === 3, w.before.filter(x => x === 'field "c" show-when').length);
  check('…no false hits: target.set.Other, the @today compareTo', !got.includes('target.set.Other') && w.before.filter(x => x === 'field "b" date rule').length === 1);
  check('…{field:ab} is not a hit for "a"; refsTo("ab") = titleTemplate only', same(w.beforeAb, ['target.titleTemplate']), w.beforeAb);
  check('renameRefs a→z: no "a" references left', w.afterA.length === 0, w.afterA);
  check('…every one now points at z (same count)', w.afterZ.length === w.before.length, w.afterZ.length + ' vs ' + w.before.length);
  const D = w.doc;
  const f = id => D.pages[0].sections[0].fields.find(x => x.id === id);
  check('…nested rules rewritten (all → any → not, compareTo)', D.pages[0].sections[0].fields[3].visibleWhen.all[0].field === 'z' &&
    f('c').visibleWhen.all[1].any[1].not.field === 'z' && f('c').visibleWhen.all[1].any[0].field === 'b' && f('c').visibleWhen.all[1].any[2].compareTo === 'z');
  check('…lockWhen, date rule compareTo (@today kept), choicesWhen.field', f('c').lockWhen.field === 'z' && f('b').rules[0].compareTo === 'z' &&
    f('b').rules[1].compareTo === '@today' && f('c').choicesWhen.field === 'z');
  check('…page show-when / end-when (inside not), section show-when', D.pages[1].visibleWhen.field === 'z' && D.pages[1].endWhen.not.field === 'z' && D.pages[1].sections[0].visibleWhen.field === 'z');
  check('…prompt.confirm.set key renamed, order preserved', same(Object.keys(f('d').prompt.confirm.set), ['b', 'z', 'c']) && f('d').prompt.confirm.set.z === 'Urgent', f('d').prompt.confirm.set);
  check('…afterSubmit.lookup.matchField', D.afterSubmit.lookup.matchField === 'z');
  check('…tokens: titleTemplate (other tokens untouched), target.set', D.target.titleTemplate === 'Req {field:z} by {user:name} ({field:ab})' &&
    D.target.set.Notes === '{field:z} / {field:b}' && D.target.set.Other === 'fixed', D.target);
  check('…tokens: confirmation (title, {en, fr}, redirect), submitConfirm', D.confirmation.title === 'Thanks {field:z}' && D.confirmation.message.en === 'EN {field:z}' &&
    D.confirmation.message.fr === 'FR {field:z}' && D.confirmation.redirect.url === '/r?x={field:z}' && D.submitConfirm.message === 'Send {field:z}?' && D.submitConfirm.title === 'Sure?');
  check('…tokens: afterSubmit screens (title, copy, link.text, redirect.url, {en, fr}), queryError', D.afterSubmit.found.title === '{field:z} found' &&
    D.afterSubmit.found.copy === '{field:z}' && D.afterSubmit.found.link.text === 'Open {field:z}' && D.afterSubmit.found.redirect.url === '/x?q={field:z}' &&
    D.afterSubmit.notFound.title.en === 'No {field:z}' && D.afterSubmit.notFound.title.fr === 'Pas de {field:z}' && D.queryError.message === 'Error for {field:z}');
  check('…ids themselves untouched (the caller renames the field)', D.pages[0].sections[0].fields[0].id === 'a');
  check('danglingRefs then reports "z" (no control has it)', w.dang.length === w.afterZ.length && w.dang.every(x => /^z@/.test(x)), w.dang);
  const cam = await page.evaluate(() => ['Contact email', '2nd phone', '  ', 'Café — déjà vu!', 'A'.repeat(60)].map(BSPFormsBuilder.core.camelId));
  check('camelId: "Contact email"→contactEmail, digit-led → field…, blank → field', cam[0] === 'contactEmail' && cam[1] === 'field2ndPhone' && cam[2] === 'field' &&
    /^[A-Za-z][A-Za-z0-9]*$/.test(cam[3]) && cam[4].length <= 40, cam);
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   9. Ordering (D20): move buttons, drag & drop, one/two columns
   ------------------------------------------------------------------ */
const layout = page => ev(page, s => s.doc.pages.map(p => p.id + '[' + p.sections.map(x => x.id + '(' + x.fields.map(f => f.id).join(',') + ')').join(' ') + ']').join(' '));
async function move(page, t, id, dir) {
  const label = { field: 'control', section: 'section', page: 'page' }[t];
  await clickIn(page, '[data-bfb-node="' + t + ':' + id + '"] [aria-label="Move ' + label + ' ' + (dir < 0 ? 'up' : 'down') + '"]');
}
async function dnd(page, from, to, where) {
  await page.evaluate(({ from, to, where }) => {
    const a = document.querySelector('[data-bfb-node="' + from + '"]');
    const b = to.indexOf('empty:') === 0
      ? document.querySelector('[data-bfb-node="section:' + to.slice(6) + '"]').closest('.bfb-section').querySelector('.bfb-empty')
      : document.querySelector('[data-bfb-node="' + to + '"]');
    const dt = new DataTransfer();
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = b.getBoundingClientRect();
    const y = where === 'top' ? r.top + 2 : r.bottom - 2;
    const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y };
    b.dispatchEvent(new DragEvent('dragenter', o));
    b.dispatchEvent(new DragEvent('dragover', o));
    b.dispatchEvent(new DragEvent('drop', o));
    a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  }, { from, to, where });
  await page.waitForTimeout(100);
}
async function testOrdering(browser) {
  console.log('ordering (D20):');
  const { ctx, page } = await openBuilder(browser);
  await pickList(page, 'BSPF Builder Test');
  const t1 = await addControl(page, 'section1', 'Single line text');
  const t2 = await addControl(page, 'section1', 'Choice');
  await ev(page, s => s.addSection('page1'));
  const s2 = await ev(page, s => s.sel.id);
  const n = await addControl(page, s2, 'Number');
  await ev(page, s => s.addPage());
  const p2 = await ev(page, s => s.sel.id);
  const s3 = await ev(page, (s, p) => s.loc('page', p).pg.sections[0].id, p2);
  const d = await addControl(page, s3, 'Date');
  await mapCol(page, d, 'DateTimeCol');
  const L0 = await layout(page);
  check('setup: page1[section1(t1,t2) ' + s2 + '(n)] ' + p2 + '[' + s3 + '(d)]', L0 === `page1[section1(${t1},${t2}) ${s2}(${n})] ${p2}[${s3}(${d})]`, L0);
  // BUG (see the report): addPage builds 'section' + n + 1 by string concatenation
  check('fixed: new page\'s section id is sequential (section2 / page2 / section3, not section21)', s2 === 'section2' && p2 === 'page2' && s3 === 'section3', [s2, p2, s3]);
  await settle(page);
  await mapCol(page, t1, 'TxtShort');
  await ev(page, s => s.select('form'));
  await settle(page);
  await page.screenshot({ path: path.join(SHOTS, 'bfb-outline.png'), fullPage: true });
  check('outline: an unmapped control shows the error state', await page.evaluate(id => document.querySelector('[data-bfb-node="field:' + id + '"]').classList.contains('has-error'), t2));

  await move(page, 'field', t1, 1);
  check('field down within a section', (await layout(page)).startsWith(`page1[section1(${t2},${t1})`), await layout(page));
  check('…focus follows the moved control', await page.evaluate(id => document.activeElement && document.activeElement.closest('[data-bfb-node]') &&
    document.activeElement.closest('[data-bfb-node]').getAttribute('data-bfb-node') === 'field:' + id, t1));
  await move(page, 'field', t1, 1);
  check('field down across a section boundary → top of the next section', (await layout(page)).startsWith(`page1[section1(${t2}) ${s2}(${t1},${n})]`), await layout(page));
  await move(page, 'field', t1, -1);
  check('field up across the boundary → end of the previous section', (await layout(page)).startsWith(`page1[section1(${t2},${t1}) ${s2}(${n})]`), await layout(page));
  await move(page, 'field', n, 1);
  check('field down across pages → top of the next page\'s section', (await layout(page)) === `page1[section1(${t2},${t1}) ${s2}()] ${p2}[${s3}(${n},${d})]`, await layout(page));
  await move(page, 'field', n, -1);
  check('field up back across pages', (await layout(page)) === `page1[section1(${t2},${t1}) ${s2}(${n})] ${p2}[${s3}(${d})]`, await layout(page));
  await move(page, 'field', t2, -1);
  check('first field up: no change', (await layout(page)) === `page1[section1(${t2},${t1}) ${s2}(${n})] ${p2}[${s3}(${d})]`, await layout(page));
  await move(page, 'section', s2, -1);
  check('section up within a page', (await layout(page)).startsWith(`page1[${s2}(${n}) section1(`), await layout(page));
  await move(page, 'section', s2, 1);
  await move(page, 'section', s2, 1);
  check('section down across pages → top of the next page', (await layout(page)) === `page1[section1(${t2},${t1})] ${p2}[${s2}(${n}) ${s3}(${d})]`, await layout(page));
  await move(page, 'section', s2, -1);
  check('section up across pages → end of the previous page', (await layout(page)) === `page1[section1(${t2},${t1}) ${s2}(${n})] ${p2}[${s3}(${d})]`, await layout(page));
  await move(page, 'section', s3, -1);
  check('moving a page\'s only section away is refused', (await layout(page)) === `page1[section1(${t2},${t1}) ${s2}(${n})] ${p2}[${s3}(${d})]`, await layout(page));
  check('first page\'s "Move page up" is disabled', await page.evaluate(() => document.querySelector('[data-bfb-node="page:page1"] [aria-label="Move page up"]').disabled));
  await move(page, 'page', p2, -1);
  check('page up', (await layout(page)).startsWith(`${p2}[`), await layout(page));
  check('…step numbers follow (page2 shows 1)', await page.evaluate(id => document.querySelector('[data-bfb-node="page:' + id + '"] .bfb-step').textContent === '1', p2));
  await move(page, 'page', p2, 1);
  check('page down', (await layout(page)).startsWith('page1['), await layout(page));

  console.log('drag & drop:');
  await dnd(page, 'field:' + t2, 'section:' + s3, 'top');
  check('drag a control onto another section → appended into it', (await layout(page)) === `page1[section1(${t1}) ${s2}(${n})] ${p2}[${s3}(${d},${t2})]`, await layout(page));
  check('…the dragged control is selected', (await ev(page, s => s.sel.t + ':' + s.sel.id)) === 'field:' + t2);
  await dnd(page, 'field:' + d, 'field:' + t1, 'top');
  check('drag a control onto the top half of another → before it (across pages)', (await layout(page)) === `page1[section1(${d},${t1}) ${s2}(${n})] ${p2}[${s3}(${t2})]`, await layout(page));
  await dnd(page, 'field:' + d, 'field:' + n, 'bottom');
  check('drag onto the bottom half → after it', (await layout(page)) === `page1[section1(${t1}) ${s2}(${n},${d})] ${p2}[${s3}(${t2})]`, await layout(page));
  await ev(page, s => s.select('form')); // a selected MAPPED control + a page drop trips the null-cur bug — checked on its own below
  await dnd(page, 'page:' + p2, 'page:page1', 'top');
  check('drag a page above another → pages reordered', (await layout(page)).startsWith(`${p2}[`), await layout(page));
  await dnd(page, 'page:page1', 'page:' + p2, 'top');
  check('…and back', (await layout(page)).startsWith('page1['), await layout(page));
  await dnd(page, 'section:' + s2, 'page:' + p2, 'top');
  check('drag a section onto a page → appended to that page', (await layout(page)) === `page1[section1(${t1})] ${p2}[${s3}(${t2}) ${s2}(${n},${d})]`, await layout(page));
  await dnd(page, 'section:section1', 'page:' + p2, 'top');
  check('dragging a page\'s only section away is refused (note shown)', (await layout(page)).startsWith('page1[section1(') && /at least one section/.test(await ev(page, s => s.note)), await layout(page));
  await dnd(page, 'field:' + t1, 'field:' + t1, 'top');
  check('dropping a control on itself: no change', (await layout(page)).startsWith(`page1[section1(${t1})]`), await layout(page));
  await dnd(page, 'field:' + t1, 'page:page1', 'top');
  check('a control can\'t be dropped on a page node', (await layout(page)).startsWith(`page1[section1(${t1})]`), await layout(page));
  // empty-section drop zone
  await ev(page, s => s.addSection('page1'));
  const s4 = await ev(page, s => s.sel.id);
  await dnd(page, 'field:' + t1, 'empty:' + s4, 'top');
  check('drag into an empty section\'s drop zone', (await layout(page)).startsWith(`page1[section1() ${s4}(${t1})]`), await layout(page));

  console.log('one/two columns:');
  await selectNode(page, 'section', s4);
  await clickText(page, '.bfb-props .bfb-seg__opt', /^Two columns$/);
  check('"Two columns" sets columns: 2', (await ev(page, (s, id) => s.loc('section', id).sec.columns, s4)) === 2);
  check('…outline says "Two columns"', /Two columns/.test(await page.locator('[data-bfb-node="section:' + s4 + '"] .bfb-node__sub').textContent()));
  check('…and the serialized JSON has "columns": 2', await ev(page, (s, id) => JSON.parse(s.jsonText()).pages[0].sections.find(x => x.id === id).columns === 2, s4));
  await clickText(page, '.bfb-props .bfb-seg__opt', /^One column$/);
  check('"One column" removes the key', await ev(page, (s, id) => !('columns' in s.loc('section', id).sec), s4));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  // BUG (see the report): with a MAPPED control selected, a page drag & drop
  // (doc change + select('page') in one tick) re-runs the field pane's
  // "cur.column && …" x-if after cur went null
  await ev(page, (s, a) => { const l = s.loc('field', a.d); l.sec.fields.splice(l.fi, 1); s.loc('section', a.s4).sec.fields.push(l.f); }, { d, s4 });
  await mapCol(page, d, 'DateTimeCol'); // selected, on page1
  const before = page.__errors.length;
  await dnd(page, 'page:' + p2, 'page:page1', 'top');
  await page.waitForTimeout(150);
  const fresh = page.__errors.slice(before);
  check('fixed: mapped control selected + page drag & drop: no page error', fresh.length === 0, fresh.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   10 + 11. Undo/redo; autosave
   ------------------------------------------------------------------ */
async function testUndoAndDraft(browser) {
  console.log('undo / redo:');
  const { ctx, page } = await openBuilder(browser);
  check('undo/redo disabled at start', await page.evaluate(() => document.querySelector('[aria-label="Undo"]').disabled && document.querySelector('[aria-label="Redo"]').disabled));
  await propInput(page, 'Title').fill('Edit one');
  await settle(page);
  const snap1 = await docOf(page);
  await propInput(page, 'Title').fill('Edit two');
  await settle(page);
  const snap2 = await docOf(page);
  await ev(page, s => s.addPage());
  await settle(page);
  check('3 edits made (title, title, page); canUndo()', (await docOf(page)).pages.length === 2 && await ev(page, s => s.canUndo()));
  // BUG (see the report): canUndo()/canRedo() read a non-reactive closure
  // (hist), so the toolbar buttons' :disabled never re-evaluates
  check('fixed: Undo button enabled after an edit', await page.evaluate(() => !document.querySelector('[aria-label="Undo"]').disabled));
  await ev(page, s => s.undo());
  await ev(page, s => s.undo());
  await page.waitForTimeout(80);
  let d = await docOf(page);
  check('undo ×2 → the doc after edit 1', same(d, snap1), d.form.title + ' / ' + d.pages.length);
  check('…selection falls back to the form (the page is gone)', (await ev(page, s => s.sel.t)) === 'form');
  check('…the Title input shows "Edit one"', (await propInput(page, 'Title').inputValue()) === 'Edit one');
  check('fixed: Redo button enabled after an undo', await page.evaluate(() => !document.querySelector('[aria-label="Redo"]').disabled));
  await ev(page, s => s.redo());
  await page.waitForTimeout(80);
  d = await docOf(page);
  check('redo ×1 → the doc after edit 2', same(d, snap2), d.form.title + ' / ' + d.pages.length);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('Ctrl+Z (focus outside inputs) undoes', (await docOf(page)).form.title === 'Edit one');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);
  check('Ctrl+Y redoes', (await docOf(page)).form.title === 'Edit two');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  check('Ctrl+Shift+Z redoes (the added page comes back)', (await docOf(page)).pages.length === 2);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  await propInput(page, 'Title').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('Ctrl+Z inside a text input is left to the input (doc unchanged)', (await docOf(page)).form.title === 'Edit two' && (await docOf(page)).pages.length === 1);
  // a pending (not yet debounced) edit is flushed, not lost, by undo
  await ev(page, s => { s.doc.form.title = 'Quick'; s.undo(); });
  await page.waitForTimeout(100);
  check('undo right after an edit (inside the debounce) undoes that edit', (await docOf(page)).form.title === 'Edit two');
  await ev(page, s => s.redo());
  check('…and redo brings it back', (await docOf(page)).form.title === 'Quick');
  await settle(page);
  // a new edit clears the redo stack
  await ev(page, s => s.undo());
  await ev(page, s => { s.doc.form.title = 'Branch'; });
  await settle(page);
  check('a new edit after undo clears redo', !(await ev(page, s => s.canRedo())));

  console.log('autosave:');
  await pickList(page, 'BSPF Builder Test');
  await propInput(page, 'Title').fill('Draft form');
  const r = await addControl(page, 'section1', 'Single line text');
  await mapCol(page, r, 'TxtReq');
  await settle(page, 600);
  const saved = await docOf(page);
  check('draft written to localStorage', await page.evaluate(() => {
    const v = localStorage.getItem('bspf-builder-draft:' + location.pathname);
    return !!v && JSON.parse(v).doc.form.title === 'Draft form' && !!JSON.parse(v).savedAt;
  }));
  await gotoBuilder(page, false);
  check('reload without ?fresh → "unsaved draft" banner', await isVisible(page, '.bfb-draft') && /unsaved draft/.test(await page.locator('.bfb-draft').textContent()));
  check('…the builder starts on a new doc until Restore', (await docOf(page)).form.title === 'Untitled form');
  const nSchemaBefore = await page.evaluate(() => window.__BSPF_MOCK_WRITES__.filter(w => w.op === 'getListSchema').length);
  await clickText(page, '.bfb-draft .btn', /^Restore it$/);
  await page.waitForFunction(new Function('const s = ' + ST + '; return s.schema.state === "ready";'), null, { timeout: 5000 });
  d = await docOf(page);
  check('Restore brings the doc back', same(d, saved), d.form.title);
  check('…and re-reads the schema (getListSchema called, catalog ready)', (await page.evaluate(() => window.__BSPF_MOCK_WRITES__.filter(w => w.op === 'getListSchema').length)) === nSchemaBefore + 1 &&
    (await ev(page, s => s.listTitle())) === 'BSPF Builder Test');
  check('…banner gone', !(await isVisible(page, '.bfb-draft')));
  await settle(page);
  check('…restored form validates against the schema (0 errors after a title template)', await ev(page, s => { s.doc.target.titleTemplate = '{form:title}'; s.recheck(); return s.nErr === 0; }));
  await settle(page);
  await gotoBuilder(page, false);
  check('reload again → banner again', await isVisible(page, '.bfb-draft'));
  await clickText(page, '.bfb-draft .btn', /^Discard$/);
  check('Discard hides the banner and removes the draft', !(await isVisible(page, '.bfb-draft')) &&
    await page.evaluate(() => localStorage.getItem('bspf-builder-draft:' + location.pathname) === null));
  await gotoBuilder(page, false);
  check('…reload: no banner', !(await isVisible(page, '.bfb-draft')));
  await ev(page, s => { s.doc.form.title = 'X'; });
  await settle(page);
  await gotoBuilder(page, true);
  check('?fresh clears a saved draft', !(await isVisible(page, '.bfb-draft')));
  // "New" replaces the doc after a confirm
  await ev(page, s => { s.doc.form.title = 'Keep me'; });
  await clickText(page, '.bfb-bar .btn', /^New$/);
  check('"New" asks first', await ev(page, s => s.ask.open && /Start a new form/.test(s.ask.title)));
  await clickIn(page, '.bfb-ask .btn--primary');
  check('…then starts over', (await docOf(page)).form.title === 'Untitled form');
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------
   12 + 13. Download, then the engine harness submits it
   ------------------------------------------------------------------ */
let downloaded = null; // { json, text, slug }
async function grab(page, clickSel, idx) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.evaluate(({ s, i }) => document.querySelectorAll(s)[i].click(), { s: clickSel, i: idx || 0 })
  ]);
  const p = path.join(DL_DIR, dl.suggestedFilename());
  await dl.saveAs(p);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
}
function walk(o, fn, at) {
  if (Array.isArray(o)) o.forEach((x, i) => walk(x, fn, at + '[' + i + ']'));
  else if (o && typeof o === 'object') { fn(o, at); Object.keys(o).forEach(k => walk(o[k], fn, at + '.' + k)); }
}
async function testDownload(browser) {
  console.log('download:');
  fs.mkdirSync(DL_DIR, { recursive: true });
  const { ctx, page } = await openBuilder(browser);
  await pickList(page, 'BSPF Builder Test');
  await propInput(page, 'Title').fill('Equipment Loan Request');
  await propInput(page, 'Item title').fill('{form:title} — {user:name}');
  const ids = {};
  for (const [k, label, col] of [['req', 'Single line text', 'TxtReq'], ['choice', 'Choice', 'ChoiceA'], ['date', 'Date', 'DateTimeCol'], ['people', 'Person', 'People'],
    ['link', 'URL', 'LinkCol'], ['num', 'Number', 'NumPlain'], ['yes', 'Yes / No', 'YesNo'], ['under', 'Single line text', '_Under']]) {
    ids[k] = await addControl(page, 'section1', label);
    await mapCol(page, ids[k], col);
  }
  await addControl(page, 'section1', 'Heading');
  const logic = await addControl(page, 'section1', 'Yes / No');
  await toggleSwitch(page, 'Not saved (logic only)');
  await settle(page);
  const iss = await issuesOf(page);
  check('valid form: 0 errors', (await ev(page, s => s.nErr)) === 0, issueLine(iss));
  check('Download enabled', !(await downloadDisabled(page)));
  await clickText(page, '.bfb-bar .btn--primary', /Download/);
  check('the download dialog opens', await isVisible(page, '.bfb-dl .dialog'));
  check('file name defaults to the title slug "equipment-loan-request"', (await page.inputValue('#bfb-slug')) === 'equipment-loan-request', await page.inputValue('#bfb-slug'));
  check('data-validate checkbox on by default', await page.isChecked('.bfb-dl .bfb-check input'));
  const j = await grab(page, '.bfb-dl .bfb-filecard', 0);
  check('JSON card downloads equipment-loan-request.json', j.name === 'equipment-loan-request.json', j.name);
  const stub = await grab(page, '.bfb-dl .bfb-filecard', 1);
  check('stub card downloads equipment-loan-request.webpart.html', stub.name === 'equipment-loan-request.webpart.html', stub.name);
  check('the "Next" checklist shows after a download', await isVisible(page, '.bfb-check-list'));
  await page.screenshot({ path: path.join(SHOTS, 'bfb-download.png'), fullPage: true });
  let json = null;
  try { json = JSON.parse(j.text); } catch (e) { /* checked below */ }
  check('JSON parses', !!json);
  json = json || {};
  check('2-space indent, trailing newline', j.text.startsWith('{\n  "form": {') && j.text.endsWith('}\n'));
  const norm = await page.evaluate(c => BSPForms.normalize(c).errors, json);
  check('BSPForms.normalize(json).errors is empty', norm.length === 0, norm);
  const keys = Object.keys(json);
  check('top-level key order: form, target, …, $builder last', keys[0] === 'form' && keys[1] === 'target' && keys[keys.length - 1] === '$builder', keys);
  const ORDER = ['$comment', 'form', 'target', 'sharedColumns', 'submitConfirm', 'confirmation', 'afterSubmit', 'queryError', 'attachments', 'strings', 'pages'];
  const known = keys.filter(k => ORDER.includes(k));
  check('…known keys follow the fixed order', same(known, ORDER.filter(k => keys.includes(k))), keys);
  const fields = (json.pages || []).flatMap(p => p.sections.flatMap(s => s.fields));
  check('every field: $builder last', fields.every(f => !('$builder' in f) || Object.keys(f).pop() === '$builder'), fields.map(f => Object.keys(f).join(',')));
  let lastOk = true;
  walk(json, (o) => { if ('$builder' in o && Object.keys(o).pop() !== '$builder') lastOk = false; }, '');
  check('…and in every nested object', lastOk);
  check('no autoId anywhere', !/autoId/.test(j.text));
  check('no sharedColumns (no column mapped twice)', !('sharedColumns' in json));
  check('target.sendEmpty true; siteUrl + listUrl; no listId/listTitle', json.target && json.target.sendEmpty === true && json.target.siteUrl === '/sites/FCUPortal' &&
    json.target.listUrl === '/sites/FCUPortal/Lists/BSPFBuilderTest' && !('listId' in json.target) && !('listTitle' in json.target), json.target);
  check('$builder: version 1, list, savedAt', json.$builder && json.$builder.version === 1 && json.$builder.list && json.$builder.list.listTitle === 'BSPF Builder Test' &&
    !isNaN(Date.parse(json.$builder.savedAt)), json.$builder);
  check('logic-only control kept with $builder.logicOnly; field kinds kept', fields.find(f => f.id === logic).$builder.logicOnly === true && fields.every(f => f.$builder && f.$builder.kind));
  check('empty optional strings dropped (form.intro, section title)', !('intro' in json.form) && !('title' in json.pages[0].sections[0]), [json.form, json.pages[0].sections[0].title]);
  check('the "_Under" control keeps column "_Under" (the engine adds OData_)', fields.find(f => f.id === ids.under).column === '_Under');
  // the stub
  check('stub: <div data-bsp-form data-validate …>', /<div data-bsp-form data-validate data-config="/.test(stub.text), stub.text);
  check('stub: data-config ends /forms/equipment-loan-request.json', /data-config="[^"]*\/forms\/equipment-loan-request\.json"/.test(stub.text) &&
    /data-config="\/bsp-sp-parts\/bsp-forms\/forms\/equipment-loan-request\.json"/.test(stub.text), (stub.text.match(/data-config="[^"]*"/) || [])[0]);
  const engUrl = await ev(page, s => (typeof s.engineUrl === 'function' ? s.engineUrl() : null));
  check('engineUrl() = engineBase + bsp-forms.js?v=<assetVersion>', engUrl === await page.evaluate(() => BSPForms.engineBase + 'bsp-forms.js' + (BSPForms.assetVersion ? '?v=' + BSPForms.assetVersion : '')) &&
    /\/bsp-forms\/bsp-forms\.js\?v=0\.6\.0$/.test(engUrl || ''), engUrl);
  check('stub: engine script src = engineUrl() (no stray cache params)', !!engUrl && stub.text.includes('<script src="' + engUrl + '"></script>') && !/pnp=/.test(stub.text),
    (stub.text.match(/<script[^>]*>/) || [])[0]);
  check('stub: names the form in its comment', /BSP Forms — Equipment Loan Request/.test(stub.text));
  // data-validate off
  await page.click('.bfb-dl .bfb-check input');
  const stub2 = await grab(page, '.bfb-dl .bfb-filecard', 1);
  check('checkbox off → stub without data-validate', !/data-validate/.test(stub2.text.split('-->')[1] || stub2.text) && /<div data-bsp-form data-config="/.test(stub2.text), stub2.text);
  // custom slug is slugified
  await page.fill('#bfb-slug', 'My Loans!!');
  const j2 = await grab(page, '.bfb-dl .bfb-filecard', 0);
  check('a typed name is slugified ("My Loans!!" → my-loans.json)', j2.name === 'my-loans.json' && (await page.inputValue('#bfb-slug')) === 'my-loans', j2.name);
  // "Download both"
  const names = [];
  const onDl = dl => names.push(dl.suggestedFilename());
  page.on('download', onDl);
  await clickText(page, '.bfb-dl .dialog__foot .btn--primary', /Download both/);
  for (let i = 0; i < 30 && names.length < 2; i++) await page.waitForTimeout(100);
  page.off('download', onDl);
  check('"Download both" → my-loans.json + my-loans.webpart.html', same(sorted(names), ['my-loans.json', 'my-loans.webpart.html']), names);
  await clickText(page, '.bfb-dl .dialog__foot .btn', /^Close$/);
  // sharedColumns only when a column is mapped twice
  const dup = await addControl(page, 'section1', 'Single line text');
  await mapCol(page, dup, '_Under');
  await settle(page);
  let sj = await ev(page, s => JSON.parse(s.jsonText()));
  check('a column mapped twice → sharedColumns ["_Under"]', same(sj.sharedColumns, ['_Under']) && Object.keys(sj).indexOf('sharedColumns') === 2, sj.sharedColumns);
  check('…the doc itself carries no sharedColumns (serialize derives it)', !('sharedColumns' in (await docOf(page))));
  const sharedIss = await issuesOf(page);
  check('…warned (not blocked): give each a show-when rule', has(sharedIss, /“_Under” is saved by 2 controls/, 'warn') && (await ev(page, s => s.nErr)) === 0, issueLine(sharedIss));
  await page.selectOption('#bfb-col-' + dup, '');
  sj = await ev(page, s => JSON.parse(s.jsonText()));
  check('…unmapping one drops sharedColumns', !('sharedColumns' in sj));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  downloaded = { json, ids, logic };
  await ctx.close();
}

async function testEndToEnd(browser) {
  console.log('end-to-end (engine harness):');
  if (!downloaded || !downloaded.json || !downloaded.json.pages) { check('downloaded JSON available', false, 'testDownload did not produce one'); return; }
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.BSPF_MOCK_ADD_MS = 50; });
  await page.route('**/forms/example-it-request.json', r => r.fulfill({ json: downloaded.json }));
  await page.goto(ENGINE);
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-bsp-form]');
    return m && /ready|error/.test(m.getAttribute('data-bspf-state') || '');
  }, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const st = await page.getAttribute('[data-bsp-form]', 'data-bspf-state');
  check('the engine loads the downloaded config (state ready)', st === 'ready', st + ' ' + (await page.evaluate(() => (document.querySelector('[data-bspf-fatal]') || {}).textContent)));
  if (st !== 'ready') { await ctx.close(); return; }
  const I = downloaded.ids;
  check('the form title renders', /Equipment Loan Request/.test(await page.locator('.bspf').first().textContent()));
  check('logic-only control renders (it drives rules, saves nothing)', await page.evaluate(id => !!document.querySelector('[data-bspf-field="' + id + '"]'), downloaded.logic));
  const res = await page.evaluate(({ I, SOFIA }) => {
    const s = document.querySelector('.bspf')._x_dataStack[0];
    s.values[I.req] = 'Laptop for onboarding';
    s.values[I.choice] = 'High';
    s.values[I.date] = '2030-02-01';
    s.values[I.people] = [{ key: SOFIA.key, text: SOFIA.text, email: SOFIA.email, id: null }];
    s.values[I.link] = { url: 'https://example.com/spec', desc: '' };
    s.values[I.num] = 42;
    s.values[I.yes] = true;
    s.values[I.under] = 'under value';
    return new Promise(r => setTimeout(() => { s.submitForm(); r(true); }, 100));
  }, { I, SOFIA });
  await page.waitForFunction(() => window.__BSPF_MOCK_WRITES__.some(w => w.op === 'addItem'), null, { timeout: 5000 }).catch(() => {});
  const errs = await page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('.bspf')._x_dataStack[0].errors)));
  const p = (await page.evaluate(() => window.__BSPF_MOCK_WRITES__.filter(w => w.op === 'addItem').map(w => w.payload)))[0];
  check('submit → one addItem', !!p && res, 'validation errors: ' + JSON.stringify(errs));
  if (p) {
    const want = ['ChoiceA', 'DateTimeCol', 'LinkCol', 'NumPlain', 'OData__Under', 'PeopleId', 'Title', 'TxtReq', 'YesNo'];
    check('payload keys are exactly the mapped columns + Title', same(sorted(Object.keys(p)), want), Object.keys(p).sort());
    check('"_Under" sent as OData__Under (no raw _Under key)', p.OData__Under === 'under value' && !('_Under' in p));
    check('Title from the template: "Equipment Loan Request — Dev Tester"', p.Title === 'Equipment Loan Request — Dev Tester', p.Title);
    check('values: text, choice, number, yes/no, link, people', p.TxtReq === 'Laptop for onboarding' && p.ChoiceA === 'High' && p.NumPlain === 42 && p.YesNo === true &&
      p.LinkCol && p.LinkCol.Url === 'https://example.com/spec' && JSON.stringify(p.PeopleId) === '{"results":[1000]}', p);
    check('date-only value saved at local noon', typeof p.DateTimeCol === 'string' && new Date(p.DateTimeCol).getHours() === 12, p.DateTimeCol);
  }
  // sendEmpty: a second, empty-ish submit sends explicit empties for every mapped column
  await page.evaluate(() => { const s = document.querySelector('.bspf')._x_dataStack[0]; if (s.reset) s.reset(); });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const suite = [testBootAndCatalog, testControls, testSwitchAndLogicOnly, testChecks, testIds, testOrdering, testUndoAndDraft, testDownload, testEndToEnd];
  try {
    for (const t of suite) {
      if (only && !only.includes(t.name)) continue;
      try { await t(browser); } catch (e) { check(t.name + ' ran to the end', false, e.message.split('\n')[0]); }
    }
  } finally {
    await browser.close();
  }
  console.log('\nscreenshots: ' + ['bfb-outline.png', 'bfb-choice.png', 'bfb-catalog.png', 'bfb-download.png'].map(n => path.join(SHOTS, n)).join(', '));
  console.log(failures ? '\nFAILED: ' + failures + ' of ' + total + ' check(s)' : '\nALL ' + total + ' CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
