/*! BSP Forms · dev/smoke.spec.js — headless regression suite (dev-only) */
/*
 * Drives the dev harness (mock SharePoint, vendored Alpine) through the
 * full lifecycle and asserts the payload/behavior invariants that manual
 * clicking doesn't reliably catch. The deployed runtime stays buildless —
 * this file never ships.
 *
 * Run:
 *   npm i playwright            (once, anywhere on the dev machine)
 *   python -m http.server 8000  (from the folder containing BOTH
 *                                bsp-sp-parts/ and bsp-design-system/)
 *   node bsp-sp-parts/bsp-forms/dev/smoke.spec.js [baseUrl]
 *
 * baseUrl defaults to http://localhost:8000/bsp-sp-parts/bsp-forms/dev/index.html
 * Set CHROMIUM=/path/to/chrome to pin the browser executable.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8000/bsp-sp-parts/bsp-forms/dev/index.html';

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  [' + detail + ']'));
  if (!ok) failures++;
}

async function launch() {
  return chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

/* Programmatic nav clicks: pointer-coordinate clicks flake when validation
   messages shift layout mid-click (see CLAUDE.md). */
async function navClick(page, text) {
  await page.waitForTimeout(150);
  const ok = await page.evaluate((t) => {
    const btns = [...document.querySelectorAll('.bspf button')]
      .filter(b => b.textContent.trim().startsWith(t) && b.offsetParent !== null);
    if (!btns.length) return false;
    btns[0].click();
    return true;
  }, text);
  if (!ok) throw new Error('navClick: no visible button "' + text + '"');
}

async function testEditMode(browser) {
  console.log('edit mode:');
  const page = await browser.newPage();
  await page.goto(BASE + '?Mode=Edit');
  await page.waitForTimeout(800);
  check('placeholder note is visible', await page.locator('.bspf-editnote').isVisible());
  check('form is not rendered', (await page.locator('.bspf').count()) === 0);
  await page.close();
}

async function testConfigErrors(browser) {
  console.log('config validation:');
  for (const [name, mutate] of [
    ['undeclared shared column → error card', cfg => { delete cfg.sharedColumns; }],
    ['invalid validation.pattern → error card', cfg => {
      cfg.pages[0].sections[0].fields.find(f => f.id === 'costCentre').validation.pattern = '(';
    }],
    ['duplicate section id → error card', cfg => { cfg.pages[1].sections[1].id = cfg.pages[1].sections[0].id; }],
    ['columns: 3 → error card', cfg => { cfg.pages[0].sections[0].columns = 3; }],
    ['unknown attachments.section → error card', cfg => { cfg.attachments.section = 'nope'; }],
    ['prompt without form.businessHours → error card', cfg => { delete cfg.form.businessHours; }]
  ]) {
    const page = await browser.newPage();
    await page.route('**/example-it-request.json', async route => {
      const cfg = await (await route.fetch()).json();
      mutate(cfg);
      await route.fulfill({ json: cfg });
    });
    await page.goto(BASE);
    await page.waitForTimeout(900);
    const state = await page.getAttribute('[data-bsp-form]', 'data-bspf-state');
    check(name, state === 'error' && await page.locator('[data-bspf-fatal]').isVisible(), 'state=' + state);
    await page.close();
  }
}

async function testPresentation(browser) {
  console.log('presentation:');
  let page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  await page.goto(BASE);
  await page.waitForTimeout(1000);
  const look = await page.evaluate(() => {
    const a = document.querySelector('.bspf__intro a');
    const g = document.querySelector('.bspf-fields--2');
    const att = document.querySelector('[data-bspf-field="_attachments"]');
    return {
      link: a && { href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent },
      cols: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0,
      tiles: document.querySelectorAll('.bspf-section__tile use').length,
      attInConfirm: !!(att && att.closest('section') && att.closest('section').querySelector('[data-bspf-field="managerAware"]'))
    };
  });
  check('intro [text](url) → link in a new tab', look.link && look.link.href === '/sites/FCUPortal/Go#it' &&
    look.link.target === '_blank' && /noopener/.test(look.link.rel) && look.link.text === 'service catalogue', JSON.stringify(look.link));
  check('columns: 2 → two-column grid at this width', look.cols === 2, look.cols);
  check('section icon tile rendered', look.tiles === 1, look.tiles);
  check('attachments.section → dropzone inside that section', look.attInConfirm);
  await page.close();

  // unsafe link targets and markup stay literal text
  page = await browser.newPage();
  await page.route('**/example-it-request.json', async route => {
    const cfg = await (await route.fetch()).json();
    cfg.form.intro = 'A [bad](javascript:alert(1)) link and <b>tags</b>.';
    await route.fulfill({ json: cfg });
  });
  await page.goto(BASE);
  await page.waitForTimeout(900);
  const intro = await page.evaluate(() => {
    const p = document.querySelector('.bspf__intro');
    return { links: p.querySelectorAll('a').length, bold: p.querySelectorAll('b').length, text: p.textContent };
  });
  check('javascript: link and raw tags are not rendered', intro.links === 0 && intro.bold === 0 && /\[bad\]\(javascript:/.test(intro.text), JSON.stringify(intro));
  await page.close();
}

async function testDoctorRichText(browser) {
  console.log('doctor (richText):');
  for (const [name, mutate, want] of [
    ['matching richText → OK', null, 'OK'],
    ['missing richText on a rich-text column → Check', cfg => {
      cfg.pages.forEach(p => p.sections.forEach(s => s.fields.forEach(f => {
        if (f.id === 'priorityJustification') delete f.richText;
      })));
    }, 'Check']
  ]) {
    const page = await browser.newPage();
    if (mutate) {
      await page.route('**/example-it-request.json', async route => {
        const cfg = await (await route.fetch()).json();
        mutate(cfg);
        await route.fulfill({ json: cfg });
      });
    }
    await page.goto(BASE + '?validate');
    await page.waitForSelector('.bspf-doctor tbody tr', { timeout: 5000 }).catch(() => {});
    const row = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('.bspf-doctor tbody tr')]
        .find(r => r.children[1] && r.children[1].textContent.trim() === 'Justification');
      return tr ? [...tr.children].map(td => td.textContent.trim()) : null;
    });
    check(name, row && row[4] === want && (want === 'OK' || /rich text/.test(row[3])), JSON.stringify(row));
    await page.close();
  }
}

/* Business-time tests pin the page clock (page.clock) so weekday/hour never
   depend on when the suite runs. 2030-01-08 is a Tuesday; January Eastern
   time is UTC-5, so 15:00Z = 10:00 ET and 22:00Z = 17:00 ET. */
const TUE_10AM_ET = '2030-01-08T15:00:00Z';
const FRI_5PM_ET = '2030-01-11T22:00:00Z';

async function toPage(page, i) {
  // jump straight to a page (bypasses validation) — test-only
  await page.evaluate(n => { document.querySelector('.bspf')._x_dataStack[0].page = n; }, i);
  await page.waitForTimeout(150);
}

async function testBusinessPrompt(browser) {
  console.log('business-day prompt + lock:');
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.clock.setFixedTime(new Date(FRI_5PM_ET));
  await page.goto(BASE);
  await page.waitForTimeout(1000);
  await toPage(page, 1);
  const dlg = page.locator('.bspf-dialog');
  const sw = page.locator('[data-bspf-field="urgency"] input[type="checkbox"]');
  const date = page.locator('[data-bspf-field="neededBy"] input');

  await date.fill('0202-01-14'); // a mid-typing year: past, must not prompt
  await page.waitForTimeout(200);
  check('past/partial date → no prompt', !(await dlg.isVisible()));

  await date.fill('2030-01-14'); // Mon 5pm = 8 working hours after Fri 5pm: within
  await page.waitForTimeout(250);
  check('within one business day → prompt opens', await dlg.isVisible());
  await page.waitForTimeout(100);
  check('prompt focuses OK', await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim() === 'OK'));
  await page.click('.bspf-dialog__alt');
  await page.waitForTimeout(200);
  check('"Change" moves the date 2 business days out (Tue)', (await date.inputValue()) === '2030-01-15', await date.inputValue());
  check('…and leaves urgency off and unlocked', !(await sw.isChecked()) && !(await sw.isDisabled()));

  await date.fill('2030-01-14');
  await page.waitForTimeout(250);
  check('prompt reopens for a new within-window date', await dlg.isVisible());
  await page.keyboard.press('Escape'); // Escape = OK (keep the date)
  await page.waitForTimeout(200);
  check('OK keeps the date', (await date.inputValue()) === '2030-01-14');
  check('OK sets urgency on and locks it', (await sw.isChecked()) && (await sw.isDisabled()));
  check('switch reads "Urgent", lock note shows',
    (await page.locator('[data-bspf-field="urgency"] .switch').textContent()).trim() === 'Urgent' &&
    await page.locator('[data-bspf-field="urgency"] .bspf-field__lock').isVisible());

  await date.fill('2030-01-21');
  await page.waitForTimeout(250);
  const st = { checked: await sw.isChecked(), disabled: await sw.isDisabled(), dlg: await dlg.isVisible(), date: await date.inputValue() };
  check('a later date unlocks (value stays Urgent)', st.checked && !st.disabled && !st.dlg, JSON.stringify(st));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

/* Classic-link form: the real forms/classic-url-request.json swapped in for
   the harness config, with the converter pointed at a stubbed host and a
   1-second countdown. */
