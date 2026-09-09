// DEV-ONLY: drives push-mode deploy — opens the harness with the upload op in
// Playwright, feeds it the staged files, submits, and reads the result back.
// Called by deploy.ps1 -Mode push (which prepares the staging dir).
// Usage: node push-deploy.js --staging <dir> [--note "text"]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadAndResolve } = require('./resolve');

const repo = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
function argOf(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const staging = argOf('--staging');
const note = argOf('--note', '');
if (!staging || !fs.existsSync(staging)) { console.error('usage: node push-deploy.js --staging <dir> [--note "text"]'); process.exit(2); }
const timeoutMs = Number(process.env.SP_ENV_HARNESS_TIMEOUT || 180000);

const skillScripts = path.join(os.homedir(), '.claude', 'skills', 'sp-env', 'scripts');
const { chromium } = require(path.join(skillScripts, 'node_modules', 'playwright'));

(async () => {
  const resolved = loadAndResolve(repo);
  if (resolved.env !== 'dev') { throw new Error('push-deploy.js is dev-only (prod humans run the upload op in the harness).'); }
  const entries = fs.readdirSync(staging);
  const dirs = entries.filter((f) => fs.statSync(path.join(staging, f)).isDirectory());
  if (dirs.length) { throw new Error('push mode is FLAT-only (browser file inputs cannot carry folder structure); staging contains subdirectories: ' + dirs.join(', ') + ' — use copy mode.'); }
  const files = entries.map((f) => path.join(staging, f));
  if (!files.length) { throw new Error('staging dir is empty: ' + staging); }

  const profileDir = path.join(os.homedir(), '.claude', 'skills', 'sp-env', 'auth', 'pw-profile');
  const url = resolved.pages.harness.url + '?run=upload.js';
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: true });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let out;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/login\.microsoftonline\.com/.test(page.url())) {
      throw new Error('AUTH-STALE: login redirect — run sp-env auth-refresh.ps1 and retry.');
    }
    await page.waitForSelector('#sp-env-upload-input', { state: 'attached', timeout: 60000 });
    await page.setInputFiles('#sp-env-upload-input', files);
    await page.fill('#sp-env-upload-note', note);
    await page.click('#sp-env-upload-go');
    await page.waitForSelector('#sp-env-harness-done', { state: 'attached', timeout: timeoutMs });
    out = await page.evaluate(() => window.__spEnvResult);
    // Completeness: every staged file must appear in the uploaded list —
    // "some files uploaded" must never read as DEPLOY-OK.
    const staged = files.map((f) => path.basename(f));
    const uploaded = (out && out.results && out.results.uploaded) || [];
    const missing = staged.filter((n) => uploaded.indexOf(n) < 0);
    if (missing.length) {
      out = Object.assign({}, out, { passed: false, results: Object.assign({}, out && out.results, { missingFromUpload: missing }) });
    }
    console.log('PUSH-DEPLOY-RESULT ' + JSON.stringify(out, null, 2));
  } finally {
    await ctx.close().catch(() => {});
  }
  process.exit(out && out.passed === true ? 0 : 1);
})().catch((e) => {
  console.error('PUSH-DEPLOY-FAIL ' + String(e && e.message ? e.message : e));
  process.exit(1);
});
