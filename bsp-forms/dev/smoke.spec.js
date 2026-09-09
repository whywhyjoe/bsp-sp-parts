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
 *                                various/ and bsp-design-system/)
 *   node various/bsp-forms/dev/smoke.spec.js [baseUrl]
 *
 * baseUrl defaults to http://localhost:8000/various/bsp-forms/dev/index.html
 * Set CHROMIUM=/path/to/chrome to pin the browser executable.
 */
'use strict';
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8000/various/bsp-forms/dev/index.html';

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
    ['duplicate section id → error card', cfg => { cfg.pages[1].sections[1].id = cfg.pages[1].sections[0].id; }]
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

async function testFullFlow(browser) {
  console.log('full submit flow:');
  const page = await browser.newPage({ viewport: { width: 1100, height: 2600 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(BASE);
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
    'Current laptop is out of warranty and failing; needed for daily development work.');

  // date rules: warn (rush) then cross-field block, then fix
  const plus = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
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

  await page.click('[data-bspf-field="managerAware"] .switch');
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
    await testFullFlow(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nFAILED: ' + failures + ' check(s)' : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