const CONVERTER = 'https://converter.test/convert';
async function openClassic(browser, params, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  if (opts.clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.route('**/example-it-request.json', async route => {
    const cfg = await (await route.fetch({ url: new URL('../forms/classic-url-request.json', BASE).href })).json();
    cfg.form.vars = { converterUrl: CONVERTER, redirectSeconds: 1 };
    await route.fulfill({ json: cfg });
  });
  await page.route('https://converter.test/**', r => r.fulfill({ contentType: 'text/html', body: '<title>converter</title>converter' }));
  await page.addInitScript(o => {
    window.BSPF_MOCK_LOOKUP = { 'Policy Library & Forms': { Url: 'https://example.com/policy-new' } };
    if (o.failSave) window.BSPF_MOCK_FAIL = { addItem: true };
    if (o.blockCopy) {
      // the first copy attempt is refused (as when the click's permission has lapsed)
      let n = 0;
      const real = navigator.clipboard && navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = t => (n++ === 0 ? Promise.reject(new Error('blocked')) : real(t));
      const exec = document.execCommand.bind(document);
      document.execCommand = c => (c === 'copy' && n <= 1 ? false : exec(c));
    }
  }, opts);
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  await page.goto(BASE + (qs ? '?' + qs : ''));
  await page.waitForTimeout(900);
  return { ctx, page };
}
async function classicSubmit(page) {
  await page.fill('[data-bspf-field="sourceDescription"] textarea', 'It was on the Policy hub page, left nav.');
  await navClick(page, 'Get new link');
  await page.waitForSelector('.bspf-result', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
}

async function testClassic(browser) {
  console.log('classic-link form:');
  const OLD = 'https://old.example/sites/x/Pages/Policy Library.aspx?a=1&b=2';

  // found: decoded read-only name, save payload, new link
  let { ctx, page } = await openClassic(browser, { Link: OLD, ResourceName: 'Policy Library & Forms' });
  check('ResourceName shown decoded, read-only', (await page.locator('.bspf-readonly__value').textContent()) === 'Policy Library & Forms' &&
    (await page.locator('[data-bspf-field="resourceName"] input').count()) === 0);
  check('Link not shown', (await page.locator('[data-bspf-field="link"]').count()) === 0);
  check('submit button says "Get new link"', await page.locator('button[type="submit"]:has-text("Get new link")').isVisible());
  await classicSubmit(page);
  let writes = await page.evaluate(() => window.__BSPF_MOCK_WRITES__);
  const add = writes.find(w => w.op === 'addItem');
  check('saved Link / ResourceName / SourceDescription', add && add.payload.Link === OLD && add.payload.ResourceName === 'Policy Library & Forms' &&
    /Policy hub/.test(add.payload.SourceDescription), add && JSON.stringify(add.payload));
  check('lookup by ResourceName', writes.some(w => w.op === 'lookup' && w.matchColumn === 'ResourceName' && w.value === 'Policy Library & Forms'));
  const link = page.locator('.bspf-result__link');
  check('found → resource name linked to the new URL', (await link.getAttribute('href')) === 'https://example.com/policy-new' &&
    (await link.textContent()).trim() === 'Policy Library & Forms');
  check('found → message, no countdown', /Access your resource using this new link/.test(await page.locator('.bspf-result').textContent()) &&
    !(await page.locator('.bspf-result__count').isVisible()));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // not found: original link copied, countdown, redirect
  ({ ctx, page } = await openClassic(browser, { Link: OLD, ResourceName: 'Something Unknown' }, { clipboard: true }));
  await classicSubmit(page);
  check('not found → copy + converter message', /copied to your clipboard/.test(await page.locator('.bspf-result').textContent()));
  check('original link is on the clipboard', (await page.evaluate(() => navigator.clipboard.readText())) === OLD);
  check('countdown shows', await page.locator('.bspf-result__count').isVisible());
  await page.waitForURL(CONVERTER, { timeout: 4000 }).catch(() => {});
  check('redirects to the converter', page.url() === CONVERTER, page.url());
  await ctx.close();

  // copy blocked: countdown pauses until the user copies by hand
  ({ ctx, page } = await openClassic(browser, { Link: OLD, ResourceName: 'Something Unknown' }, { clipboard: true, blockCopy: true }));
  await classicSubmit(page);
  check('blocked copy → manual copy box, countdown paused', await page.locator('.bspf-result__copy').isVisible() &&
    /Copy the link first/.test(await page.locator('.bspf-result__count').textContent()));
  await page.waitForTimeout(1600);
  check('…and no redirect while paused', page.url() !== CONVERTER);
  await page.click('.bspf-result__copy button');
  await page.waitForURL(CONVERTER, { timeout: 4000 }).catch(() => {});
  check('Copy link → copied, then redirects', page.url() === CONVERTER, page.url());
  await ctx.close();

  // save fails silently; no ResourceName skips the lookup
  ({ ctx, page } = await openClassic(browser, { Link: OLD, ResourceName: 'Policy Library & Forms' }, { failSave: true }));
  await classicSubmit(page);
  check('failed save → still shows the new link', (await page.locator('.bspf-result__link').getAttribute('href')) === 'https://example.com/policy-new');
  await ctx.close();
  ({ ctx, page } = await openClassic(browser, { Link: OLD }));
  check('no ResourceName → name row hidden', !(await page.locator('[data-bspf-field="resourceName"]').isVisible()));
  await classicSubmit(page);
  writes = await page.evaluate(() => window.__BSPF_MOCK_WRITES__);
  check('no ResourceName → no lookup, converter path', !writes.some(w => w.op === 'lookup') &&
    /copied to your clipboard/.test(await page.locator('.bspf-result').textContent()));
  await ctx.close();

  // bad or missing Link → straight to the converter, no form
  for (const [name, params] of [
    ['missing Link', { ResourceName: 'Policy Library & Forms' }],
    ['javascript: Link', { Link: 'javascript:alert(1)' }],
    ['Link over 255 chars', { Link: 'https://old.example/' + 'x'.repeat(250) }]
  ]) {
    ({ ctx, page } = await openClassic(browser, params));
    const shown = await page.locator('.bspf-result').isVisible() && !(await page.locator('form.bspf__body').isVisible());
    const text = await page.locator('.bspf-result').textContent();
    check(name + ' → converter screen, no form, no copy talk', shown && !/clipboard/.test(text) && /paste the original link/.test(text));
    await page.waitForURL(CONVERTER, { timeout: 4000 }).catch(() => {});
    check(name + ' → redirects', page.url() === CONVERTER, page.url());
    await ctx.close();
  }
}

/* The Digital & Creative config: launch date+time, the 48-business-hour
   callout, no popup/lock, Translation as a checkbox. The browser runs in
   PACIFIC time to prove picks are converted to Eastern before counting. */
async function testCreativeCallout(browser) {
  console.log('creative form (48h callout, viewer in Pacific time):');
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 }, timezoneId: 'America/Los_Angeles' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date(FRI_5PM_ET));
  await page.route('**/example-it-request.json', async route => {
    await route.fulfill({ json: await (await route.fetch({ url: new URL('../forms/gsi-digital-creative-intake.json', BASE).href })).json() });
  });
  await page.goto(BASE);
  await page.waitForTimeout(1000);
  const date = page.locator('[data-bspf-field="launchDate"] input');
  const note = page.locator('.msgbar:has-text("under 48 business hours")');
  check('launch date is one date+time control', (await date.getAttribute('type')) === 'datetime-local');
  // Fri 5pm ET -> Tue 5pm ET = 16 working hours (inclusive): 2pm Pacific
  await date.fill('2030-01-15T14:00');
  await page.waitForTimeout(200);
  check('Tue 2pm PT (= 5pm ET, 48h) → callout', await note.isVisible());
  await date.fill('2030-01-16T06:00'); // Wed 9:00 ET: still 16h — the 9am boundary counts
  await page.waitForTimeout(200);
  check('Wed 6:00 PT (= 9:00 ET) → callout (boundary inclusive)', await note.isVisible());
  await date.fill('2030-01-16T06:01'); // Wed 9:01 ET: 16h01m
  await page.waitForTimeout(200);
  check('Wed 6:01 PT (= 9:01 ET) → no callout', !(await note.isVisible()));
  await date.fill('2030-01-14T10:00');
  await page.waitForTimeout(300);
  const sw = page.locator('[data-bspf-field="priority"] input');
  check('no popup, Priority untouched and unlocked', (await page.locator('.bspf-dialog').count()) === 0 &&
    !(await sw.isChecked()) && !(await sw.isDisabled()));
  check('Translation is a checkbox', (await page.locator('[data-bspf-field="translation"] label.check input[type="checkbox"]').count()) === 1);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* Zone attestation: assignments rows from the mock source list, per-row
   save, submit confirmation, header card, current user, EN/FR. */
const ZONE = '?form=ps-zone-attestation';
const JOB_AID = 'https://example.com/job-aid';
async function openZone(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 } });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.route('**/ps-zone-attestation.json', async route => {
    const cfg = await (await route.fetch()).json();
    if (opts.jobAid !== undefined) cfg.form.vars.jobAidUrl = opts.jobAid;
    if (opts.mutate) opts.mutate(cfg);
    await route.fulfill({ json: cfg });
  });
  await page.addInitScript(o => {
    if (o.fail) window.BSPF_MOCK_FAIL = o.fail;
    if (o.done) window.BSPF_MOCK_DONE = o.done;
    if (o.rows) window.BSPF_MOCK_ASSIGNMENTS = o.rows;
    if (o.addMs != null) window.BSPF_MOCK_ADD_MS = o.addMs;
    if (o.keysCap != null) window.BSPF_MOCK_KEYS_CAP = o.keysCap;
  }, { fail: opts.fail || null, done: opts.done || null, rows: opts.rows || null, addMs: opts.addMs == null ? null : opts.addMs,
    keysCap: opts.keysCap == null ? null : opts.keysCap });
  await page.goto(BASE + ZONE + (opts.query || ''));
  await page.waitForTimeout(1200);
  return { ctx, page };
}
async function zonePick(page, row, label) {
  await page.evaluate(async ({ row, label }) => {
    const r = document.querySelectorAll('.bspf-asg__row')[row];
    r.querySelector('[role="combobox"]').click();
    await new Promise(x => setTimeout(x, 60));
    [...r.querySelectorAll('.bspf-combo__option')].find(b => b.innerText.trim() === label).click();
  }, { row, label });
  await page.waitForTimeout(80);
}
const zoneAdds = page => page.evaluate(() => window.__BSPF_MOCK_WRITES__.filter(w => w.op === 'addItem').map(w => w.payload));

