// DEV ONLY: copy the zone lists' permission setup from the dev site (where it was set up by hand,
// on the first copies of the lists) onto the cross-site twin on the tenant ROOT site
// (live-zone-lists.js), so a non-admin can test the form the way prod will run it.
// Mirrors, idempotently:
//   - the custom permission level LEVEL (same rights: View + Add Items, Open, View Pages — no Edit)
//   - the site group GROUP, with the same members as the dev site's group
//   - both lists: unique permissions (copied first, so owners keep Full Control); Members and
//     GROUP get Read on Assignments and LEVEL on Responses (no Contribute anywhere); Responses keeps
//     "read own items" and gets "create/edit own items"
// Members are read from the dev site's group at run time; no account is written here.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));

const LEVEL = 'View and Add';
const GROUP = 'PSZoneTestGroup';
const LISTS = { 'PS_Zone-Attestation-Assignments': 'Read', 'PS_Zone-Attestation-Responses': LEVEL };

(async () => {
  const root = tenants.dev.tenantRoot.replace(/\/$/, '');
  const from = tenants.dev.siteUrl.replace(/\/$/, '');
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(root + '/_layouts/15/viewlsts.aspx', { waitUntil: 'domcontentloaded' });
  if (/login\./.test(page.url())) { console.log('auth_stale'); process.exit(3); }
  const out = await page.evaluate(async ({ root, from, LEVEL, GROUP, LISTS }) => {
    const log = [];
    const N = 'application/json;odata=nometadata', V = 'application/json;odata=verbose';
    async function call(method, url, body, verbose) {
      const h = { accept: N };
      if (method !== 'GET') {
        const ci = await (await fetch(url.split('/_api/')[0] + '/_api/contextinfo', { method: 'POST', headers: { accept: N } })).json();
        h['X-RequestDigest'] = ci.FormDigestValue;
        if (body) h['content-type'] = verbose ? V : N;
      }
      const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + t.slice(0, 300));
      return t ? JSON.parse(t) : null;
    }
    const q = s => encodeURIComponent(s.replace(/'/g, "''"));

    // 1. the permission level, with the dev site's exact rights
    const src = (await call('GET', from + "/_api/web/roledefinitions?$filter=Name eq '" + q(LEVEL) + "'")).value[0];
    if (!src) throw new Error('no "' + LEVEL + '" level on the dev site to copy');
    let lvl = (await call('GET', root + "/_api/web/roledefinitions?$filter=Name eq '" + q(LEVEL) + "'")).value[0];
    if (!lvl) {
      await call('POST', root + '/_api/web/roledefinitions', {
        __metadata: { type: 'SP.RoleDefinition' }, Name: LEVEL, Description: 'View items and add items; no edit or delete.', Order: 0,
        BasePermissions: { __metadata: { type: 'SP.BasePermissions' }, High: src.BasePermissions.High, Low: src.BasePermissions.Low }
      }, true);
      lvl = (await call('GET', root + "/_api/web/roledefinitions?$filter=Name eq '" + q(LEVEL) + "'")).value[0];
      log.push('created level "' + LEVEL + '"');
    } else log.push('level "' + LEVEL + '" exists');
    if (lvl.BasePermissions.Low !== src.BasePermissions.Low || lvl.BasePermissions.High !== src.BasePermissions.High) {
      throw new Error('root "' + LEVEL + '" rights differ from the dev site\'s — fix by hand, not overwriting');
    }
    const read = (await call('GET', root + "/_api/web/roledefinitions?$filter=Name eq 'Read'")).value[0];

    // 2. the group, with the dev site group's members
    let grp = (await call('GET', root + "/_api/web/sitegroups?$filter=Title eq '" + q(GROUP) + "'")).value[0];
    if (!grp) {
      grp = await call('POST', root + '/_api/web/sitegroups', { __metadata: { type: 'SP.Group' }, Title: GROUP,
        Description: 'Zone attestation test users (mirrors the dev site group)' }, true);
      grp = grp.d || grp;
      log.push('created group ' + GROUP);
    }
    const want = (await call('GET', from + "/_api/web/sitegroups/getbyname('" + q(GROUP) + "')/users?$select=LoginName,Title")).value;
    const have = (await call('GET', root + '/_api/web/sitegroups(' + grp.Id + ')/users?$select=LoginName')).value.map(u => u.LoginName);
    for (const u of want) {
      if (have.includes(u.LoginName)) { log.push('  member: ' + u.Title); continue; }
      await call('POST', root + '/_api/web/ensureuser', { logonName: u.LoginName });
      await call('POST', root + '/_api/web/sitegroups(' + grp.Id + ')/users', { __metadata: { type: 'SP.User' }, LoginName: u.LoginName }, true);
      log.push('  added member: ' + u.Title);
    }

    // 3. the lists: unique permissions; Members + GROUP at the list's role, never Contribute
    const members = await call('GET', root + '/_api/web/AssociatedMemberGroup?$select=Id,Title');
    for (const [title, roleName] of Object.entries(LISTS)) {
      const L = root + "/_api/web/lists/getbytitle('" + q(title) + "')";
      // HasUniqueRoleAssignments has been seen reading false on a list that IS unique (its grants
      // differ from the site's), so don't trust it to skip: breaking an already-unique list is a no-op
      await call('POST', L + '/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)');
      const role = roleName === 'Read' ? read : lvl;
      for (const p of [members, grp]) {
        const ra = (await call('GET', L + '/roleassignments?$filter=PrincipalId eq ' + p.Id + '&$expand=RoleDefinitionBindings&$select=RoleDefinitionBindings/Id,RoleDefinitionBindings/Name')).value[0];
        const bound = ra ? ra.RoleDefinitionBindings : [];
        for (const b of bound) {
          if (b.Id !== role.Id) {
            await call('POST', L + '/roleassignments/removeroleassignment(principalid=' + p.Id + ',roledefid=' + b.Id + ')');
            log.push('  ' + title + ': ' + p.Title + ' − ' + b.Name);
          }
        }
        if (!bound.some(b => b.Id === role.Id)) {
          await call('POST', L + '/roleassignments/addroleassignment(principalid=' + p.Id + ',roledefid=' + role.Id + ')');
          log.push('  ' + title + ': ' + p.Title + ' + ' + role.Name);
        }
      }
    }
    // Responses: read own (2), create/edit own (2) — MERGE
    const R = root + "/_api/web/lists/getbytitle('" + q('PS_Zone-Attestation-Responses') + "')";
    const ci = await (await fetch(root + '/_api/contextinfo', { method: 'POST', headers: { accept: N } })).json();
    const m = await fetch(R, { method: 'POST', headers: { accept: N, 'content-type': N, 'X-RequestDigest': ci.FormDigestValue, 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' },
      body: JSON.stringify({ ReadSecurity: 2, WriteSecurity: 2 }) });
    if (!m.ok) throw new Error('item-level settings ' + m.status + ' ' + await m.text());

    // read back
    for (const title of Object.keys(LISTS)) {
      const L = root + "/_api/web/lists/getbytitle('" + q(title) + "')";
      const l = await call('GET', L + '?$select=HasUniqueRoleAssignments,ReadSecurity,WriteSecurity');
      const ras = (await call('GET', L + '/roleassignments?$expand=Member,RoleDefinitionBindings&$select=Member/Title,RoleDefinitionBindings/Name')).value;
      log.push(title + ' (unique=' + l.HasUniqueRoleAssignments + ', read=' + l.ReadSecurity + ', write=' + l.WriteSecurity + '): ' +
        ras.map(a => a.Member.Title + '→' + a.RoleDefinitionBindings.map(b => b.Name).join('/')).join('; '));
    }
    return log;
  }, { root, from, LEVEL, GROUP, LISTS });
  console.log(out.join('\n'));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(2); });
