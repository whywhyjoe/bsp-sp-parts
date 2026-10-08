// DEV ONLY: the two lists forms/ps-zone-attestation.json uses, as a cross-site twin of prod — on
// the dev tenant's ROOT site, a different site collection from the test page (prod: the lists on
// /teams/FCUWebDatastores, the page on /sites/FCUPortal). Runs through the sp-env Playwright
// profile, because the cert app is scoped to the dev site only. Idempotent. Rows are seeded by
// live-zone.js (as the signed-in user, so the user filter has something to match).
//   PS_Zone-Attestation-Assignments  UserEmail (indexed) · UserDescription · AreaName (unique)
//   PS_Zone-Attestation-Responses    LookupID · UserName · UserEmail (indexed) · UserDescription ·
//                                    AreaName · ZoneSelection · Attestation · AttestationTime
// Responses gets the prod item-level setting: users see only their own items. (Prod also gives
// users Add + View without Edit there; dev runs as an admin, so that part isn't simulated.)
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

(async () => {
  const root = tenants.dev.tenantRoot.replace(/\/$/, '');
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(root + '/_layouts/15/viewlsts.aspx', { waitUntil: 'domcontentloaded' });
  if (/login\./.test(page.url())) { console.log('auth_stale'); process.exit(3); }
  const out = await page.evaluate(async ({ root, LISTS }) => {
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
    return log;
  }, { root, LISTS });
  console.log(out.join('\n'));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(2); });