async function testZoneAttestation(browser) {
  console.log('zone attestation (assignments):');
  let { ctx, page } = await openZone(browser, { jobAid: JOB_AID, query: '&validate' });

  // load: the user's rows only (case-insensitive email), sorted by area
  const labels = await page.$$eval('.bspf-asg__label', els => els.map(e => e.textContent));
  check('3 rows, the other user\'s row filtered out, sorted',
    JSON.stringify(labels) === JSON.stringify(['Floor 1 — Lobby & vault', 'Floor 3 — East wing', 'Parking level P2']), JSON.stringify(labels));
  check('current user card shows name + email',
    (await page.locator('.bspf-who__name').textContent()) === 'Dev Tester' &&
    (await page.locator('.bspf-who__mail').textContent()) === 'dev.tester@example.com');
  const card = page.locator('a.bspf-tipcard');
  check('job aid card opens the configured URL in a new tab',
    (await card.getAttribute('href')) === JOB_AID && (await card.getAttribute('target')) === '_blank' &&
    /noopener/.test(await card.getAttribute('rel')));
  await page.waitForFunction(() => document.querySelector('.bspf-doctor tbody tr'), null, { timeout: 5000 });
  const doctor = await page.$$eval('.bspf-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  check('doctor: every target + source column OK', doctor.length >= 12 && doctor.every(r => r[4] === 'OK'),
    doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; '));

  // empty submit: every row + the checkbox flagged, no dialog, nothing saved
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(200);
  check('empty submit → an error on every row', (await page.locator('.bspf-asg__row.is-error').count()) === 3);
  check('empty submit → checkbox error', await page.locator('[data-bspf-field="attestation"] .field__error').isVisible());
  check('empty submit → no dialog, nothing saved', !(await page.locator('.bspf-dialog').isVisible()) && (await zoneAdds(page)).length === 0);

  // pick, clear, re-pick; the progress meter follows
  await zonePick(page, 0, 'Yellow');
  check('a pick clears that row\'s error', (await page.locator('.bspf-asg__row.is-error').count()) === 2);
  await page.locator('.bspf-asg__row').nth(0).locator('.bspf-combo__clear').click();
  await page.waitForTimeout(80);
  check('the × clears the selection', (await page.locator('.bspf-asg__row').nth(0).locator('.bspf-combo__placeholder').isVisible()));
  await zonePick(page, 0, 'Orange');
  await page.evaluate(async () => {
    const r = document.querySelectorAll('.bspf-asg__row')[0];
    r.querySelector('[role="combobox"]').click();
    await new Promise(x => setTimeout(x, 60));
    r.querySelector('.bspf-combo__option--clear').click();
  });
  await page.waitForTimeout(80);
  check('the menu\'s "Clear selection" clears it too',
    await page.evaluate(() => { const d = Object.values(BSPForms._defs).pop(); return d.store.state.values.zones[0].value === ''; }));
  await zonePick(page, 0, 'Orange');
  await zonePick(page, 1, 'Green');
  await zonePick(page, 2, 'Red');
  check('progress reads 3 of 3', /3 of 3/.test(await page.locator('.bspf-asg__progress').textContent()));
  await page.locator('[data-bspf-field="attestation"] input').check();

  // confirmation: Escape goes back; Confirm saves one item per row
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(250);
  check('submit → confirmation dialog with the warning text',
    await page.locator('.bspf-dialog').isVisible() && /will not be able to return and change them/.test(await page.locator('.bspf-dialog').textContent()));
  check('focus starts on "Go back"', (await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim())) === 'Go back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape → dialog closed, nothing saved', !(await page.locator('.bspf-dialog').isVisible()) && (await zoneAdds(page)).length === 0);
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(250);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 5000 });
  const adds = await zoneAdds(page);
  const byId = Object.fromEntries(adds.map(p => [p.LookupID, p]));
  check('one item per row', adds.length === 3, adds.length);
  check('row columns copied (LookupID / AreaName / UserDescription)',
    byId[12] && byId[12].AreaName === 'Floor 1 — Lobby & vault' && byId[12].UserDescription === 'Branch manager' && typeof byId[12].LookupID === 'number');
  check('each row saves its own zone', byId[12].ZoneSelection === 'Orange' && byId[11].ZoneSelection === 'Green' && byId[13].ZoneSelection === 'Red');
  check('UserName / UserEmail / Attestation set on every row',
    adds.every(p => p.UserName === 'Dev Tester' && p.UserEmail === 'dev.tester@example.com' && p.Attestation === 'Confirmed'));
  check('AttestationTime: one ISO instant shared by the rows',
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(adds[0].AttestationTime) && adds.every(p => p.AttestationTime === adds[0].AttestationTime));
  check('Title per row from {row:AreaName}', byId[13].Title === 'Parking level P2 — dev.tester@example.com', byId[13].Title);
  check('no "submit another" button', (await page.locator('.bspf-done button').count()) === 0);
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // the job aid card stays hidden while its URL is empty or unsafe
  ({ ctx, page } = await openZone(browser, { jobAid: '' }));
  check('no job aid URL → no card', (await page.locator('.bspf-tipcard').count()) === 0);
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { jobAid: 'javascript:alert(1)' }));
  check('javascript: job aid URL → no card', (await page.locator('.bspf-tipcard').count()) === 0);
  await ctx.close();

  // a failure mid-save: saved rows are kept and never saved twice
  ({ ctx, page } = await openZone(browser, { fail: { addItemAfter: 1 } }));
  await zonePick(page, 0, 'Green'); await zonePick(page, 1, 'Green'); await zonePick(page, 2, 'Yellow');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf__pageerror', { state: 'visible', timeout: 5000 });
  check('partial save → "1 of 3 areas are confirmed saved" message', /1 of 3 areas are confirmed saved/.test(await page.locator('.bspf__pageerror').textContent()));
  check('the saved row is locked', (await page.locator('.bspf-asg__row.is-saved').count()) === 1 &&
    (await page.locator('.bspf-asg__row.is-saved .bspf-combo__clear').isHidden()));
  await page.evaluate(() => { window.BSPF_MOCK_FAIL = {}; });
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 5000 });
  const ids = (await zoneAdds(page)).map(p => p.LookupID).sort();
  check('retry saves only the rest — 3 items, no duplicates', JSON.stringify(ids) === '[11,12,13]', JSON.stringify(ids));
  await ctx.close();

  // rows already answered (responses list) aren't shown again
  ({ ctx, page } = await openZone(browser, { done: ['12'] }));
  check('one row already submitted → 2 rows + a note', (await page.locator('.bspf-asg__row').count()) === 2 &&
    /1 of your areas were already attested/.test(await page.locator('[data-bspf-field="zones"]').textContent()));
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['11', '12', '13'] }));
  check('everything submitted → "already submitted" screen, no form',
    await page.locator('.bspf-done--allDone').isVisible() && !(await page.locator('form.bspf__body').isVisible()));
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { rows: [] }));
  check('nothing assigned → "No areas assigned" screen', await page.locator('.bspf-done--empty:has-text("No areas assigned")').isVisible());
  await ctx.close();

  // load failure: a message + Try again, and submit is blocked meanwhile
  ({ ctx, page } = await openZone(browser, { fail: { getAssignments: true } }));
  check('load failure → message + Try again', await page.locator('[data-bspf-field="zones"] .msgbar--danger:has-text("couldn\'t be loaded")').isVisible());
  await page.evaluate(() => { window.BSPF_MOCK_FAIL = {}; });
  await page.locator('[data-bspf-field="zones"] .msgbar button').click();
  await page.waitForTimeout(800);
  check('Try again → rows load', (await page.locator('.bspf-asg__row').count()) === 3);
  await ctx.close();

  // French: config pairs + engine strings; switching keeps answers; values stay English
  ({ ctx, page } = await openZone(browser, { query: '&lang=fr' }));
  check('?lang=fr → French title, labels, button',
    (await page.locator('.bspf__title').textContent()) === 'Attestation des zones de sécurité physique' &&
    /ÉTAGE\/ZONE|Étage\/zone/i.test(await page.locator('.bspf-asg__head').textContent()) &&
    await page.locator('button[type="submit"]:has-text("Soumettre l\'attestation")').isVisible());
  check('form root lang="fr" (lang-keep)', (await page.getAttribute('.bspf', 'lang')) === 'fr' &&
    (await page.getAttribute('.bspf', 'class')).includes('lang-keep'));
  await zonePick(page, 0, 'Vert');
  await page.evaluate(() => window.intl.setLang('en'));
  await page.waitForTimeout(500);
  check('switch to EN keeps the pick (Vert → Green)', (await page.locator('.bspf-asg__row').nth(0).locator('.bspf-zone:visible').textContent()).trim() === 'Green' &&
    (await page.locator('.bspf__title').textContent()) === 'Physical Security Zones Attestation');
  await page.evaluate(() => window.intl.setLang('fr'));
  await page.waitForTimeout(500);
  await zonePick(page, 1, 'Jaune'); await zonePick(page, 2, 'Rouge');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Soumettre'); await page.waitForTimeout(200);
  check('French confirmation dialog', /Une fois soumises/.test(await page.locator('.bspf-dialog').textContent()));
  await navClick(page, 'Confirmer');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 5000 });
  const frZones = (await zoneAdds(page)).map(p => p.ZoneSelection).sort();
  check('French submit saves English zone values', JSON.stringify(frZones) === '["Green","Red","Yellow"]', JSON.stringify(frZones));
  check('no page errors (French)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // answers are frozen once confirmed: a slow save, edits attempted mid-save
  ({ ctx, page } = await openZone(browser, { addMs: 900 }));
  await zonePick(page, 0, 'Orange'); await zonePick(page, 1, 'Green'); await zonePick(page, 2, 'Red');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForTimeout(250); // row 1 is saving
  const mid = await page.evaluate(() => {
    const st = Object.values(BSPForms._defs).pop().store.state;
    const r3 = document.querySelectorAll('.bspf-asg__row')[2];
    const clear = r3.querySelector('.bspf-combo__clear');
    if (clear) clear.click();                       // UI path: guarded
    st.rowPick('zones', st.values.zones[2], '');    // method path: guarded
    const cb = document.querySelector('[data-bspf-field="attestation"] input');
    const cbDisabled = cb.matches(':disabled'); cb.click(); // disabled via the fieldset: ignores the click
    const busy = st.busy;
    st.values.zones[1].value = '';                  // bypass every guard: the snapshot must win
    st.values.attestation = false;
    return { busy, cbDisabled, fieldset: document.querySelector('fieldset.bspf__lock').disabled, r3: st.values.zones[2].value };
  });
  check('mid-save: busy, fieldset + checkbox disabled', mid.busy && mid.fieldset && mid.cbDisabled, JSON.stringify(mid));
  check('mid-save: clearing a row is refused', mid.r3 === 'Red', mid.r3);
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 8000 });
  let saved = await zoneAdds(page);
  const zb = Object.fromEntries(saved.map(p => [p.LookupID, p]));
  check('saved what was confirmed, not what changed mid-save',
    saved.length === 3 && zb[12].ZoneSelection === 'Orange' && zb[11].ZoneSelection === 'Green' && zb[13].ZoneSelection === 'Red' &&
    saved.every(p => p.Attestation === 'Confirmed'), JSON.stringify(saved.map(p => [p.LookupID, p.ZoneSelection, p.Attestation])));
  await ctx.close();

  // an add that LANDS but whose reply is lost: the retry checks the list first
  ({ ctx, page } = await openZone(browser, { fail: { addItemLostAfter: 1 } }));
  await zonePick(page, 0, 'Green'); await zonePick(page, 1, 'Yellow'); await zonePick(page, 2, 'Red');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf__pageerror', { state: 'visible', timeout: 5000 });
  check('lost reply → "1 of 3 areas are confirmed saved" (the rest only "may not be")',
    /1 of 3 areas are confirmed saved; the rest may not be/.test(await page.locator('.bspf__pageerror').textContent()));
  await page.evaluate(() => { window.BSPF_MOCK_FAIL = {}; });
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 5000 });
  const lostWrites = await page.evaluate(() => window.__BSPF_MOCK_WRITES__);
  const lostIds = lostWrites.filter(w => w.op === 'addItem').map(w => w.payload.LookupID).sort();
  check('retry asked the list about exactly the unsaved rows first',
    JSON.stringify((lostWrites.find(w => w.op === 'getRowKeysFor') || {}).values) === '[11,13]',
    JSON.stringify(lostWrites.filter(w => w.op === 'getRowKeysFor')));
  check('the landed-but-lost row is not saved again — 3 items, no duplicates', JSON.stringify(lostIds) === '[11,12,13]', JSON.stringify(lostIds));
  await ctx.close();
  // the same, with the earlier-responses read capped at 0: the retry's exact
  // check must still find the landed row (the cap doesn't apply to it)
  ({ ctx, page } = await openZone(browser, { fail: { addItemLostAfter: 1 }, keysCap: 0 }));
  await zonePick(page, 0, 'Green'); await zonePick(page, 1, 'Yellow'); await zonePick(page, 2, 'Red');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf__pageerror', { state: 'visible', timeout: 5000 });
  await page.evaluate(() => { window.BSPF_MOCK_FAIL = {}; });
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 5000 });
  const capIds = (await zoneAdds(page)).map(p => p.LookupID).sort();
  check('capped earlier-responses read: retry still saves no duplicate', JSON.stringify(capIds) === '[11,12,13]', JSON.stringify(capIds));
  await ctx.close();
  // lost on the very first add: no "nothing was saved" promise
  ({ ctx, page } = await openZone(browser, { fail: { addItemLostAfter: 0 } }));
  await zonePick(page, 0, 'Green'); await zonePick(page, 1, 'Green'); await zonePick(page, 2, 'Green');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf__pageerror', { state: 'visible', timeout: 5000 });
  const firstLost = await page.locator('.bspf__pageerror').textContent();
  check('first add lost → "Not every area could be saved", never "nothing was saved"',
    /Not every area could be saved/.test(firstLost) && !/nothing was saved/.test(firstLost), firstLost);
  await ctx.close();

  // hostile text in list data and in a choice: shown literally, saved exactly, never run
  const EVIL_AREA = '<img src=x onerror="window.__xss=1">Lobby & "vault"';
  const EVIL_ZONE = 'O"Brien\'s <b>zone</b> {{x}}';
  ({ ctx, page } = await openZone(browser, {
    rows: [{ ID: 21, UserEmail: 'dev.tester@example.com', UserDescription: '<script>window.__xss=2</script>', AreaName: EVIL_AREA }],
    mutate: cfg => { cfg.pages[0].sections[1].fields[0].choices.push({ value: EVIL_ZONE, label: EVIL_ZONE, color: 'blue' }); }
  }));
  check('hostile area name shown as text', (await page.locator('.bspf-asg__label').textContent()) === EVIL_AREA);
  await zonePick(page, 0, EVIL_ZONE);
  check('hostile choice shown as text in the control', (await page.locator('.bspf-asg__row .bspf-zone:visible').textContent()).trim() === EVIL_ZONE);
  await page.locator('[data-bspf-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 5000 });
  saved = await zoneAdds(page);
  check('hostile values saved exactly', saved.length === 1 && saved[0].ZoneSelection === EVIL_ZONE && saved[0].AreaName === EVIL_AREA &&
    saved[0].UserDescription === '<script>window.__xss=2</script>');
  check('no script ran, no page errors', (await page.evaluate(() => window.__xss)) === undefined && page.__errors.length === 0,
    page.__errors.join(' | '));
  await ctx.close();

  // cut-off reads are said out loud
  ({ ctx, page } = await openZone(browser, { mutate: cfg => { cfg.pages[0].sections[1].fields[0].source.top = 2; } }));
  check('more rows than source.top → 2 rows + "Only the first 2" warning',
    (await page.locator('.bspf-asg__row').count()) === 2 && await page.locator('.bspf-asg__warn:has-text("Only the first 2")').isVisible());
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['12', '11'], mutate: cfg => { cfg.pages[0].sections[1].fields[0].source.top = 2; } }));
  check('first page all done but more exist → a warning, not "already submitted"',
    !(await page.locator('.bspf-done--allDone').isVisible()) &&
    await page.locator('[data-bspf-field="zones"] .msgbar--danger:has-text("Only the first 2")').isVisible());
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['12'], keysCap: 0 }));
  check('earlier-responses read cut off → warning; unconfirmed rows still shown',
    (await page.locator('.bspf-asg__row').count()) === 3 && await page.locator('.bspf-asg__warn:has-text("More than 5000 earlier responses")').isVisible());
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['11', '12', '13', '99'], keysCap: 3 }));
  check('every row done but the responses read was cut off → a warning, not "already submitted"',
    !(await page.locator('.bspf-done--allDone').isVisible()) &&
    await page.locator('[data-bspf-field="zones"] .msgbar--danger:has-text("More than 5000 earlier responses")').isVisible());
  await ctx.close();

  // the file set is frozen during a save (reference form: attachments)
  {
    const p2 = await browser.newPage();
    await p2.goto(BASE);
    await p2.waitForTimeout(1000);
    const frozen = await p2.evaluate(() => {
      const st = Object.values(BSPForms._defs).pop().store.state;
      const f = new File(['x'], 'late.pdf', { type: 'application/pdf' });
      st.addFiles([f]);
      const before = st.filesMeta.length;
      st.busy = true;
      st.addFiles([new File(['y'], 'during.pdf')]);
      st.dropFiles({ dataTransfer: { files: [new File(['z'], 'dropped.pdf')] } });
      st.removeFile(0);
      const during = st.filesMeta.map(m => m.name);
      st.busy = false;
      return { before, during };
    });
    check('while saving, files cannot be added, dropped or removed',
      frozen.before === 1 && JSON.stringify(frozen.during) === '["late.pdf"]', JSON.stringify(frozen));
    await p2.close();
  }

  // config errors
  for (const [name, mutate] of [
    ['assignments without source.userColumn → error card', cfg => { delete cfg.pages[0].sections[1].fields[0].source.userColumn; }],
    ['responses.keyColumn not in rowColumns → error card', cfg => { cfg.pages[0].sections[1].fields[0].responses.keyColumn = 'Nope'; }],
    ['two assignments fields → error card', cfg => {
      const f = JSON.parse(JSON.stringify(cfg.pages[0].sections[1].fields[0])); f.id = 'zones2';
      cfg.pages[0].sections[1].fields.push(f);
    }],
    ['form.languages ["de"] → error card', cfg => { cfg.form.languages = ['de']; }]
  ]) {
    ({ ctx, page } = await openZone(browser, { mutate }));
    const state = await page.getAttribute('[data-bsp-form]', 'data-bspf-state');
    check(name, state === 'error' && await page.locator('[data-bspf-fatal]').isVisible(), 'state=' + state);
    await ctx.close();
  }
}

