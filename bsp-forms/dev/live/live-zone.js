// DEV ONLY: drive the live zone attestation form (page from
//   live-page.ps1 -PageName bsp-forms-zone-attestation-test -Config ps-zone-attestation.json)
// end to end and read the saved rows back via REST. Lists come from live-zone-lists.js: a cross-site
// twin of prod on the tenant ROOT site (prod: /teams/FCUWebDatastores), the page on the dev site.
// Each run, as the signed-in test user: recycles that user's earlier responses, makes sure the
// assignment rows exist (three for this user — one stored with different email casing, names with
// an apostrophe and accents — plus one for someone else, which the form must not show), then:
//   EN submit of all three → read back → reload shows "already submitted" →
//   one response recycled → FR shows only that row → FR submit saves the English value.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));
const OUT = process.env.BSPF_OUT || os.tmpdir();
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')); }

const SITE = tenants.dev.siteUrl.replace(/\/$/, '');
const PAGE = SITE + '/SitePages/bsp-forms-zone-attestation-test.aspx';
const ROOT = tenants.dev.tenantRoot.replace(/\/$/, '');
const listApi = name => ROOT + "/_api/web/lists/getbytitle('" + encodeURIComponent(name) + "')";
const A = listApi('PS_Zone-Attestation-Assignments');
const R = listApi('PS_Zone-Attestation-Responses');
const MINE = ['Floor 2 — Trading floor', "Floor 7 — D'Arcy executive suite", 'Parking P1 — Entrée sud'];
const OTHER = 'Data centre — Hall B (not yours)';

// REST helpers, run in the page as the signed-in user
async function rest(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const J = 'application/json;odata=nometadata';
    const h = { accept: J };
    if (method !== 'GET') {
      const ci = await (await fetch(url.split('/_api/')[0] + '/_api/contextinfo', { method: 'POST', headers: { accept: J } })).json();
      h['X-RequestDigest'] = ci.FormDigestValue;
      if (body) h['content-type'] = J;
    }
    const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + t.slice(0, 300));
    return t ? JSON.parse(t) : null;
  }, { method, url, body });
}
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

