// DEV ONLY: drive the live zone attestation form (page from
//   live-page.ps1 -PageName bsp-forms-zone-attestation-test -Config ps-zone-attestation.json)
// end to end and read the saved rows back via REST. Lists come from live-zone-lists.js: a cross-site
// twin of prod on the tenant ROOT site (prod: /teams/FCUWebDatastores), the page on the dev site.
// Each run, as the signed-in test user: recycles that user's earlier responses, makes sure the
// assignment rows exist (three for this user — one stored with different email casing, names with
// an apostrophe and accents — plus one for someone else, which the form must not show), then:
//   EN submit of all three → read back → reload shows "already submitted" →
//   one response recycled → FR shows only that row → FR submit saves the English value.
//
//   node live-zone.js --as <profile>   run the FORM as a non-admin: the Playwright profile
//     <sp-env>/auth/<profile>, signed in once by hand. Arranging, recycling and read-back stay on
//     the admin profile (the test user can't delete or seed, by design); that user's rows must exist
//     (live-zone-lists.js --user <email>) and its rights come from live-zone-perms.js. Adds checks
//     that the user sees only its own responses, can't edit one, and can't add to the lookup list.
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
const asIx = process.argv.indexOf('--as');
const AS = asIx > -1 ? process.argv[asIx + 1] : null;
if (asIx > -1 && !/^[\w-]+$/.test(AS || '')) { console.error('--as needs a profile folder name under sp-env/auth'); process.exit(1); }

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
  const VIEW = { headless: true, viewport: { width: 1200, height: 1100 } };
  const adminCtx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), VIEW);
  // the form runs in ctx: the admin profile, or the --as profile
  const ctx = AS ? await chromium.launchPersistentContext(path.join(SPENV, 'auth', AS), VIEW) : adminCtx;
  const admin = await adminCtx.newPage();
  await admin.goto(SITE, { waitUntil: 'domcontentloaded' });
  // both tabs may bounce through login.microsoftonline.com first; REST from a
  // tab still on the login host goes out without SharePoint's cookies (403)
  const onSite = u => u.hostname === new URL(SITE).hostname;
  await admin.waitForURL(onSite, { timeout: 30000 }).catch(() => {});
  let page = await ctx.newPage(); // the form's own tab, never the admin REST tab
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  // a profile whose SharePoint cookies were session-only signs in again silently
  // through login.microsoftonline.com (its persistent sign-in) — wait out that bounce
  await page.waitForURL(onSite, { timeout: 30000 }).catch(() => {});
  if (!onSite(new URL(admin.url()))) { console.log('auth_stale: sign in to the admin profile again'); process.exit(3); }
  if (/login\./.test(page.url())) { console.log('auth_stale: sign in to the ' + (AS || 'admin') + ' profile again'); process.exit(3); }
  const me = await rest(page, 'GET', SITE + '/_api/web/currentuser?$select=Title,Email');
  console.log('test user:', me.Title, AS ? '(non-admin profile ' + AS + ')' : '');

  // ---- arrange (as admin): clean responses, ensure assignments
  const mine = await rest(admin, 'GET', R + '/items?$select=Id&$top=500&$filter=UserEmail eq ' + q(me.Email));
  for (const it of mine.value) await rest(admin, 'POST', R + '/items(' + it.Id + ')/recycle()');
  console.log('recycled earlier responses:', mine.value.length);
  const rows = (await rest(admin, 'GET', A + '/items?$select=Id,AreaName,UserEmail,UserDescription&$top=500')).value;
  const ids = {}, desc = {};
  if (AS) {
    // the non-admin's rows are seeded by live-zone-lists.js --user; use whatever is there
    MINE.length = 0;
    rows.filter(r => String(r.UserEmail).toLowerCase() === me.Email.toLowerCase())
      .forEach(r => { MINE.push(r.AreaName); ids[r.AreaName] = r.Id; desc[r.AreaName] = r.UserDescription; });
    if (MINE.length < 2) { console.log('need at least 2 assignment rows for ' + me.Email + ' — run live-zone-lists.js --user'); process.exit(1); }
    MINE.sort();
  } else {
    const want = MINE.map((n, i) => ({ AreaName: n, UserEmail: i === 0 ? me.Email.toUpperCase() : me.Email, UserDescription: 'Live test — branch lead' }))
      .concat([{ AreaName: OTHER, UserEmail: 'someone.else@example.invalid', UserDescription: 'Facilities' }]);
    for (const w of want) {
      const hit = rows.find(r => r.AreaName === w.AreaName);
      if (hit) { ids[w.AreaName] = hit.Id; desc[w.AreaName] = hit.UserDescription; continue; }
      const made = await rest(admin, 'POST', A + '/items', Object.assign({ Title: w.AreaName }, w));
      ids[w.AreaName] = made.Id; desc[w.AreaName] = w.UserDescription;
      console.log('seeded assignment:', w.AreaName);
    }
  }
  const others = rows.filter(r => String(r.UserEmail).toLowerCase() !== me.Email.toLowerCase()).map(r => r.AreaName);
  await page.close();

  // ---- EN: load, doctor, rows, submit
  page = await open(ctx);
  await page.waitForFunction(() => { const d = document.querySelector('.bspf-doctor'); return d && (d.querySelector('tbody tr') || d.querySelector('.msgbar--danger')); }, null, { timeout: 30000 });
  const doctor = await page.$$eval('.bspf-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  console.log('DOCTOR:\n' + doctor.map(r => '  ' + r.join(' | ')).join('\n'));
  check('doctor: every target + source column OK', doctor.length >= 12 && doctor.every(r => r[4] === 'OK'), doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; '));
  await page.evaluate(() => { const d = document.querySelector('.bspf-doctor'); if (d) d.remove(); });
  const labels = await page.$$eval('.bspf-asg__label', els => els.map(e => e.textContent));
  check('my ' + MINE.length + ' rows shown' + (AS ? '' : ' (incl. the upper-cased email row)') + ', sorted', JSON.stringify(labels) === JSON.stringify(MINE.slice().sort()), JSON.stringify(labels));
  check("nobody else's rows shown", others.length > 0 && !labels.some(l => others.includes(l)));
  check('Attestation by: my name + email', (await page.locator('.bspf-who__name').textContent()) === me.Title &&
    (await page.locator('.bspf-who__mail').textContent()).toLowerCase() === me.Email.toLowerCase());
  check('job aid card → configured URL, new tab', (await page.locator('a.bspf-tipcard').getAttribute('href')) === SITE &&
    (await page.locator('a.bspf-tipcard').getAttribute('target')) === '_blank');
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-form-empty.png') });
  const ZONES = ['Green', 'Yellow', 'Orange', 'Red'];
  for (let i = 0; i < MINE.length; i++) await pick(page, MINE[i], ZONES[i % 4]);
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
  let saved = (await rest(admin, 'GET', R + '/items?' + sel + '&$top=50&$orderby=Id&$filter=UserEmail eq ' + q(me.Email))).value;
  console.log('SAVED:', JSON.stringify(saved, null, 1));
  check(MINE.length + ' responses saved', saved.length === MINE.length, saved.length);
  const by = Object.fromEntries(saved.map(s => [s.AreaName, s]));
  check('LookupID = the assignment item ID', MINE.every(n => by[n] && by[n].LookupID === ids[n]));
  check('ZoneSelection per row', MINE.every((n, i) => by[n] && by[n].ZoneSelection === ZONES[i % 4]));
  check('UserName / UserEmail / UserDescription / Attestation', saved.every(s => s.UserName === me.Title && s.UserEmail === me.Email &&
    s.UserDescription === desc[s.AreaName] && s.Attestation === 'Confirmed'));
  if (AS) {
    // the permission plan, as the non-admin: own items only, no edit, lookup read-only
    const seen = (await rest(page, 'GET', R + '/items?$select=Id,UserEmail&$top=500')).value;
    check('non-admin sees only its own responses', seen.length === MINE.length && seen.every(x => x.UserEmail === me.Email),
      seen.length + ' visible');
    const post = (url, body, merge) => page.evaluate(async ({ url, body, merge, site }) => {
      const J = 'application/json;odata=nometadata';
      const ci = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: { accept: J } })).json();
      const h = { accept: J, 'content-type': J, 'X-RequestDigest': ci.FormDigestValue };
      if (merge) { h['X-HTTP-Method'] = 'MERGE'; h['IF-MATCH'] = '*'; }
      return (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) })).status;
    }, { url, body, merge, site: ROOT });
    const edit = await post(R + '/items(' + saved[0].Id + ')', { ZoneSelection: 'Green' }, true);
    check('non-admin cannot edit its own response (Add + View, no Edit)', edit === 401 || edit === 403, 'HTTP ' + edit);
    const add = await post(A + '/items', { Title: 'should not exist', AreaName: 'should not exist ' + Date.now() }, false);
    check('non-admin cannot add to the lookup list', add === 401 || add === 403, 'HTTP ' + add);
    const after = (await rest(admin, 'GET', R + '/items?' + sel + '&$top=50&$filter=UserEmail eq ' + q(me.Email))).value;
    check('…and the response is unchanged', after.find(x => x.Id === saved[0].Id).ZoneSelection === saved[0].ZoneSelection);
  }
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
  await rest(admin, 'POST', R + '/items(' + by[MINE[1]].Id + ')/recycle()');
  await page.close();

  // ---- FR: only the reopened row; French UI; English value saved
  page = await open(ctx, '?lang=fr');
  check('FR: French title + headers', (await page.locator('.bspf__title').textContent()) === 'Attestation des zones de sécurité physique' &&
    /zone de sécurité physique/i.test(await page.locator('.bspf-asg__head').textContent()));
  const frLabels = await page.$$eval('.bspf-asg__label', els => els.map(e => e.textContent));
  check('FR: only the reopened row, plus the "already attested" note', JSON.stringify(frLabels) === JSON.stringify([MINE[1]]) &&
    new RegExp((MINE.length - 1) + ' de vos emplacements').test(await page.locator('[data-bspf-field="zones"]').textContent()), JSON.stringify(frLabels));
  check('FR: form root lang="fr"', (await page.getAttribute('.bspf', 'lang')) === 'fr');
  await pick(page, MINE[1], 'Rouge');
  await page.locator('.bspf').screenshot({ path: path.join(OUT, 'zone-form-fr.png') });
  await submitAndConfirm(page, 'Confirmer');
  check('FR: confirmation in French', /Merci/.test(await page.locator('.bspf-done:visible').textContent()));
  check('no page errors (FR)', !page.__errors.length, page.__errors.join(' | '));
  saved = (await rest(admin, 'GET', R + '/items?' + sel + '&$top=50&$orderby=Id&$filter=UserEmail eq ' + q(me.Email))).value;
  const fr = saved.find(s => s.AreaName === MINE[1]);
  check('FR submit saved the English value "Red"', fr && fr.ZoneSelection === 'Red' && saved.length === MINE.length, fr && fr.ZoneSelection);
  await page.close();

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${OUT}`);
  if (AS) await ctx.close();
  await adminCtx.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