async function testFullFlow(browser) {
  console.log('full submit flow:');
  const page = await browser.newPage({ viewport: { width: 1100, height: 2600 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  // Tue 10:00 ET: tomorrow (Wed 5pm) is 15 working hours out — no prompt
  await page.clock.setFixedTime(new Date(TUE_10AM_ET));
  // ?Team= is normalized: letters/digits only, lower case, 40 chars max
  const TEAM_RAW = 'FCU Comms/Sec Awareness #2 — Ops & Risk Management Division, Extra';
  const TEAM_NORM = TEAM_RAW.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 40);
  await page.goto(BASE + '?team=' + encodeURIComponent(TEAM_RAW)); // name matched case-insensitively
  await page.waitForTimeout(1200);
  check('mount ready', (await page.getAttribute('[data-bsp-form]', 'data-bspf-state')) === 'ready');

  // page 1 — reject empty, then fill
  await navClick(page, 'Next');
  await page.waitForTimeout(250);
  check('empty page rejected', await page.locator('.bspf__pageerror').isVisible());
  await page.click('.bspf-people__input');
  await page.fill('.bspf-people__input', 'sof');
  await page.waitForTimeout(800);
  await page.locator('.bspf-people__option').first().click();
  await page.fill('[data-bspf-field="contactEmail"] input', 'dev.tester@example.com');
  await page.fill('[data-bspf-field="costCentre"] input', '12345');
  await navClick(page, 'Next');
  await page.waitForTimeout(300);

  // page 2 — conditional variants: pick System access first (fills the
  // multichoice that shares SubCategory's sibling column), then flip to
  // Hardware so accessSystems is hidden at submit
  await page.click('[data-bspf-field="category"] .bspf-combo__control');
  await page.click('[data-bspf-field="category"] .bspf-combo__option:has-text("System access")');
  await page.waitForTimeout(150);
  check('conditional field shows', await page.locator('[data-bspf-field="accessSystems"]').isVisible());
  await page.click('[data-bspf-field="accessSystems"] .bspf-combo__control');
  await page.click('[data-bspf-field="accessSystems"] .bspf-combo__option:has-text("FCU Portal")');
  await page.keyboard.press('Escape');
  await page.click('[data-bspf-field="category"] .bspf-combo__control');
  await page.click('[data-bspf-field="category"] .bspf-combo__option:has-text("Hardware")');
  await page.waitForTimeout(150);
  check('conditional field hides on flip', !(await page.locator('[data-bspf-field="accessSystems"]').isVisible()));
  await page.click('[data-bspf-field="hardwareType"] .bspf-combo__control');
  await page.click('[data-bspf-field="hardwareType"] .bspf-combo__option:has-text("Monitor")');
  await page.fill('[data-bspf-field="priorityJustification"] textarea',
    'Current laptop is out of warranty & failing;\nneeded for <daily> development work.');

  // date rules: warn (rush) then cross-field block, then fix
  const plus = d => { const t = new Date(TUE_10AM_ET); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  await page.fill('[data-bspf-field="neededBy"] input', plus(1));
  await page.waitForTimeout(250);
  check('date warn (rush) shows', await page.locator('[data-bspf-field="neededBy"] .bspf-field__warning').isVisible());
  check('conditional note shows', await page.locator('.msgbar--warning:has-text("Rush requests")').isVisible());
  await page.click('[data-bspf-field="isRecurring"] .switch');
  await page.fill('[data-bspf-field="recurrenceEnd"] input', plus(-3));
  await navClick(page, 'Next');
  await page.waitForTimeout(250);
  check('cross-field date block', await page.locator('[data-bspf-field="recurrenceEnd"] .field__error').isVisible());
  await page.fill('[data-bspf-field="recurrenceEnd"] input', plus(30));
  await navClick(page, 'Next');
  await page.waitForTimeout(300);
  check('reached last page', await page.locator('.bspf-page__title:visible').first().textContent()
    .then(t => t.trim() === 'Review & submit', () => false));

  // attachments: bad type rejected; retry pipeline via forced failure
  await page.setInputFiles('input[type="file"]', [
    { name: 'quote.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x'.repeat(500)) },
    { name: 'blocked.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') }
  ]);
  await page.waitForTimeout(250);
  check('bad file type rejected', await page.locator('.bspf-attach .field__error').isVisible());
  check('accepted file listed', (await page.locator('.bspf-page:visible .bspf-attach__item').count()) === 1);

  await page.check('[data-bspf-field="managerAware"] label.check input');
  await page.evaluate(() => { window.BSPF_MOCK_FAIL = { addAttachment: true }; });
  await navClick(page, 'Submit request');
  await page.waitForTimeout(1800);
  check('attachment failure → retry view',
    await page.locator('.msgbar--warning:has-text("attachments incomplete")').isVisible());
  await page.evaluate(() => { window.BSPF_MOCK_FAIL = {}; });
  await navClick(page, 'Retry failed uploads');
  await page.waitForTimeout(1200);
  check('retry completes → confirmation', await page.locator('.bspf-done').isVisible());

  // payload invariants
  const writes = await page.evaluate(() => window.__BSPF_MOCK_WRITES__);
  const adds = writes.filter(w => w.op === 'addItem');
  const p = adds.length && adds[0].payload || {};
  check('item created exactly once (retry never duplicates)', adds.length === 1, 'adds=' + adds.length);
  check('visible variant wrote shared column', p.SubCategory === 'Monitor', JSON.stringify(p.SubCategory));
  check('hidden field excluded from payload', !('AccessSystems' in p));
  check('person resolved to id', p.RequestForId === 1000, JSON.stringify(p.RequestForId));
  check('richText textarea → escaped HTML with <br>',
    p.Justification === '<div>Current laptop is out of warranty &amp; failing;<br>needed for &lt;daily&gt; development work.</div>',
    JSON.stringify(p.Justification));
  check('word switch writes its "off" value', p.Urgency === 'Standard', JSON.stringify(p.Urgency));
  check('?Team → hidden field, normalized', p.SourceTeam === TEAM_NORM && p.SourceTeam.length === 40, JSON.stringify(p.SourceTeam));
  check('hidden field not rendered', (await page.locator('[data-bspf-field="sourceTeam"]').count()) === 0);
  check('title template rendered', typeof p.Title === 'string' && p.Title.indexOf('Dev Tester') > -1);
  check('attachment uploaded after retry', writes.some(w => w.op === 'addAttachment' && w.name === 'quote.pdf'));
  // target.sendEmpty is opt-in: a config without it never sends explicit empties
  check('no null values in the payload (sendEmpty is opt-in)', Object.keys(p).every(k => p[k] !== null),
    Object.keys(p).filter(k => p[k] === null).join(', '));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

/* =====================================================================
   Engine 0.6.0 — branching, choicesWhen, number dropdown/slider, clear
   buttons, business-day rules, sendEmpty, @me, confirmation redirect,
   BSPForms.normalize / BSPForms.lists (docs/BUILDER-PLAN.md E1–E9a).
   ===================================================================== */
const BRANCH = '?form=example-branching';
const HOME_RE = /\/sites\/FCUPortal\/SitePages\/Home\.aspx$/;
const ME_LOGIN = 'i:0#.f|membership|dev.tester@example.com';
const SOFIA = { key: 'i:0#.f|membership|sofia.chen@example.com', text: 'Sofia Chen', email: 'sofia.chen@example.com' };
// Fri 2030-01-11 10:00 ET (January = UTC-5)
const FRI_10AM_ET = '2030-01-11T15:00:00Z';
const ST = 'document.querySelector(".bspf")._x_dataStack[0]';

/* A harness page on either fixture: clock pinned, config route-mutated,
   the confirmation redirect target stubbed, adds fast. */
async function openForm(browser, opts) {
  opts = opts || {};
  const ctxOpts = { viewport: { width: 1100, height: 1600 } };
  if (opts.tz) ctxOpts.timezoneId = opts.tz;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.clock.setFixedTime(new Date(opts.now || FRI_10AM_ET));
  const fixture = opts.it ? 'example-it-request' : 'example-branching';
  await page.route('**/' + fixture + '.json', async route => {
    const cfg = await (await route.fetch()).json();
    if (opts.mutate) opts.mutate(cfg);
    await route.fulfill({ json: cfg });
  });
  await page.route('**/sites/FCUPortal/SitePages/Home.aspx', r => r.fulfill({ contentType: 'text/html', body: '<title>home</title>home' }));
  await page.addInitScript(ms => { window.BSPF_MOCK_ADD_MS = ms; }, opts.addMs == null ? 100 : opts.addMs);
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(BASE + (opts.it ? '' : BRANCH));
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-bsp-form]');
    return m && /ready|error/.test(m.getAttribute('data-bspf-state') || '');
  }, null, { timeout: 8000 });
  await page.waitForTimeout(opts.settle == null ? 300 : opts.settle);
  return { ctx, page };
}
const state = page => page.evaluate(new Function('const s = ' + ST + '; return { page: s.page, view: s.view, active: s.activePages(), values: JSON.parse(JSON.stringify(s.values)), errors: JSON.parse(JSON.stringify(s.errors)), warnings: JSON.parse(JSON.stringify(s.warnings)) };'));
const adds = page => page.evaluate(() => window.__BSPF_MOCK_WRITES__.filter(w => w.op === 'addItem').map(w => w.payload));
// open a combo, click the visible option with this text (programmatic: no pointer flake)
async function comboPick(page, k, label) {
  await page.evaluate(async ({ k, label }) => {
    const f = document.querySelector('[data-bspf-field="' + k + '"]');
    f.querySelector('.bspf-combo__control').click();
    await new Promise(r => setTimeout(r, 80));
    const opt = [...f.querySelectorAll('.bspf-combo__option')]
      .find(b => b.offsetParent !== null && b.innerText.trim() === String(label));
    if (!opt) throw new Error('comboPick: no visible option "' + label + '" in ' + k);
    opt.click();
  }, { k, label });
  await page.waitForTimeout(120);
}
// the visible (allowed) option texts of a combo; leaves the menu closed
async function comboOptions(page, k) {
  return page.evaluate(async k => {
    const f = document.querySelector('[data-bspf-field="' + k + '"]');
    const c = f.querySelector('.bspf-combo__control');
    c.click();
    await new Promise(r => setTimeout(r, 80));
    const out = [...f.querySelectorAll('.bspf-combo__option:not(.bspf-combo__option--clear)')]
      .filter(b => b.offsetParent !== null).map(b => b.innerText.trim());
    c.click();
    await new Promise(r => setTimeout(r, 40));
    return out;
  }, k);
}
async function clickIn(page, sel) {
  const ok = await page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
  if (!ok) throw new Error('clickIn: nothing matches ' + sel);
  await page.waitForTimeout(120);
}
const isVisible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);
const setVal = (page, k, v) => page.evaluate(new Function('a', 'const s = ' + ST + '; s.values[a.k] = a.v;'), { k, v }).then(() => page.waitForTimeout(150));
const visibleSteps = page => page.evaluate(() => [...document.querySelectorAll('.bspf__stepper .stepper__step')]
  .filter(li => li.offsetParent !== null)
  .map(li => li.querySelector('.stepper__label').textContent + '#' + li.querySelector('.stepper__dot span[x-text]').textContent.trim()));
const navVisible = page => page.evaluate(() => [...document.querySelectorAll('.bspf-nav button')]
  .filter(b => b.offsetParent !== null).map(b => b.textContent.trim()));
async function submitConfirmed(page) {
  await navClick(page, 'Submit');
  await page.waitForTimeout(250);
  await navClick(page, 'Yes');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(100);
}

