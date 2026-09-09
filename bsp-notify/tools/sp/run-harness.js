// DEV-ONLY: drives the harness page in Playwright (persistent profile), runs a
// named op script, waits for completion, and verifies the closed loop: the
// harness result must correlate with a TestRuns row carrying the SAME runId,
// read back via REST. Exit 0 requires op passed AND its own row found with
// Passed=true — an uncorrelated "latest rows" readback proves nothing.
// Usage: node run-harness.js <op>   (op: provision | verify | test-smoke | any op .js)
'use strict';
const path = require('path');
const os = require('os');
const { loadAndResolve } = require('./resolve');

const repo = path.resolve(__dirname, '..', '..');
const op = process.argv[2];
if (!op) { console.error('usage: node run-harness.js <op>  e.g. provision | verify | test-smoke'); process.exit(2); }
const opFile = op.endsWith('.js') ? op : op + '.js';
const timeoutMs = Number(process.env.SP_ENV_HARNESS_TIMEOUT || 120000);

const skillScripts = path.join(os.homedir(), '.claude', 'skills', 'sp-env', 'scripts');
const { chromium } = require(path.join(skillScripts, 'node_modules', 'playwright'));

(async () => {
  const resolved = loadAndResolve(repo);
  if (resolved.env !== 'dev') {
    throw new Error('run-harness.js is DEV-ONLY (env.local.json says "' + resolved.env + '"). On prod, a human runs the harness ops in the browser.');
  }
  const profileDir = path.join(os.homedir(), '.claude', 'skills', 'sp-env', 'auth', 'pw-profile');
  const url = resolved.pages.harness.url + '?run=' + encodeURIComponent(opFile) + '&auto=1';

  const ctx = await chromium.launchPersistentContext(profileDir, { headless: true });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let out;
  try {
    // The persistent profile's disk cache happily serves stale harness/op
    // scripts after a redeploy. Routing every request disables the HTTP cache
    // for this page (a documented Playwright side effect) — freshness beats
    // cache here, the harness is a test surface.
    await page.route('**/*', (r) => r.continue());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/login\.microsoftonline\.com/.test(page.url())) {
      throw new Error('AUTH-STALE: login redirect — run sp-env auth-refresh.ps1 and retry.');
    }
    // The done marker is an EMPTY zero-size div — it is never 'visible', so the
    // default wait would time out even when the op succeeded (a false-negative
    // verifier, found live in the pilot). Wait for DOM attachment instead.
    await page.waitForSelector('#sp-env-harness-done', { state: 'attached', timeout: timeoutMs });
    const result = await page.evaluate(() => window.__spEnvResult);
    const rows = await page.evaluate(async (site) => {
      const r = await fetch(site + "/_api/web/lists/getbytitle('TestRuns')/items?$select=Id,Title,Suite,Passed,Results,GitSha,Created&$orderby=Id desc&$top=10",
        { headers: { accept: 'application/json;odata=nometadata' }, credentials: 'include' });
      if (!r.ok) return { error: 'TestRuns read failed: HTTP ' + r.status };
      return (await r.json()).value;
    }, resolved.siteUrl);

    // Correlate: find OUR row by runId, never just "the latest".
    let myRow = null, verdictReason = '';
    if (!result) { verdictReason = 'no harness result published'; }
    else if (Array.isArray(rows)) {
      myRow = rows.find((r) => result.runId && typeof r.Title === 'string' && r.Title.indexOf('#' + result.runId) >= 0) || null;
      if (!myRow) { verdictReason = 'no TestRuns row found for runId ' + result.runId; }
      else if (myRow.Passed !== true) { verdictReason = 'TestRuns row for this run has Passed=' + myRow.Passed; }
      else if (result.passed !== true) { verdictReason = 'op reported failure'; }
    } else { verdictReason = (rows && rows.error) || 'TestRuns readback failed'; }

    const verified = result && result.passed === true && myRow && myRow.Passed === true;
    out = { op: opFile, verified: verified, verdictReason: verified ? 'op passed and its own TestRuns row read back' : verdictReason, harnessResult: result, correlatedRow: myRow, latestRows: Array.isArray(rows) ? rows.slice(0, 5) : rows };
    console.log('RUN-HARNESS-RESULT ' + JSON.stringify(out, null, 2));
  } finally {
    await ctx.close().catch(() => {});
  }
  process.exit(out && out.verified === true ? 0 : 1);
})().catch((e) => {
  console.error('RUN-HARNESS-FAIL ' + String(e && e.message ? e.message : e));
  process.exit(1);
});
