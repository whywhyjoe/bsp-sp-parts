// Full tier: drives dev/admin-script-runner.dev.html (mock adapter) in headless
// Chromium through a forced run, the slot gate, and the error state. Serves the
// bsp-sp-parts root itself — no separate server needed.
// Run: node admin-script-runner/tests/smoke.mjs   (from anywhere)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH || path.join(homedir(), '.claude', 'skills', 'sp-env', 'scripts', 'node_modules', 'playwright');
const { chromium } = require(pwPath);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/dev/admin-script-runner.dev.html`;

let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  [' + detail + ']'));
  if (!ok) failures++;
};
const label = (page) => page.$eval('.asr-panel .progress__label', (n) => n.textContent).catch(() => '');

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const started = Date.now();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Forced run: panel appears, reaches Done, closes itself, Markdown saved.
  await page.goto(base + '?adminTasks=force', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.asr-panel', { state: 'attached', timeout: 10000 });
  await page.waitForFunction(() => /Done/.test(document.querySelector('.asr-panel .progress__label')?.textContent || ''), null, { timeout: 15000 });
  check('forced run reaches Done', true);
  check('both tasks listed and done', (await page.$$eval('.asr-task.is-done', (n) => n.length)) === 2, 'rows not done');
  check('button hidden when done', await page.$eval('.asr-panel .btn', (b) => getComputedStyle(b).display === 'none'), 'visible');
  await page.waitForSelector('.asr-panel', { state: 'detached', timeout: 6000 });
  check('panel closes itself', true);
  const md = await page.evaluate(() => Object.values(window.__ASR_MOCK_FILES__ || {})[0]?.text || '');
  check('markdown has groups and item links', /\n## Assigned To: /.test(md) && /- Item link: /.test(md), md.slice(0, 120));

  // 2. Slot gate: a plain load after a check in this slot does nothing — and
  //    fetches nothing (the decision comes from this browser's memory alone).
  await page.evaluate(() => {
    const now = Date.now();
    const schedule = { slots: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], until: 24 };   // always inside the window
    localStorage.setItem('adminScriptRunner.v2', JSON.stringify({ instances: {
      'sp-list-to-markdown|inline': { checked: now, schedule },
      'sp-list-to-markdown|harness-second': { checked: now, schedule }
    } }));
  });
  await page.addInitScript(() => {
    window.__fetches = 0;
    const f = window.fetch;
    window.fetch = function () { window.__fetches++; return f.apply(this, arguments); };
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Object.keys(window.adminScriptRunner?.status?.() || {}).length === 2, null, { timeout: 10000 });
  const st = await page.evaluate(() => Object.values(window.adminScriptRunner.status()).map((r) => r.detail));
  check('slot gate skips a second visit', st.every((d) => d === 'checked-this-slot') && !(await page.$('.asr-panel')), JSON.stringify(st));
  check('a skipped visit makes no request', (await page.evaluate(() => window.__fetches)) === 0, 'fetches happened');

  // 3. Cancel while running: Cancelled, nothing saved, both rows skipped, closes itself.
  await page.goto(base + '?adminTasks=force', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.asr-task.is-running', { timeout: 10000 });
  await page.click('.asr-panel .btn');
  await page.waitForSelector('.asr-panel.is-cancelled', { timeout: 10000 });
  check('cancel ends in the Cancelled state', (await label(page)) === 'Cancelled', await label(page));
  check('cancel saves nothing', (await page.evaluate(() => window.__ASR_MOCK_UPLOADS__ || 0)) === 0, 'uploaded');
  check('cancelled rows are marked skipped', (await page.$$eval('.asr-task.is-cancelled', (n) => n.length)) === 2, 'rows');
  await page.waitForSelector('.asr-panel', { state: 'detached', timeout: 6000 });
  check('cancelled panel closes itself', true);

  // 4. Cancel while a failing save is in flight: the error still gets a working Close.
  await page.goto(base + '?adminTasks=force', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.__ASR_MOCK_FAIL__ = true; });
  await page.waitForFunction(() => /^Saving/.test(document.querySelector('.asr-panel__status')?.textContent || ''), null, { timeout: 15000 });
  await page.click('.asr-panel .btn');
  await page.waitForSelector('.asr-panel.is-error', { timeout: 10000 });
  check('failure after cancel shows the error state', (await label(page)) === 'Finished with errors', await label(page));
  check('its Close button is enabled', await page.$eval('.asr-panel .btn', (b) => b.textContent === 'Close' && !b.disabled), 'disabled');
  await page.click('.asr-panel .btn');
  await page.waitForSelector('.asr-panel', { state: 'detached', timeout: 3000 });
  check('Close dismisses the error panel', true);

  // 5. Error state on its own: stays open with Close.
  await page.goto(base + '?adminTasks=force', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.__ASR_MOCK_FAIL__ = true; });
  await page.waitForSelector('.asr-panel.is-error', { timeout: 15000 });
  check('failure shows the error state', (await label(page)) === 'Finished with errors', await label(page));
  check('error state offers Close', (await page.$eval('.asr-panel .btn', (b) => b.textContent)) === 'Close', 'no Close');

  // 6. The list changes during an export: that instance exports again.
  await page.goto(base + '?adminTasks=force', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.__ASR_MOCK_EDIT_DURING_EXPORT__ = true; });
  await page.waitForSelector('.asr-panel.is-done', { timeout: 20000 });
  const first = await page.evaluate(() => window.adminScriptRunner.status()['sp-list-to-markdown|inline']);
  check('a mid-export change triggers one re-export', first && first.detail && first.detail.attempts === 2, JSON.stringify(first));

  // 7. A task script that loads after the runner: its hosts wait for it and run.
  await page.goto(base + '?adminTasks=force&lateTask=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.asr-panel.is-done', { timeout: 20000 });
  check('late-registered task still runs', (await page.$$eval('.asr-task.is-done', (n) => n.length)) === 2, 'rows');

  // 8. No working browser storage: nothing runs automatically.
  const blocked = await browser.newPage();
  blocked.on('pageerror', (e) => errors.push(e.message));
  await blocked.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
  await blocked.goto(base, { waitUntil: 'domcontentloaded' });
  await blocked.waitForFunction(() => Object.keys(window.adminScriptRunner?.status?.() || {}).length === 2, null, { timeout: 10000 });
  const nb = await blocked.evaluate(() => Object.values(window.adminScriptRunner.status()).map((r) => r.detail));
  check('no storage → no automatic run', nb.every((d) => d === 'no-storage') && !(await blocked.$('.asr-panel')), JSON.stringify(nb));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failures ? 'FAIL' : 'PASS'} — ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