async function open(ctx, qs) {
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => { if (e.message && e.message !== 'undefined') page.__errors.push(e.message); });
  await page.goto(PAGE + (qs || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bsp-form][data-bspf-state="ready"]', { timeout: 60000 });
  await page.waitForFunction(() => {
    const d = Object.values(window.BSPForms._defs).pop();
    const s = d && d.store.state;
    return s && s.asg.state !== 'loading' && s.asg.state !== 'idle';
  }, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return page;
}
async function pick(page, label, zone) {
  await page.evaluate(async ({ label, zone }) => {
    const row = [...document.querySelectorAll('.bspf-asg__row')].find(r => r.querySelector('.bspf-asg__label').textContent === label);
    row.querySelector('[role="combobox"]').click();
    await new Promise(x => setTimeout(x, 80));
    [...row.querySelectorAll('.bspf-combo__option')].find(b => b.innerText.trim() === zone).click();
  }, { label, zone });
  await page.waitForTimeout(120);
}
async function clickBtn(page, text) {
  await page.waitForTimeout(150);
  await page.evaluate(t => {
    const b = [...document.querySelectorAll('.bspf button')].find(x => x.textContent.trim().startsWith(t) && x.offsetParent !== null);
    if (!b) throw new Error('no visible button ' + t);
    b.click();
  }, text);
}
async function submitAndConfirm(page, confirmText) {
  await page.locator('[data-bspf-field="attestation"] input').check();
  await clickBtn(page, (await page.locator('.bspf button[type="submit"]').textContent()).trim());
  await page.waitForSelector('.bspf-dialog', { state: 'visible', timeout: 5000 });
  await clickBtn(page, confirmText);
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 30000 });
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true, viewport: { width: 1200, height: 1100 } });
  let page = await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  const me = await rest(page, 'GET', SITE + '/_api/web/currentuser?$select=Title,Email');
  console.log('test user:', me.Title);

  // ---- arrange: clean responses, ensure assignments
  const mine = await rest(page, 'GET', R + '/items?$select=Id&$top=500&$filter=UserEmail eq ' + q(me.Email));
  for (const it of mine.value) await rest(page, 'POST', R + '/items(' + it.Id + ')/recycle()');
  console.log('recycled earlier responses:', mine.value.length);
  const rows = (await rest(page, 'GET', A + '/items?$select=Id,AreaName,UserEmail&$top=500')).value;
  const ids = {};
  const want = MINE.map((n, i) => ({ AreaName: n, UserEmail: i === 0 ? me.Email.toUpperCase() : me.Email, UserDescription: 'Live test — branch lead' }))
    .concat([{ AreaName: OTHER, UserEmail: 'someone.else@example.invalid', UserDescription: 'Facilities' }]);
  for (const w of want) {
    const hit = rows.find(r => r.AreaName === w.AreaName);
    if (hit) { ids[w.AreaName] = hit.Id; continue; }
    const made = await rest(page, 'POST', A + '/items', Object.assign({ Title: w.AreaName }, w));
    ids[w.AreaName] = made.Id;
    console.log('seeded assignment:', w.AreaName);
  }
  await page.close();

  // ---- EN: load, doctor, rows, submit
  page = await open(ctx);
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.$$eval('.bspf-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  console.log('DOCTOR:\n' + doctor.map(r => '  ' + r.join(' | ')).join('\n'));
  check('doctor: every target + source column OK', doctor.length >= 12 && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; '));
  await page.evaluate(() => { const d = document.querySelector('.bspf-doctor'); if (d) d.remove(); });
  const labels = await page.$$eval('.bspf-asg__label', els => els.map(e => e.textContent));
  check('my three rows shown (incl. the upper-cased email row), sorted', JSON.stringify(labels) === JSON.stringify(MINE.slice().sort()), JSON.stringify(labels));
  check("someone else's row not shown", !labels.includes(OTHER));
  check('Attestation by: my name + email', (await page.locator('.bspf-who__name').textContent()) === me.Title &&
    (await page.locator('.bspf-who__mail').textContent()).toLowerCase() === me.Email.toLowerCase());
  check('job aid card → configured URL, new tab', (await page.locator('a.bspf-tipcard').getAttribute('href')) === SITE &&
    (await page.locator('a.bspf-tipcard').getAttribute('target')) === '_blank');
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-form-empty.png') });
  await pick(page, MINE[0], 'Green');
  await pick(page, MINE[1], 'Yellow');
  await pick(page, MINE[2], 'Orange');
  await page.locator('[data-bspf-field="attestation"] input').check();
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-form-filled.png') });
  const before = Date.now();
  await clickBtn(page, 'Submit attestation');
  await page.waitForSelector('.bspf-dialog', { state: 'visible', timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, 'zone-confirm.png') });
  await clickBtn(page, 'Confirm');
  await page.waitForSelector('.bspf-done:not(.bspf-done--empty):not(.bspf-done--allDone)', { state: 'visible', timeout: 30000 });
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-done.png') });
  check('no page errors (EN)', !page.__errors.length, page.__errors.join(' | '));

  // ---- read back
  const sel = '$select=Id,Title,LookupID,UserName,UserEmail,UserDescription,AreaName,ZoneSelection,Attestation,AttestationTime';
  let saved = (await rest(page, 'GET', R + '/items?' + sel + '&$top=50&$orderby=Id&$filter=UserEmail eq ' + q(me.Email))).value;
  console.log('SAVED:', JSON.stringify(saved, null, 1));
  check('three responses saved', saved.length === 3, saved.length);
  const by = Object.fromEntries(saved.map(s => [s.AreaName, s]));
  check('LookupID = the assignment item ID', MINE.every(n => by[n] && by[n].LookupID === ids[n]));
  check('ZoneSelection per row', by[MINE[0]].ZoneSelection === 'Green' && by[MINE[1]].ZoneSelection === 'Yellow' && by[MINE[2]].ZoneSelection === 'Orange');
  check('UserName / UserEmail / UserDescription / Attestation', saved.every(s => s.UserName === me.Title && s.UserEmail === me.Email &&
    s.UserDescription === 'Live test — branch lead' && s.Attestation === 'Confirmed'));
  const t = saved.map(s => Date.parse(s.AttestationTime));
  check('AttestationTime = the submit instant (all rows equal, within the run)', t.every(x => x === t[0]) && t[0] >= before - 60000 && t[0] <= Date.now() + 60000,
    saved[0] && saved[0].AttestationTime);
  check('Title from the template', by[MINE[1]].Title === MINE[1] + ' — ' + me.Email, by[MINE[1]].Title);
  await page.close();

  // ---- reload → already submitted
  page = await open(ctx);
  // the retry's exact check (getRowKeysFor), against the real list: a Number
  // key column, numbers sent unquoted, the user filter AND-ed with the keys
  const probe = MINE.map(n => ids[n]).concat([987654]);
  const found = await page.evaluate(async ({ probe, email }) => {
    const d = Object.values(window.BSPForms._defs).pop();
    return d.adapter.getRowKeysFor({ userColumn: 'UserEmail', keyColumn: 'LookupID' }, [email.toLowerCase()], probe);
  }, { probe, email: me.Email });
  check('retry check (getRowKeysFor) finds exactly my saved keys', JSON.stringify(found.map(Number).sort((a, b) => a - b)) ===
    JSON.stringify(MINE.map(n => ids[n]).sort((a, b) => a - b)), JSON.stringify(found));
  check('reload → "already submitted" screen, no form', await page.locator('.bspf-done--allDone').isVisible() && !(await page.locator('form.bspf__body').isVisible()));
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-alldone.png') });
  await rest(page, 'POST', R + '/items(' + by[MINE[1]].Id + ')/recycle()');
  await page.close();

  // ---- FR: only the reopened row; French UI; English value saved
  page = await open(ctx, '?lang=fr');
  check('FR: French title + headers', (await page.locator('.bspf__title').textContent()) === 'Attestation des zones de sécurité physique' &&
    /zone de sécurité physique/i.test(await page.locator('.bspf-asg__head').textContent()));
  const frLabels = await page.$$eval('.bspf-asg__label', els => els.map(e => e.textContent));
  check('FR: only the reopened row, plus the "already attested" note', JSON.stringify(frLabels) === JSON.stringify([MINE[1]]) &&
    /2 de vos emplacements/.test(await page.locator('[data-bspf-field="zones"]').textContent()), JSON.stringify(frLabels));
  check('FR: form root lang="fr"', (await page.getAttribute('.bspf', 'lang')) === 'fr');
  await pick(page, MINE[1], 'Rouge');
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-form-fr.png') });
  await submitAndConfirm(page, 'Confirmer');
  check('FR: confirmation in French', /Merci/.test(await page.locator('.bspf-done:visible').textContent()));
  check('no page errors (FR)', !page.__errors.length, page.__errors.join(' | '));
  saved = (await rest(page, 'GET', R + '/items?' + sel + '&$top=50&$orderby=Id&$filter=UserEmail eq ' + q(me.Email))).value;
  const fr = saved.find(s => s.AreaName === MINE[1]);
  check('FR submit saved the English value "Red"', fr && fr.ZoneSelection === 'Red' && saved.length === 3, fr && fr.ZoneSelection);
  await page.close();

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${OUT}`);
  await ctx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
