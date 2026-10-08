// DEV ONLY: the two lists forms/ps-zone-attestation.json uses, as a cross-site twin of prod — on
// the dev tenant's ROOT site, a different site collection from the test page (prod: the lists on
// /teams/FCUWebDatastores, the page on /sites/FCUPortal). Runs through the sp-env Playwright
// profile, because the cert app is scoped to the dev site only. Idempotent. Rows are seeded by
// live-zone.js (as the signed-in user, so the user filter has something to match).
//   PS_Zone-Attestation-Assignments  UserEmail (indexed) · UserDescription · AreaName (unique)
//   PS_Zone-Attestation-Responses    LookupID · UserName · UserEmail (indexed) · UserDescription ·
//                                    AreaName · ZoneSelection · Attestation · AttestationTime
// Responses gets the prod item-level setting: users see only their own items. (Prod also gives
// users Add + View without Edit there.)
//
//   node live-zone-lists.js --user <email>
// also gives that account three assignment rows (idempotent) and reports what it can do on the
// two lists and the test page's site — for testing as a non-admin. Which account is passed on the
// command line, never written here.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));

const text = (n, extra) => '<Field Type="Text" Name="' + n + '" StaticName="' + n + '" DisplayName="' + n + '" MaxLength="255" ' + (extra || '') + ' />';
const LISTS = {
  'PS_Zone-Attestation-Assignments': {
    fields: {
      UserEmail: text('UserEmail', 'Indexed="TRUE"'),
      UserDescription: text('UserDescription'),
      AreaName: text('AreaName', 'Indexed="TRUE" EnforceUniqueValues="TRUE"')
    }
  },
  'PS_Zone-Attestation-Responses': {
    readSecurity: 2, // read items created by the user
    fields: {
      LookupID: '<Field Type="Number" Name="LookupID" StaticName="LookupID" DisplayName="LookupID" Decimals="0" />',
      UserName: text('UserName'),
      UserEmail: text('UserEmail', 'Indexed="TRUE"'),
      UserDescription: text('UserDescription'),
      AreaName: text('AreaName'),
      ZoneSelection: text('ZoneSelection'),
      Attestation: text('Attestation'),
      AttestationTime: '<Field Type="DateTime" Name="AttestationTime" StaticName="AttestationTime" DisplayName="AttestationTime" Format="DateTime" />'
    }
  }
};

const ui = process.argv.indexOf('--user');
const SEED_USER = ui > -1 ? process.argv[ui + 1] : null;
if (ui > -1 && !/^[^\s@]+@[^\s@]+$/.test(SEED_USER || '')) { console.error('--user needs an email'); process.exit(1); }
const SEED_AREAS = ['Floor 4 — Client lounge (test user)', 'Floor 9 — Records room (test user)', 'Loading dock — North (test user)'];