async function testBranching(browser) {
  console.log('branching (example-branching: page visibleWhen / endWhen):');
  let { ctx, page } = await openForm(browser);
  let s = await state(page);
  check('mount ready', (await page.getAttribute('[data-bsp-form]', 'data-bspf-state')) === 'ready');
  check('initial active pages [0,4]', JSON.stringify(s.active) === '[0,4]', JSON.stringify(s.active));
  let steps = await visibleSteps(page);
  check('stepper: 2 steps numbered 1, 2', JSON.stringify(steps) === JSON.stringify(['About the request#1', 'Anything else#2']), JSON.stringify(steps));

  await comboPick(page, 'requestType', 'Equipment');
  s = await state(page);
  steps = await visibleSteps(page);
  check('Equipment → Equipment page added [0,1,4]', JSON.stringify(s.active) === '[0,1,4]', JSON.stringify(s.active));
  check('stepper renumbers: 3 steps 1, 2, 3', JSON.stringify(steps) === JSON.stringify(['About the request#1', 'Equipment#2', 'Anything else#3']), JSON.stringify(steps));
  await navClick(page, 'Next');
  await page.waitForTimeout(150);
  check('Next: 0 → 1 (Equipment)', (await state(page)).page === 1);
  await comboPick(page, 'item', 'Monitor');
  await navClick(page, 'Next');
  await page.waitForTimeout(150);
  check('Next: 1 → 4 (Room booking and Deadline skipped)', (await state(page)).page === 4);
  await navClick(page, 'Back');
  await page.waitForTimeout(150);
  check('Back: 4 → 1', (await state(page)).page === 1);
  await navClick(page, 'Back');
  await page.waitForTimeout(150);
  check('Back: 1 → 0, and no Back button on page 0', (await state(page)).page === 0 && !(await navVisible(page)).includes('Back'));
  await clickIn(page, '[data-bspf-field="hasDeadline"] input[type="checkbox"]');
  s = await state(page);
  check('hasDeadline on → Deadline page added [0,1,3,4]', JSON.stringify(s.active) === '[0,1,3,4]', JSON.stringify(s.active));
  steps = await visibleSteps(page);
  check('…4 steps, Deadline numbered 3', steps.length === 4 && steps[2] === 'Deadline#3', JSON.stringify(steps));

  // clamp: the current page stops applying → nearest earlier active page
  await navClick(page, 'Next');
  await page.waitForTimeout(150);
  await setVal(page, 'requestType', 'Room booking');
  s = await state(page);
  check('clamp: on Equipment, requestType → Room booking moves page back to 0', s.page === 0 && JSON.stringify(s.active) === '[0,2,3,4]',
    JSON.stringify({ page: s.page, active: s.active }));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // stale answers: room answers left behind, deadline answered then switched off
  ({ ctx, page } = await openForm(browser));
  await comboPick(page, 'requestType', 'Room booking');
  await navClick(page, 'Next');
  await page.waitForTimeout(150);
  check('Room booking → page 2', (await state(page)).page === 2);
  await page.fill('[data-bspf-field="bookingDate"] input.input', '2030-01-15');
  await page.focus('[data-bspf-field="attendees"] input[type="range"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  s = await state(page);
  check('room answers entered (date + slider)', s.values.bookingDate === '2030-01-15' && typeof s.values.attendees === 'number', JSON.stringify([s.values.bookingDate, s.values.attendees]));
  await navClick(page, 'Back');
  await page.waitForTimeout(150);
  await comboPick(page, 'requestType', 'Equipment');
  await clickIn(page, '[data-bspf-field="hasDeadline"] input[type="checkbox"]');
  await navClick(page, 'Next');
  await page.waitForTimeout(150);
  await comboPick(page, 'item', 'Monitor');
  await comboPick(page, 'quantity', 2);
  await navClick(page, 'Next');
  await page.waitForTimeout(150);
  check('Equipment → Next lands on Deadline (3)', (await state(page)).page === 3);
  await page.fill('[data-bspf-field="deadlineDate"] input.input', '2030-01-18');
  await navClick(page, 'Back'); await page.waitForTimeout(150);
  await navClick(page, 'Back'); await page.waitForTimeout(150);
  await clickIn(page, '[data-bspf-field="hasDeadline"] input[type="checkbox"]');
  s = await state(page);
  check('hasDeadline off → Deadline drops out [0,1,4] (its answer kept in state)', JSON.stringify(s.active) === '[0,1,4]' && s.values.deadlineDate === '2030-01-18',
    JSON.stringify({ active: s.active, d: s.values.deadlineDate }));
  check('a rule/token read of a skipped page\'s field sees it empty', await page.evaluate(new Function('const s = ' + ST + '; return s._get("deadlineDate") === "" && s._get("bookingDate") === "" && s._get("attendees") === "";')));
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  check('…and Next skips it: 1 → 4', (await state(page)).page === 4);
  await page.fill('[data-bspf-field="reference"] input', 'TCK-42');
  await submitConfirmed(page);
  let p = (await adds(page))[0] || {};
  check('stale room answers absent from the payload', !('BookingDate' in p) && !('Attendees' in p), JSON.stringify(p));
  check('skipped Deadline page: its column absent (not null)', !('Deadline' in p), JSON.stringify(p.Deadline));
  check('hidden field (otherDetails) absent', !('OtherDetails' in p));
  check('number dropdown saves a Number', p.Quantity === 2 && typeof p.Quantity === 'number', JSON.stringify(p.Quantity));
  check('"_Ref" written as OData__Ref, never _Ref', p.OData__Ref === 'TCK-42' && !('_Ref' in p), JSON.stringify(p));
  check('active answers saved (Requester = @me, Item, booleans)', p.RequesterId === 999 && p.RequestType === 'Equipment' && p.Item === 'Monitor' &&
    p.HasDeadline === false && p.Ergonomic === false, JSON.stringify(p));
  check('title template', p.Title === 'Workplace Request — Equipment — Dev Tester', JSON.stringify(p.Title));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // a later PAGE rule and a {field:} token reading a field on a now-skipped page
  ({ ctx, page } = await openForm(browser, {
    mutate: cfg => {
      cfg.pages[3].visibleWhen = { any: [{ field: 'hasDeadline', op: 'equals', value: true }, { field: 'bookingDate', op: 'notEmpty' }] };
      cfg.target.titleTemplate = '{form:title} — {field:requestType} — {field:bookingDate}';
    }
  }));
  await comboPick(page, 'requestType', 'Room booking');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await page.fill('[data-bspf-field="bookingDate"] input.input', '2030-01-15');
  await page.waitForTimeout(100);
  s = await state(page);
  check('bookingDate drives the Deadline page [0,2,3,4]', JSON.stringify(s.active) === '[0,2,3,4]', JSON.stringify(s.active));
  await navClick(page, 'Back'); await page.waitForTimeout(150);
  await comboPick(page, 'requestType', 'Equipment');
  s = await state(page);
  check('stale bookingDate (room page skipped) no longer drives it [0,1,4]', JSON.stringify(s.active) === '[0,1,4]' && s.values.bookingDate === '2030-01-15',
    JSON.stringify({ active: s.active, b: s.values.bookingDate }));
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await comboPick(page, 'item', 'Keyboard');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  check('…Next skips Deadline: lands on 4', (await state(page)).page === 4);
  await submitConfirmed(page);
  p = (await adds(page))[0] || {};
  check('{field:} token of a skipped page renders empty', p.Title === 'Workplace Request — Equipment — ', JSON.stringify(p.Title));
  await ctx.close();

  // endWhen: "Something else" ends the form on page 0
  ({ ctx, page } = await openForm(browser));
  await setVal(page, 'notes', 'left on a page the form will skip');
  await setVal(page, 'reference', 'X-1');
  await clickIn(page, '[data-bspf-field="hasDeadline"] input[type="checkbox"]');
  await comboPick(page, 'requestType', 'Something else');
  s = await state(page);
  const nav = await navVisible(page);
  check('endWhen: only page 0 active', JSON.stringify(s.active) === '[0]', JSON.stringify(s.active));
  check('Submit replaces Next on page 0', nav.includes('Submit') && !nav.includes('Next'), JSON.stringify(nav));
  check('stepper shows one step', (await visibleSteps(page)).length === 1);
  await navClick(page, 'Submit');
  await page.waitForTimeout(250);
  check('otherDetails required: error, no dialog, nothing saved', await isVisible(page, '[data-bspf-field="otherDetails"] .field__error') &&
    !(await isVisible(page, '.bspf-dialog .dialog')) && (await adds(page)).length === 0);
  await page.fill('[data-bspf-field="otherDetails"] textarea', 'A coat rack for the team room.');
  await submitConfirmed(page);
  p = (await adds(page))[0] || {};
  check('payload has page-0 columns only', JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['HasDeadline', 'OtherDetails', 'RequestType', 'RequesterId', 'Title']),
    JSON.stringify(Object.keys(p).sort()));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

async function testNormalizeErrors(browser) {
  console.log('0.6.0 config errors (error card + BSPForms.normalize):');
  const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'forms', name + '.json'), 'utf8'));
  const itField = (cfg, id) => { let hit; cfg.pages.forEach(p => p.sections.forEach(s => s.fields.forEach(f => { if (f.id === id) hit = f; }))); return hit; };
  const cases = [
    ['pages[0].visibleWhen', false, cfg => { cfg.pages[0].visibleWhen = { field: 'requestType', op: 'notEmpty' }; }, /first page always shows/],
    ['page visibleWhen on a field of its own page', false, cfg => { cfg.pages[1].visibleWhen = { field: 'ergonomic', op: 'equals', value: true }; }, /visibleWhen can only use fields on earlier pages/],
    ['choicesWhen driver after the field', true, cfg => { itField(cfg, 'accessLevel').choicesWhen = { field: 'isRecurring', map: { 'true': ['Read'] } }; }, /choicesWhen\.field must come before this field/],
    ['choicesWhen value not in choices', true, cfg => { itField(cfg, 'accessLevel').choicesWhen.map.Hardware = ['Standard kit', 'Gold kit']; }, /choicesWhen value "Gold kit" is not one of this field's choices/],
    ['slider without validation.max', true, cfg => { delete itField(cfg, 'impactScore').validation.max; }, /display "slider" needs whole-number validation\.min and validation\.max/],
    ['number dropdown with > 200 values', true, cfg => { itField(cfg, 'quantity').validation.max = 250; }, /lists at most 200 values/],
    ['unknown date rule op', true, cfg => { itField(cfg, 'neededBy').rules.push({ op: 'onWeekday', mode: 'block' }); }, /date rule op must be one of/],
    ['minBusinessDays without form.businessHours', false, cfg => { delete cfg.form.businessHours; }, /minBusinessDays needs form\.businessHours/],
    ['attachments on a page with visibleWhen', true, cfg => { cfg.pages[2].visibleWhen = { field: 'category', op: 'notEmpty' }; }, /which has visibleWhen/],
    ['default "@me" on a text field', true, cfg => { itField(cfg, 'costCentre').default = '@me'; }, /default "@me" is for person fields/],
    ['choicesWhen map entry that is a string, not an array', true, cfg => { itField(cfg, 'accessLevel').choicesWhen.map.Hardware = 'Standard kit'; },
      /choicesWhen\.map "Hardware" must be an array of choice values/],
    ['choicesWhen map key not a declared driver value (driver has fillIn)', true, cfg => {
      itField(cfg, 'category').fillIn = true;
      itField(cfg, 'accessLevel').choicesWhen.map.Printer = ['Standard kit'];
    }, /choicesWhen\.map key "Printer" is not a value of "category"/]
  ];
  const probe = await browser.newPage();
  await probe.goto(BASE);
  await probe.waitForTimeout(800);
  for (const [name, it, mutate, re] of cases) {
    const { ctx, page } = await openForm(browser, { it, mutate, settle: 100 });
    const st = await page.getAttribute('[data-bsp-form]', 'data-bspf-state');
    check(name + ' → error card', st === 'error' && await page.locator('[data-bspf-fatal]').isVisible(), 'state=' + st);
    await ctx.close();
    const cfg = read(it ? 'example-it-request' : 'example-branching');
    mutate(cfg);
    const errs = await probe.evaluate(c => BSPForms.normalize(c).errors, cfg);
    check('  …BSPForms.normalize reports it', errs.some(e => re.test(e)), JSON.stringify(errs));
  }
  // every shipped config still loads
  const names = fs.readdirSync(path.join(__dirname, '..', 'forms')).filter(f => /\.json$/.test(f)).map(f => f.replace(/\.json$/, ''));
  const bad = [];
  for (const n of names) {
    const errs = await probe.evaluate(c => BSPForms.normalize(c).errors, read(n));
    if (errs.length) bad.push(n + ': ' + errs.join('; '));
  }
  check('BSPForms.normalize: every forms/*.json has no errors (' + names.length + ')', bad.length === 0, bad.join(' | '));
  await probe.close();
}

