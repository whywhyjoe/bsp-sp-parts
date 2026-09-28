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

  // 2. Slot gate: a plain load after a check in this slot does nothing.
  // The harness carries two instances; stamp both as checked in this slot.
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('adminScriptRunner.v1', JSON.stringify({ checked: { 'sp-list-to-markdown|inline': now, 'sp-list-to-markdown|harness-second': now } }));
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Object.keys(window.adminScriptRunner?.status?.() || {}).length === 2, null, { timeout: 10000 });
  const st = await page.evaluate(() => Object.values(window.adminScriptRunner.status()).map((r) => r.outcome));
  check('slot gate skips a second visit', st.every((o) => o === 'skipped') && !(await page.$('.asr-panel')), JSON.stringify(st));

  // 3. Error state: stays open with a Close button.
  await page.goto(base + '?adminTasks=force', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.__ASR_MOCK_FAIL__ = true; });
  await page.waitForFunction(() => /errors/.test(document.querySelector('.asr-panel .progress__label')?.textContent || ''), null, { timeout: 15000 });
  check('failure shows the error state', (await label(page)) === 'Finished with errors', await label(page));
  check('error state offers Close', (await page.$eval('.asr-panel .btn', (b) => b.textContent)) === 'Close', 'no Close');

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failures ? 'FAIL' : 'PASS'} — ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
