// DEV ONLY: the cross-site twin of the prod setup — the intake list on the dev tenant's ROOT site
// (a different site collection from the test page), created as "Creative Services Intake" and then
// renamed, so its URL and display title differ exactly like prod's. Runs through the sp-env
// Playwright profile (the signed-in user), because the cert app is scoped to the dev site only.
// Idempotent: existing list/columns are left alone.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));

const URL_NAME = 'Creative Services Intake';
const TITLE = 'Creative Digital Solutions Intake';
const ch = a => '<CHOICES>' + a.map(c => '<CHOICE>' + c.replace(/&/g, '&amp;') + '</CHOICE>').join('') + '</CHOICES>';
const FIELDS = {
  Requestor: '<Field Type="User" Name="Requestor" StaticName="Requestor" DisplayName="Requestor" Required="TRUE" UserSelectionMode="PeopleOnly" />',
  Department: '<Field Type="Text" Name="Department" StaticName="Department" DisplayName="Department" Required="TRUE" />',
  Priority: '<Field Type="Choice" Name="Priority" StaticName="Priority" DisplayName="Priority" Required="TRUE" Format="Dropdown">' + ch([
    'Support Urgent: Item is down/nonfuctional', 'Support High: Item is degraded', 'Support: Correction/minor change requested',
    'Feature request: New feature or functionality', 'Consultation: Meet to determine needs',
    'New build: Includes apps, flows, reports and sites', 'Hard launch: New item/feature required by date']) + '</Field>',
  RequestType: '<Field Type="Choice" Name="RequestType" StaticName="RequestType" DisplayName="Request Type" Format="Dropdown">' + ch([
    'Development/App', 'Development/Flow', 'Development/Sharepoint', 'Development/Reporting', 'Graphics/Decks', 'Graphics/2D',
    'Graphics/Video', 'Newsletter/Social', 'Website/New', 'Website/Update', '-----', 'Creative/Consult', 'Development/Consult',
    'Website/Consult', 'Other']) + '</Field>',
  Pillar_x002f_Partner: '<Field Type="MultiChoice" Name="Pillar_x002f_Partner" StaticName="Pillar_x002f_Partner" DisplayName="Pillar/Partner" Required="TRUE">' + ch([
    'BM I&I', 'Cyber Security', 'EFM', 'Physical Security', 'RR&C', '----', 'GSI/Initiative Management', 'GSI/Comms', 'GSI/OCM',
    'GSI/Strategy', 'GSI/Documentation', 'T&O', 'BMO.com', 'Branch', 'Enterprise', 'Other']) + '</Field>',
  field_6: '<Field Type="DateTime" Name="field_6" StaticName="field_6" DisplayName="Requested Launch Date" Required="TRUE" Format="DateOnly" />',
  field_9: '<Field Type="Note" Name="field_9" StaticName="field_9" DisplayName="Description" Required="TRUE" NumLines="6" RichText="TRUE" RichTextMode="FullHtml" />',
  UserBase: '<Field Type="Text" Name="UserBase" StaticName="UserBase" DisplayName="UserBase" />',
  // used by gsi-digital-creative-intake.json
  Partners: '<Field Type="UserMulti" Name="Partners" StaticName="Partners" DisplayName="Partners" Mult="TRUE" UserSelectionMode="PeopleOnly" />',
  field_7: '<Field Type="Note" Name="field_7" StaticName="field_7" DisplayName="Links/Location" NumLines="6" RichText="TRUE" RichTextMode="FullHtml" />',
  TranslationRequired: '<Field Type="Choice" Name="TranslationRequired" StaticName="TranslationRequired" DisplayName="Translation Required" Format="Dropdown">' + ch(['Yes', 'No']) + '</Field>'
};

(async () => {
  const root = tenants.dev.tenantRoot.replace(/\/$/, '');
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(root + '/_layouts/15/viewlsts.aspx', { waitUntil: 'domcontentloaded' });
  if (/login\./.test(page.url())) { console.log('auth_stale'); process.exit(3); }
  const out = await page.evaluate(async ({ root, URL_NAME, TITLE, FIELDS }) => {
    const log = [];
    const J = 'application/json;odata=nometadata';
    const digest = (await (await fetch(root + '/_api/contextinfo', { method: 'POST', headers: { accept: J } })).json()).FormDigestValue;
    const H = { accept: J, 'content-type': J, 'X-RequestDigest': digest };
    const listPath = new URL(root).pathname.replace(/\/$/, '') + '/Lists/' + URL_NAME;
    const listApi = root + "/_api/web/GetList('" + encodeURIComponent(listPath).replace(/'/g, "''") + "')";
    let r = await fetch(listApi + '?$select=Id,Title', { headers: { accept: J } });
    if (r.status === 404) {
      r = await fetch(root + '/_api/web/lists', { method: 'POST', headers: H, body: JSON.stringify({ Title: URL_NAME, BaseTemplate: 100 }) });
      if (!r.ok) throw new Error('create list ' + r.status + ' ' + await r.text());
      log.push('created list at /Lists/' + URL_NAME);
    } else if (!r.ok) throw new Error('get list ' + r.status);
    const cur = await (await fetch(listApi + '?$select=Title', { headers: { accept: J } })).json();
    if (cur.Title !== TITLE) {
      r = await fetch(listApi, { method: 'POST', headers: Object.assign({ 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }, H), body: JSON.stringify({ Title: TITLE }) });
      if (!r.ok) throw new Error('rename ' + r.status + ' ' + await r.text());
      log.push('renamed to ' + TITLE);
    }
    const have = (await (await fetch(listApi + '/fields?$select=InternalName', { headers: { accept: J } })).json()).value.map(f => f.InternalName);
    for (const [name, xml] of Object.entries(FIELDS)) {
      if (have.includes(name)) { log.push('have ' + name); continue; }
      r = await fetch(listApi + '/fields/createfieldasxml', { method: 'POST', headers: H,
        body: JSON.stringify({ parameters: { SchemaXml: xml, Options: 8 } }) }); // 8 = AddFieldInternalNameHint
      if (!r.ok) throw new Error('field ' + name + ' ' + r.status + ' ' + await r.text());
      log.push('added ' + name);
    }
    const check = (await (await fetch(listApi + '/fields?$select=InternalName&$filter=Hidden eq false', { headers: { accept: J } })).json()).value.map(f => f.InternalName);
    return { log, missing: Object.keys(FIELDS).filter(n => !check.includes(n)) };
  }, { root, URL_NAME, TITLE, FIELDS });
  console.log(out.log.join('\n'));
  console.log(out.missing.length ? 'MISSING: ' + out.missing.join(', ') : 'all form columns present');
  await ctx.close();
  process.exit(out.missing.length ? 1 : 0);
})().catch(e => { console.error(e.message || e); process.exit(2); });