async function testChoicesWhen(browser) {
  console.log('choicesWhen:');
  // IT request: driver = choice "category"
  let { ctx, page } = await openForm(browser, { it: true, now: TUE_10AM_ET });
  await toPage(page, 1);
  check('no driver value → dependent field hidden', !(await isVisible(page, '[data-bspf-field="accessLevel"]')));
  await comboPick(page, 'category', 'Hardware');
  check('driver set → field shows', await isVisible(page, '[data-bspf-field="accessLevel"]'));
  let opts = await comboOptions(page, 'accessLevel');
  check('only the allowed options are visible (Hardware)', JSON.stringify(opts) === JSON.stringify(['Standard kit', 'Upgraded kit']), JSON.stringify(opts));
  await comboPick(page, 'accessLevel', 'Upgraded kit');
  check('pick held', (await state(page)).values.accessLevel === 'Upgraded kit');
  await comboPick(page, 'category', 'Software');
  check('driver change prunes a no-longer-allowed value', (await state(page)).values.accessLevel === '');
  opts = await comboOptions(page, 'accessLevel');
  check('options follow the driver (Software)', JSON.stringify(opts) === JSON.stringify(['Single user', 'Team licence']), JSON.stringify(opts));
  await comboPick(page, 'accessLevel', 'Team licence');
  await setVal(page, 'category', 'System access');   // not a click: the $watch prunes whatever changed it
  check('programmatic driver change prunes too', (await state(page)).values.accessLevel === '');
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // branching: driver = boolean "ergonomic", dependent single choice with fill-in
  ({ ctx, page } = await openForm(browser));
  await comboPick(page, 'requestType', 'Equipment');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  opts = await comboOptions(page, 'item');
  check('boolean driver off → its "false" options', JSON.stringify(opts) === JSON.stringify(['Monitor', 'Keyboard', 'Mouse']), JSON.stringify(opts));
  await comboPick(page, 'item', 'Keyboard');
  await clickIn(page, '[data-bspf-field="ergonomic"] input[type="checkbox"]');
  check('boolean driver flip prunes the value', (await state(page)).values.item === '');
  opts = await comboOptions(page, 'item');
  check('boolean driver on → its "true" options', JSON.stringify(opts) === JSON.stringify(['Standing desk', 'Ergonomic chair']), JSON.stringify(opts));
  await page.evaluate(new Function('const s = ' + ST + '; s.fill.item = "Footrest"; s.pickFill("item");'));
  await page.waitForTimeout(100);
  check('fill-in ("Other") value held', (await state(page)).values.item === 'Footrest');
  await clickIn(page, '[data-bspf-field="ergonomic"] input[type="checkbox"]');
  check('driver change drops the fill-in value', (await state(page)).values.item === '');
  await ctx.close();

  // multichoice + fill-in pruning (route-mutated: an "extras" multichoice keyed on category)
  ({ ctx, page } = await openForm(browser, {
    it: true, now: TUE_10AM_ET,
    mutate: cfg => {
      const sec = cfg.pages[1].sections[0];
      const at = sec.fields.findIndex(f => f.id === 'accessLevel') + 1;
      sec.fields.splice(at, 0, {
        id: 'extras', type: 'multichoice', label: 'Extras', column: 'Extras', fillIn: true,
        choices: ['Bag', 'Stand', 'Charger', 'Licence key', 'Training'],
        choicesWhen: { field: 'category', map: { Hardware: ['Bag', 'Stand', 'Charger'], Software: ['Licence key', 'Training'], 'System access': ['Training'] } }
      });
    }
  }));
  await toPage(page, 1);
  await comboPick(page, 'category', 'Hardware');
  opts = await comboOptions(page, 'extras');
  check('multichoice: only allowed options', JSON.stringify(opts) === JSON.stringify(['Bag', 'Stand', 'Charger']), JSON.stringify(opts));
  await page.evaluate(new Function('const s = ' + ST + '; s.toggleMulti("extras", "Bag"); s.toggleMulti("extras", "Charger"); s.fill.extras = "Sticker"; s.pickFillMulti("extras");'));
  await page.waitForTimeout(100);
  check('multichoice picks + fill-in held', JSON.stringify((await state(page)).values.extras) === '["Bag","Charger","Sticker"]');
  await comboPick(page, 'category', 'Software');
  check('multichoice: driver change drops disallowed picks and the fill-in', JSON.stringify((await state(page)).values.extras) === '[]',
    JSON.stringify((await state(page)).values.extras));
  await page.evaluate(new Function('const s = ' + ST + '; s.toggleMulti("extras", "Licence key"); s.toggleMulti("extras", "Training");'));
  await comboPick(page, 'category', 'System access');
  check('multichoice: still-allowed picks are kept', JSON.stringify((await state(page)).values.extras) === '["Training"]',
    JSON.stringify((await state(page)).values.extras));
  await ctx.close();

  // no driver value → inactive → absent from the payload (sendEmpty on, so an
  // ACTIVE empty field would show up as null)
  ({ ctx, page } = await openForm(browser, {
    it: true, now: TUE_10AM_ET,
    mutate: cfg => {
      cfg.target.sendEmpty = true;
      cfg.pages[1].sections[0].fields.find(f => f.id === 'category').required = false;
    }
  }));
  await page.evaluate(new Function('a', 'const s = ' + ST + '; s.values.requestFor = [a]; s.values.contactEmail = "dev.tester@example.com"; s.values.costCentre = "12345";'), SOFIA);
  await navClick(page, 'Next'); await page.waitForTimeout(200);
  await page.evaluate(new Function('const s = ' + ST + '; s.values.priorityJustification = "Needed for the new starter joining the team next month."; s.values.neededBy = "2030-01-22"; s.values.accessLevel = "Read";'));
  await navClick(page, 'Next'); await page.waitForTimeout(200);
  await page.evaluate(new Function('const s = ' + ST + '; s.values.managerAware = true;'));
  await navClick(page, 'Submit request');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 5000 });
  const p = (await adds(page))[0] || {};
  check('no driver value → dependent field absent (even with a stale value)', !('AccessLevel' in p), JSON.stringify(p.AccessLevel));
  check('…while active empty fields are sent as null (sendEmpty on)', p.Category === null && p.ContactPhone === null, JSON.stringify([p.Category, p.ContactPhone]));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

