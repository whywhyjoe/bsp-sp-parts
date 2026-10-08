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
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await launch();
  try {
    await testEditMode(browser);
    await testConfigErrors(browser);
    await testPresentation(browser);
    await testBusinessPrompt(browser);
    await testClassic(browser);
    await testCreativeCallout(browser);
    await testDoctorRichText(browser);
    await testZoneAttestation(browser);
    await testFullFlow(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nFAILED: ' + failures + ' check(s)' : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