(async () => {
  const root = tenants.dev.tenantRoot.replace(/\/$/, '');
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(root + '/_layouts/15/viewlsts.aspx', { waitUntil: 'domcontentloaded' });
  if (/login\./.test(page.url())) { console.log('auth_stale'); process.exit(3); }
  const out = await page.evaluate(async ({ root, LISTS, SEED_USER, SEED_AREAS, pageWeb }) => {
    const log = [];
    const J = 'application/json;odata=nometadata';
    const digest = (await (await fetch(root + '/_api/contextinfo', { method: 'POST', headers: { accept: J } })).json()).FormDigestValue;
    const H = { accept: J, 'content-type': J, 'X-RequestDigest': digest };
    for (const [name, spec] of Object.entries(LISTS)) {
      // by title: the form addresses these lists by title, and REST creation drops the hyphens
      // from the URL (/Lists/PS_ZoneAttestationAssignments)
      const listApi = root + "/_api/web/lists/getbytitle('" + encodeURIComponent(name) + "')";
      let r = await fetch(listApi + '?$select=Id', { headers: { accept: J } });
      if (r.status === 404) {
        r = await fetch(root + '/_api/web/lists', { method: 'POST', headers: H, body: JSON.stringify({ Title: name, BaseTemplate: 100 }) });
        if (!r.ok) throw new Error('create ' + name + ' ' + r.status + ' ' + await r.text());
        log.push('created ' + name);
      } else if (!r.ok) throw new Error('get ' + name + ' ' + r.status);
      const have = (await (await fetch(listApi + '/fields?$select=InternalName', { headers: { accept: J } })).json()).value.map(f => f.InternalName);
      for (const [f, xml] of Object.entries(spec.fields)) {
        if (have.includes(f)) continue;
        r = await fetch(listApi + '/fields/createfieldasxml', { method: 'POST', headers: H,
          body: JSON.stringify({ parameters: { SchemaXml: xml, Options: 8 } }) }); // 8 = AddFieldInternalNameHint
        if (!r.ok) throw new Error('field ' + f + ' ' + r.status + ' ' + await r.text());
        log.push('  added ' + name + '.' + f);
      }
      if (spec.readSecurity) {
        r = await fetch(listApi, { method: 'POST', headers: Object.assign({ 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }, H),
          body: JSON.stringify({ ReadSecurity: spec.readSecurity }) });
        if (!r.ok) throw new Error('ReadSecurity ' + r.status + ' ' + await r.text());
      }
      // read back what the form depends on
      const fs = (await (await fetch(listApi + '/fields?$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues&$filter=Hidden eq false and ReadOnlyField eq false', { headers: { accept: J } })).json()).value;
      const l = await (await fetch(listApi + '?$select=ReadSecurity', { headers: { accept: J } })).json();
      log.push(name + ' (ReadSecurity=' + l.ReadSecurity + '): ' + fs.filter(x => x.InternalName !== 'ContentType')
        .map(x => x.InternalName + '=' + x.TypeAsString + (x.Indexed ? '(idx)' : '') + (x.EnforceUniqueValues ? '(unique)' : '')).join(' '));
    }
    if (SEED_USER) {
      // assignment rows for the test account (by unique AreaName)
      const A = root + "/_api/web/lists/getbytitle('" + encodeURIComponent('PS_Zone-Attestation-Assignments') + "')";
      const have = (await (await fetch(A + '/items?$select=AreaName,UserEmail&$top=500', { headers: { accept: J } })).json()).value;
      for (const area of SEED_AREAS) {
        const hit = have.find(x => x.AreaName === area);
        if (hit) { log.push('seed row exists: ' + area + ' → ' + hit.UserEmail); continue; }
        const r = await fetch(A + '/items', { method: 'POST', headers: H,
          body: JSON.stringify({ Title: area, AreaName: area, UserEmail: SEED_USER, UserDescription: 'Dev test user (non-admin)' }) });
        if (!r.ok) throw new Error('seed ' + area + ' ' + r.status + ' ' + await r.text());
        log.push('seeded: ' + area + ' → ' + SEED_USER);
      }
      // what the account can do: its effective rights where the form needs them
      async function rights(web, listTitle) {
        const u = (await (await fetch(web + "/_api/web/siteusers?$select=LoginName&$filter=Email eq '" + SEED_USER.replace(/'/g, "''") + "'",
          { headers: { accept: J } })).json()).value || [];
        if (!u.length) return 'not a user of ' + web + ' (it has never been granted access or visited)';
        const at = listTitle ? web + "/_api/web/lists/getbytitle('" + encodeURIComponent(listTitle) + "')" : web + '/_api/web';
        const p = await (await fetch(at + "/GetUserEffectivePermissions(@u)?@u='" + encodeURIComponent(u[0].LoginName) + "'", { headers: { accept: J } })).json();
        const low = Number(p.Low || 0);
        const bits = [[1, 'view'], [2, 'add'], [4, 'edit'], [8, 'delete']].filter(b => low & b[0]).map(b => b[1]);
        return bits.length ? bits.join('+') : 'no item rights';
      }
      log.push('access for ' + SEED_USER + ':');
      log.push('  root web: ' + await rights(root));
      log.push('  Assignments: ' + await rights(root, 'PS_Zone-Attestation-Assignments') + '   (form needs: view)');
      log.push('  Responses:   ' + await rights(root, 'PS_Zone-Attestation-Responses') + '   (prod plan: view+add, own items)');
      log.push('  page site:   ' + await rights(pageWeb) + '   (needs: view — the page, engine and lib files live here)');
    }
    return log;
  }, { root, LISTS, SEED_USER, SEED_AREAS, pageWeb: tenants.dev.siteUrl.replace(/\/$/, '') });
  console.log(out.join('\n'));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(2); });