async function testNumberControls(browser) {
  console.log('number dropdown + slider:');
  let { ctx, page } = await openForm(browser, { it: true, now: TUE_10AM_ET });
  await toPage(page, 1);
  await comboPick(page, 'category', 'Hardware');
  const sl = '[data-bspf-field="impactScore"]';
  const readout = () => page.locator(sl + ' .bspf-slider__value').textContent();
  const unset = () => page.evaluate(s => document.querySelector(s + ' .bspf-slider').classList.contains('is-unset'), sl);
  check('slider starts unset: "Not set" readout + is-unset, value ""', (await readout()).trim() === 'Not set' && await unset() &&
    (await state(page)).values.impactScore === '');
  const unsetShot = await page.locator(sl).screenshot();
  await page.focus(sl + ' input[type="range"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  let v = (await state(page)).values.impactScore;
  check('ArrowRight sets a Number (midpoint 6 → 7)', v === 7, JSON.stringify(v));
  check('readout shows it, is-unset gone', (await readout()).trim() === '7' && !(await unset()));
  const setShot = await page.locator(sl).screenshot();
  await page.keyboard.press('End');
  await page.waitForTimeout(80);
  check('End → max', (await state(page)).values.impactScore === 10);
  await clickIn(page, sl + ' .bspf-slider__clear');
  check('Clear → unset again', (await state(page)).values.impactScore === '' && (await readout()).trim() === 'Not set' && await unset());
  check('Clear button hides while unset', !(await isVisible(page, sl + ' .bspf-slider__clear')));

  // number dropdown 1..12
  const dd = '[data-bspf-field="quantity"]';
  const nums = await comboOptions(page, 'quantity');
  check('dropdown lists min..max (1..12)', JSON.stringify(nums) === JSON.stringify(Array.from({ length: 12 }, (_, i) => String(i + 1))), JSON.stringify(nums));
  await comboPick(page, 'quantity', 3);
  v = (await state(page)).values.quantity;
  check('dropdown value is a Number', v === 3 && typeof v === 'number', JSON.stringify(v));
  check('…shown as a pill', (await page.locator(dd + ' .bspf-numdrop__pill').textContent()).trim() === '3');
  // screenshot: the dropdown open
  await clickIn(page, dd + ' .bspf-combo__control');
  const box = await page.evaluate(s => {
    const a = document.querySelector(s).getBoundingClientRect(), b = document.querySelector(s + ' .bspf-combo__menu').getBoundingClientRect();
    const x = Math.min(a.left, b.left) - 8, y = Math.min(a.top, b.top) - 8;
    return { x, y: y + window.scrollY, width: Math.max(a.right, b.right) - x + 8, height: Math.max(a.bottom, b.bottom) - y + 8 };
  }, dd);
  const numdropPath = path.join(os.tmpdir(), 'bspf-numdrop.png');
  await page.screenshot({ path: numdropPath, clip: box, fullPage: true });
  await clickIn(page, dd + ' .bspf-combo__control');
  // slider screenshot: unset over set, one image
  const shotPage = await ctx.newPage();
  await shotPage.setContent('<body style="margin:0;background:#fff"><div id="shot" style="display:inline-block;padding:12px">' +
    '<img src="data:image/png;base64,' + unsetShot.toString('base64') + '" style="display:block;margin-bottom:12px">' +
    '<img src="data:image/png;base64,' + setShot.toString('base64') + '" style="display:block"></div></body>');
  const sliderPath = path.join(os.tmpdir(), 'bspf-slider.png');
  await shotPage.locator('#shot').screenshot({ path: sliderPath });
  await shotPage.close();
  check('screenshots saved', fs.existsSync(sliderPath) && fs.existsSync(numdropPath), sliderPath + ' ' + numdropPath);
  console.log('    screenshots: ' + sliderPath + ' , ' + numdropPath);
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // required slider: required error until moved, no Clear button
  ({ ctx, page } = await openForm(browser, {
    it: true, now: TUE_10AM_ET,
    mutate: cfg => { cfg.pages[1].sections[0].fields.find(f => f.id === 'impactScore').required = true; }
  }));
  await toPage(page, 1);
  check('required slider: no Clear button rendered', (await page.locator(sl + ' .bspf-slider__clear').count()) === 0);
  await navClick(page, 'Next');
  await page.waitForTimeout(200);
  let s = await state(page);
  check('required + unset → required error', s.page === 1 && s.errors.impactScore === 'This field is required.' &&
    await isVisible(page, sl + ' .field__error'), JSON.stringify(s.errors.impactScore));
  await page.focus(sl + ' input[type="range"]');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  s = await state(page);
  check('moving it sets a Number and clears the error', s.values.impactScore === 5 && s.errors.impactScore === '', JSON.stringify([s.values.impactScore, s.errors.impactScore]));
  await ctx.close();

  // slider value saved as a Number (branching: Room booking path)
  ({ ctx, page } = await openForm(browser));
  await comboPick(page, 'requestType', 'Room booking');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await page.fill('[data-bspf-field="bookingDate"] input.input', '2030-01-15');
  await page.focus('[data-bspf-field="attendees"] input[type="range"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await submitConfirmed(page);
  const p = (await adds(page))[0] || {};
  check('slider payload value is a Number (11 → 13)', p.Attendees === 13 && typeof p.Attendees === 'number', JSON.stringify(p.Attendees));
  check('Room path: Equipment columns absent, BookingDate written', !('Item' in p) && !('Quantity' in p) && !('Ergonomic' in p) &&
    /^2030-01-15T/.test(p.BookingDate), JSON.stringify(p));
  await ctx.close();
}

async function testClearButtons(browser) {
  console.log('clear buttons:');
  const { ctx, page } = await openForm(browser, { it: true, now: TUE_10AM_ET });
  await toPage(page, 1);
  await comboPick(page, 'category', 'Hardware');
  const f = k => '[data-bspf-field="' + k + '"]';
  // optional single choice: the × and the menu's "Clear selection" row
  check('× hidden while empty', !(await isVisible(page, f('accessLevel') + ' .bspf-clear')));
  await comboPick(page, 'accessLevel', 'Standard kit');
  check('× shows once a choice is set', await isVisible(page, f('accessLevel') + ' .bspf-clear'));
  await clickIn(page, f('accessLevel') + ' .bspf-clear');
  check('choice × clears it (menu stays closed)', (await state(page)).values.accessLevel === '' && !(await isVisible(page, f('accessLevel') + ' .bspf-combo__menu')));
  await comboPick(page, 'accessLevel', 'Upgraded kit');
  await page.evaluate(async s => {
    document.querySelector(s + ' .bspf-combo__control').click();
    await new Promise(r => setTimeout(r, 80));
    document.querySelector(s + ' .bspf-combo__option--clear').click();
  }, f('accessLevel'));
  await page.waitForTimeout(100);
  check('menu "Clear selection" clears it', (await state(page)).values.accessLevel === '');
  // date (optional recurrenceEnd)
  await clickIn(page, f('isRecurring') + ' input[type="checkbox"]');
  await page.fill(f('recurrenceEnd') + ' input.input', '2030-02-01');
  await page.waitForTimeout(100);
  check('date × shows when set', await isVisible(page, f('recurrenceEnd') + ' .bspf-clear'));
  await clickIn(page, f('recurrenceEnd') + ' .bspf-clear');
  check('date × clears it', (await state(page)).values.recurrenceEnd === '' && (await page.inputValue(f('recurrenceEnd') + ' input.input')) === '');
  // number input (optional currency)
  await page.fill(f('estimatedCost') + ' input.input', '250');
  await page.waitForTimeout(100);
  check('number input holds a Number', (await state(page)).values.estimatedCost === 250);
  await clickIn(page, f('estimatedCost') + ' .bspf-clear');
  check('number × clears it', (await state(page)).values.estimatedCost === '' && (await page.inputValue(f('estimatedCost') + ' input.input')) === '');
  // number dropdown
  await comboPick(page, 'quantity', 4);
  await clickIn(page, f('quantity') + ' .bspf-clear');
  check('number dropdown × clears it', (await state(page)).values.quantity === '');
  // link (url + display text)
  await page.fill(f('vendorLink') + ' input[type="url"]', 'https://example.com/dock');
  await page.fill(f('vendorLink') + ' input[type="text"]', 'Dock');
  await page.waitForTimeout(100);
  await clickIn(page, f('vendorLink') + ' .bspf-clear');
  const lv = (await state(page)).values.vendorLink;
  check('link × clears url and text', lv.url === '' && lv.desc === '', JSON.stringify(lv));
  // required fields never get one
  const req = await page.evaluate(() => ['category', 'hardwareType', 'neededBy', 'priorityJustification']
    .map(k => document.querySelectorAll('[data-bspf-field="' + k + '"] .bspf-clear').length));
  check('required fields have no ×', req.every(n => n === 0), JSON.stringify(req));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

async function testBusinessDays(browser) {
  for (const tz of [null, 'America/Los_Angeles']) {
    console.log('business-day date rules (browser zone ' + (tz || 'default') + '):');
    const { ctx, page } = await openForm(browser, { tz });
    await comboPick(page, 'requestType', 'Room booking');
    await navClick(page, 'Next'); await page.waitForTimeout(150);
    const inp = '[data-bspf-field="bookingDate"] input.input';
    check('Fri: date input min = earliest allowed (Tue 15th)', (await page.getAttribute(inp, 'min')) === '2030-01-15', await page.getAttribute(inp, 'min'));
    const err = () => page.evaluate(() => { const e = document.querySelector('[data-bspf-field="bookingDate"] .field__error'); return e && e.offsetParent ? e.textContent : ''; });
    await page.fill(inp, '2030-01-14');
    await page.waitForTimeout(100);
    check('Fri: minBusinessDays 2 rejects Mon 14th', /at least 2 business day/.test(await err()), await err());
    await page.fill(inp, '2030-01-15');
    await page.waitForTimeout(100);
    check('Fri: accepts Tue 15th', (await err()) === '');
    await page.fill(inp, '2030-02-02');
    await page.waitForTimeout(100);
    check('far-out Saturday passes minBusinessDays, fails businessDay', /business day, not a weekend/.test(await err()), await err());
    // state-level: the same field under other "todays" (clock re-pinned)
    const at = async (now, v) => {
      await page.clock.setFixedTime(new Date(now));
      return page.evaluate(new Function('v', 'const s = ' + ST + '; s.values.bookingDate = v; s.check("bookingDate"); return { err: s.errors.bookingDate, min: s.minDate("bookingDate") };'), v);
    };
    let r = await at('2030-01-12T15:00:00Z', '2030-01-14');
    let r2 = await at('2030-01-13T15:00:00Z', '2030-01-15');
    check('Sat/Sun "today": Mon rejected, Tue allowed, min Tue', !!r.err && r.min === '2030-01-15' && !r2.err && r2.min === '2030-01-15', JSON.stringify([r, r2]));
    // Mon 01:00 ET = Sun 22:00 Pacific: "today" is the business zone's Monday
    r = await at('2030-01-14T06:00:00Z', '2030-01-15');
    r2 = await at('2030-01-14T06:00:00Z', '2030-01-16');
    check('Mon 01:00 ET (Sun evening PT): Tue rejected, Wed allowed, min Wed', !!r.err && !r2.err && r2.min === '2030-01-16', JSON.stringify([r, r2]));
    // DST starts Sun 2030-03-10: whole days still count right
    r = await at('2030-03-08T15:00:00Z', '2030-03-11');
    r2 = await at('2030-03-08T15:00:00Z', '2030-03-12');
    check('DST weekend (Fri 8 Mar): Mon 11 rejected, Tue 12 allowed, min Tue 12', !!r.err && !r2.err && r2.min === '2030-03-12', JSON.stringify([r, r2]));
    r = await at('2030-03-11T04:30:00Z', '2030-03-13');   // Mon 00:30 EDT = Sun 21:30 PDT
    check('just after the DST switch (Mon 00:30 EDT): Wed 13 = 2 days, allowed', !r.err, JSON.stringify(r));
    // a warn-mode lead time: a warning, never a block, and no :min
    await page.clock.setFixedTime(new Date(FRI_10AM_ET));
    await page.evaluate(new Function('const s = ' + ST + '; s.values.bookingDate = "2030-01-15"; s.check("bookingDate"); s.values.hasDeadline = true;'));
    await toPage(page, 3);
    const dl = '[data-bspf-field="deadlineDate"]';
    check('warn-only minBusinessDays → no min attribute', (await page.getAttribute(dl + ' input.input', 'min')) === null);
    await page.fill(dl + ' input.input', '2030-01-15');
    await page.waitForTimeout(100);
    let ds = await state(page);
    check('warn-mode: under 3 business days → warning, no error', /Under 3 business days/.test(ds.warnings.deadlineDate) && ds.errors.deadlineDate === '',
      JSON.stringify([ds.warnings.deadlineDate, ds.errors.deadlineDate]));
    await page.fill(dl + ' input.input', '2030-01-16');
    await page.waitForTimeout(100);
    ds = await state(page);
    check('…3 business days → no warning', ds.warnings.deadlineDate === '' && ds.errors.deadlineDate === '');
    check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
    await ctx.close();
  }
}

async function testSendEmpty(browser) {
  console.log('target.sendEmpty (example-branching):');
  const { ctx, page } = await openForm(browser, {
    mutate: cfg => {
      cfg.pages[4].sections[0].fields.push(
        { id: 'tags', type: 'multichoice', label: 'Tags', column: 'Tags', choices: ['Urgent', 'Follow-up'] },
        { id: 'watchers', type: 'person', multiple: true, label: 'Watchers', column: 'Watchers' },
        { id: 'backup', type: 'person', label: 'Backup contact', column: 'Backup' },
        { id: 'website', type: 'link', label: 'Website', column: 'Website' });
    }
  });
  await comboPick(page, 'requestType', 'Equipment');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await comboPick(page, 'item', 'Mouse');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  await submitConfirmed(page);
  const p = (await adds(page))[0] || {};
  check('exact keys: active columns only (inactive pages absent)', JSON.stringify(Object.keys(p).sort()) === JSON.stringify(
    ['BackupId', 'Ergonomic', 'HasDeadline', 'Item', 'Notes', 'OData__Ref', 'Quantity', 'RequestType', 'RequesterId', 'Tags', 'Title', 'WatchersId', 'Website']),
  JSON.stringify(Object.keys(p).sort()));
  check('empty scalars → null (number, note, text, link, single person)', p.Quantity === null && p.Notes === null && p.OData__Ref === null &&
    p.Website === null && p.BackupId === null, JSON.stringify(p));
  check('empty multi-values → { results: [] } (multichoice, multi person)', JSON.stringify(p.Tags) === '{"results":[]}' &&
    JSON.stringify(p.WatchersId) === '{"results":[]}', JSON.stringify([p.Tags, p.WatchersId]));
  check('no "_Ref" key', !('_Ref' in p));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

async function testAtMe(browser) {
  console.log('@me person default:');
  // reference config: a multi person defaulting to me
  let { ctx, page } = await openForm(browser, { it: true, now: TUE_10AM_ET });
  let s = await state(page);
  check('IT request: ccPeople (multiple) prefilled with me', s.values.ccPeople.length === 1 && s.values.ccPeople[0].key === ME_LOGIN &&
    s.values.ccPeople[0].text === 'Dev Tester', JSON.stringify(s.values.ccPeople));
  await ctx.close();

  // branching: remove me, pick someone else; Submit another re-fills me and cancels the countdown
  ({ ctx, page } = await openForm(browser, { mutate: cfg => { cfg.confirmation.redirect.seconds = 3; } }));
  const rq = '[data-bspf-field="requester"]';
  s = await state(page);
  check('requester prefilled with Dev Tester (claims login, id resolved at submit)', s.values.requester.length === 1 && s.values.requester[0].key === ME_LOGIN &&
    s.values.requester[0].email === 'dev.tester@example.com' && s.values.requester[0].id === null, JSON.stringify(s.values.requester));
  check('…shown as a tag', (await page.locator(rq + ' .bspf-people__tag').textContent()).includes('Dev Tester'));
  await clickIn(page, rq + ' .tag__remove');
  check('removed', (await state(page)).values.requester.length === 0);
  await page.fill(rq + ' .bspf-people__input', 'sof');
  await page.waitForSelector(rq + ' .bspf-people__option', { state: 'visible', timeout: 4000 });
  await clickIn(page, rq + ' .bspf-people__option');
  await page.waitForTimeout(250);
  s = await state(page);
  check('someone else picked instead', s.values.requester.length === 1 && s.values.requester[0].text === 'Sofia Chen', JSON.stringify(s.values.requester));
  await comboPick(page, 'requestType', 'Something else');
  await page.fill('[data-bspf-field="otherDetails"] textarea', 'Picked on behalf of Sofia.');
  await submitConfirmed(page);
  const p = (await adds(page))[0] || {};
  check('payload: the picked person, not me', p.RequesterId === 1000, JSON.stringify(p.RequesterId));
  check('confirmation countdown shows', await isVisible(page, '.bspf-done .bspf-result__count') &&
    /Redirecting in \d+ seconds/.test(await page.locator('.bspf-done .bspf-result__count').textContent()));
  await navClick(page, 'Submit another');
  await page.waitForTimeout(400);
  s = await state(page);
  check('Submit another re-fills me', s.view === 'form' && s.values.requester.length === 1 && s.values.requester[0].key === ME_LOGIN, JSON.stringify(s.values.requester));
  await page.waitForTimeout(4200);
  check('Submit another cancelled the redirect', !HOME_RE.test(page.url()) &&
    await page.evaluate(new Function('return ' + ST + '.redir.url === "";')), page.url());
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // the fill is async: a person picked before it lands is never replaced.
  // The mock's ready() is slowed (3 s) so the pick reliably comes first.
  ({ ctx, page } = await openForm(browser, {
    settle: 0,
    init: () => {
      let v;
      Object.defineProperty(window, 'BSPF_MOCK_SP', {
        configurable: true,
        get() { return v; },
        set(x) { x.ready = () => new Promise(r => setTimeout(r, 3000)); v = x; }
      });
    }
  }));
  const before = (await state(page)).values.requester.length;
  await page.evaluate(new Function('a', 'const s = ' + ST + '; s.addPerson("requester", a);'), SOFIA);
  await page.waitForTimeout(3600);
  s = await state(page);
  check('an earlier pick is not overwritten by the late @me fill', before === 0 && s.values.requester.length === 1 &&
    s.values.requester[0].text === 'Sofia Chen', JSON.stringify({ before, now: s.values.requester }));
  await ctx.close();
  ({ ctx, page } = await openForm(browser, {
    settle: 0,
    init: () => {
      let v;
      Object.defineProperty(window, 'BSPF_MOCK_SP', {
        configurable: true,
        get() { return v; },
        set(x) { x.ready = () => new Promise(r => setTimeout(r, 3000)); v = x; }
      });
    }
  }));
  await page.waitForTimeout(3600);
  s = await state(page);
  check('…while an untouched field is filled once the user is known', s.values.requester.length === 1 && s.values.requester[0].key === ME_LOGIN,
    JSON.stringify(s.values.requester));
  await ctx.close();
}

async function testConfirmationRedirect(browser) {
  console.log('confirmation redirect:');
  const { ctx, page } = await openForm(browser, { mutate: cfg => { cfg.confirmation.redirect.seconds = 1; } });
  await comboPick(page, 'requestType', 'Something else');
  await page.fill('[data-bspf-field="otherDetails"] textarea', 'A whiteboard.');
  await navClick(page, 'Submit');
  await page.waitForTimeout(250);
  check('submitConfirm: custom title and Yes / No', /Send this request\?/.test(await page.locator('.bspf-dialog').textContent()) &&
    (await page.locator('.bspf-dialog__ok').textContent()).trim() === 'Yes' && (await page.locator('.bspf-dialog__alt').textContent()).trim() === 'No');
  await navClick(page, 'Yes');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 5000 });
  check('done view: countdown + "Go now" link to the configured page', await isVisible(page, '.bspf-done .bspf-result__count') &&
    (await page.getAttribute('.bspf-done .bspf-result__count a', 'href')) === '/sites/FCUPortal/SitePages/Home.aspx');
  await page.waitForURL(HOME_RE, { timeout: 5000 }).catch(() => {});
  check('navigates to confirmation.redirect.url', HOME_RE.test(page.url()), page.url());
  await ctx.close();
}

/* Regressions for the Codex review of 0.6.0 (six fixes). */
const SLOW_READY = () => {
  // the mock's ready() resolves after 3 s, so an @me fill is still pending
  let v;
  Object.defineProperty(window, 'BSPF_MOCK_SP', {
    configurable: true,
    get() { return v; },
    set(x) { x.ready = () => new Promise(r => setTimeout(r, 3000)); v = x; }
  });
};
const bilingual = cfg => { cfg.form.languages = ['en', 'fr']; };
async function testReviewFixes(browser) {
  console.log('0.6.0 review fixes:');
  const itF = (cfg, id) => { let hit; cfg.pages.forEach(p => p.sections.forEach(s => s.fields.forEach(f => { if (f.id === id) hit = f; }))); return hit; };

  // 1. a default the driver doesn't allow is pruned at init (and never saved)
  let { ctx, page } = await openForm(browser, {
    it: true, now: TUE_10AM_ET,
    mutate: cfg => { itF(cfg, 'category').default = 'Hardware'; itF(cfg, 'accessLevel').default = 'Single user'; }
  });
  let s = await state(page);
  check('init: a disallowed default (Single user under Hardware) is pruned', s.values.category === 'Hardware' && s.values.accessLevel === '',
    JSON.stringify([s.values.category, s.values.accessLevel]));
  await page.evaluate(new Function('a', 'const s = ' + ST + '; s.values.requestFor = [a]; s.values.contactEmail = "dev.tester@example.com"; s.values.costCentre = "12345";'), SOFIA);
  await navClick(page, 'Next'); await page.waitForTimeout(200);
  await page.evaluate(new Function('const s = ' + ST + '; s.values.hardwareType = "Dock"; s.values.priorityJustification = "Needed for the new starter joining the team next month."; s.values.neededBy = "2030-01-22";'));
  await navClick(page, 'Next'); await page.waitForTimeout(200);
  await page.evaluate(new Function('const s = ' + ST + '; s.values.managerAware = true;'));
  await navClick(page, 'Submit request');
  await page.waitForSelector('.bspf-done', { state: 'visible', timeout: 5000 });
  let p = (await adds(page))[0] || {};
  check('…and absent from the payload', !('AccessLevel' in p) && p.Category === 'Hardware' && p.SubCategory === 'Dock', JSON.stringify(p));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
  ({ ctx, page } = await openForm(browser, {
    it: true, now: TUE_10AM_ET,
    mutate: cfg => { itF(cfg, 'category').default = 'Hardware'; itF(cfg, 'accessLevel').default = 'Upgraded kit'; }
  }));
  check('init: an allowed default is kept', (await state(page)).values.accessLevel === 'Upgraded kit');
  await ctx.close();
  ({ ctx, page } = await openForm(browser, {
    it: true, now: TUE_10AM_ET,
    mutate: cfg => { itF(cfg, 'category').default = 'Hardware'; Object.assign(itF(cfg, 'accessLevel'), { fillIn: true, default: 'Gold tier' }); }
  }));
  s = await state(page);
  check('init: a fill-in ("Other") default not in the list survives', s.values.accessLevel === 'Gold tier', JSON.stringify(s.values.accessLevel));
  await toPage(page, 1);
  check('…shown as the custom pill', (await page.locator('[data-bspf-field="accessLevel"] .bspf-combo__value').innerText()).trim() === 'Gold tier');
  await comboPick(page, 'category', 'Software');
  check('…but a driver change still drops it', (await state(page)).values.accessLevel === '');
  await ctx.close();

  // 3. language switch while the @me fill is pending: it lands in the new instance
  ({ ctx, page } = await openForm(browser, { settle: 0, init: SLOW_READY, mutate: bilingual }));
  const before = (await state(page)).values.requester.length;
  await page.evaluate(() => window.intl.setLang('fr'));
  await page.waitForTimeout(400);
  const fr = await page.evaluate(() => document.querySelector('.bspf').getAttribute('lang'));
  await page.waitForTimeout(3400);
  s = await state(page);
  check('switch to FR before @me resolves → the new instance gets it', before === 0 && fr === 'fr' && s.values.requester.length === 1 &&
    s.values.requester[0].key === ME_LOGIN, JSON.stringify({ before, fr, req: s.values.requester }));
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
  ({ ctx, page } = await openForm(browser, { mutate: bilingual }));
  check('bilingual form: @me filled', (await state(page)).values.requester.length === 1);
  await clickIn(page, '[data-bspf-field="requester"] .tag__remove');
  await page.evaluate(() => window.intl.setLang('fr'));
  await page.waitForTimeout(800);
  s = await state(page);
  check('@me removed, then switch to FR → not refilled (touched carried)', s.values.requester.length === 0 &&
    (await page.evaluate(() => document.querySelector('.bspf').getAttribute('lang'))) === 'fr', JSON.stringify(s.values.requester));
  await ctx.close();

  // 4. includeTime + blocking minBusinessDays, viewer in Los Angeles: the
  //    picker's min is the business day's Toronto midnight in LA wall time.
  //    Thu 2030-01-10 10:00 ET → 2 business days → Mon 14th (00:00 EST = Sun 21:00 PST)
  ({ ctx, page } = await openForm(browser, {
    tz: 'America/Los_Angeles', now: '2030-01-10T15:00:00Z',
    mutate: cfg => { cfg.pages[2].sections[0].fields.find(f => f.id === 'bookingDate').includeTime = true; }
  }));
  await comboPick(page, 'requestType', 'Room booking');
  await navClick(page, 'Next'); await page.waitForTimeout(150);
  const dt = '[data-bspf-field="bookingDate"] input.input';
  check('includeTime min (LA viewer) = Sun 21:00 local', (await page.getAttribute(dt, 'type')) === 'datetime-local' &&
    (await page.getAttribute(dt, 'min')) === '2030-01-13T21:00', await page.getAttribute(dt, 'min'));
  await page.fill(dt, '2030-01-13T22:00');
  await page.waitForTimeout(120);
  s = await state(page);
  check('Sun 22:00 LA (= Mon 01:00 Toronto) validates', s.errors.bookingDate === '', JSON.stringify(s.errors.bookingDate));
  await page.fill(dt, '2030-01-13T20:00');
  await page.waitForTimeout(120);
  s = await state(page);
  check('Sun 20:00 LA (= Sun 23:00 Toronto) is rejected', s.errors.bookingDate !== '', JSON.stringify(s.errors.bookingDate));
  await ctx.close();

  // 5. language switch during the confirmation countdown: carried, navigates once
  ({ ctx, page } = await openForm(browser, { mutate: cfg => { bilingual(cfg); cfg.confirmation.redirect.seconds = 4; } }));
  let homeHits = 0;
  await page.route('**/sites/FCUPortal/SitePages/Home.aspx', r => { homeHits++; return r.fulfill({ contentType: 'text/html', body: '<title>home</title>home' }); });
  const bspfErrors = [];
  page.on('console', m => { if (m.type() === 'error' && /\[BSP Forms\]/.test(m.text())) bspfErrors.push(m.text()); });
  await comboPick(page, 'requestType', 'Something else');
  await page.fill('[data-bspf-field="otherDetails"] textarea', 'A whiteboard.');
  await submitConfirmed(page);
  await page.evaluate(() => window.intl.setLang('fr'));
  await page.waitForTimeout(500);
  const cd = await page.evaluate(() => {
    const e = document.querySelector('.bspf-done .bspf-result__count');
    return { vis: !!e && e.offsetParent !== null, text: e ? e.textContent : '', lang: document.querySelector('.bspf').getAttribute('lang') };
  });
  check('FR render keeps the countdown, in French', cd.vis && cd.lang === 'fr' && /Redirection dans \d+ secondes/.test(cd.text), JSON.stringify(cd));
  check('no [BSP Forms] errors after the switch', bspfErrors.length === 0 && page.__errors.length === 0, bspfErrors.concat(page.__errors).join(' | '));
  await page.waitForURL(HOME_RE, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(2500);
  check('navigates to the redirect exactly once', HOME_RE.test(page.url()) && homeHits === 1, page.url() + ' hits=' + homeHits);
  await ctx.close();

  // 6. the stepper's accessible total follows the active pages
  ({ ctx, page } = await openForm(browser));
  const lbl = () => page.getAttribute('.bspf__stepper', 'aria-label');
  check('stepper aria-label: "Step  of 2" initially', (await lbl()) === 'Step  of 2', await lbl());
  await comboPick(page, 'requestType', 'Equipment');
  check('…"Step  of 3" after Equipment', (await lbl()) === 'Step  of 3', await lbl());
  await ctx.close();
}

async function testListsApi(browser) {
  console.log('BSPForms.lists() (read-only builder facade):');
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const L = BSPForms.lists();
    const keys = Object.keys(L).sort();
    const lists = await L.getWebLists();
    const t = lists.find(l => l.title === 'BSPF Builder Test');
    const schema = await L.getListSchema({ listId: t.id });
    const under = schema.fields.find(f => f.InternalName === '_Under');
    const nd = schema.fields.find(f => f.InternalName === 'NumDefault');
    return { keys, n: lists.length, same: BSPForms.lists() === L, title: schema.list.title,
      under: under && under.EntityPropertyName, ndMin: nd ? nd.MinimumValue : 'missing', nfields: schema.fields.length };
  });
  check('exactly ready / userInfo / getWebLists / getListSchema', JSON.stringify(r.keys) === '["getListSchema","getWebLists","ready","userInfo"]', JSON.stringify(r.keys));
  check('no write method', !r.keys.some(k => /add|ensure|update|delete|write|set|save|remove/i.test(k)));
  check('getWebLists() → 3 lists', r.n === 3, r.n);
  check('getListSchema(BSPF Builder Test): _Under → OData__Under', r.title === 'BSPF Builder Test' && r.under === 'OData__Under', JSON.stringify(r));
  check('…NumDefault MinimumValue is null (unbounded)', r.ndMin === null, JSON.stringify(r.ndMin));
  check('one shared facade', r.same);
  await page.close();
}

(async () => {
  const browser = await launch();
  // ONLY=testBranching,testSendEmpty runs a subset (iterating on one area)
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const suite = [testEditMode, testConfigErrors, testPresentation, testBusinessPrompt, testClassic, testCreativeCallout,
    testDoctorRichText, testZoneAttestation, testFullFlow,
    // engine 0.6.0
    testBranching, testNormalizeErrors, testChoicesWhen, testNumberControls, testClearButtons, testBusinessDays,
    testSendEmpty, testAtMe, testConfirmationRedirect, testListsApi, testReviewFixes];
  try {
    for (const t of suite) if (!only || only.includes(t.name)) await t(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nFAILED: ' + failures + ' check(s)' : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
