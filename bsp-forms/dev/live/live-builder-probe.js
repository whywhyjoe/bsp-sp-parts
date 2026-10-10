// DEV ONLY: the builder plan's B0 probe, against the BSPF Builder Test list
// (live-builder-list.ps1). Runs inside a live bsp-forms test page so the calls go
// through the real self-hosted pnp v2 bundle, exactly as the engine makes them.
// Answers: which schema properties come back without $select; which explicit-empty
// shapes SharePoint accepts and saves as empty; whether omitted columns (incl. a
// required one) get their DefaultValue; and how '_'-prefixed columns are addressed.
// Creates a few items in the test list each run. Prints JSON; asserts nothing.
'use strict';
const path = require('path');
const os = require('os');
const SPENV = path.join(os.homedir(), '.claude', 'skills', 'sp-env');
const { chromium } = require(path.join(SPENV, 'scripts', 'node_modules', 'playwright'));
const tenants = require(path.join(SPENV, 'tenants.local.json'));

const SITE = tenants.dev.siteUrl.replace(/\/$/, '');
// a page whose form targets this site (the GSI pages target the tenant root, and the engine
// re-asserts the global pnp baseUrl to its own target web)
const PAGE = SITE + '/SitePages/bsp-forms-classic-url-test.aspx?Link=https%3A%2F%2Fexample.com%2Fx&ResourceName=probe';
const LIST = new URL(SITE).pathname + '/Lists/BSPFBuilderTest';

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(SPENV, 'auth', 'pw-profile'), { headless: true });
  const page = await ctx.newPage();
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.pnp && window.pnp.sp, null, { timeout: 60000 });
  const out = await page.evaluate(async ({ SITE, LIST }) => {
    const pnp = window.pnp;
    pnp.sp.setup({ sp: { baseUrl: SITE } });
    const list = () => pnp.sp.web.getList(LIST);
    const r = {};
    r.hasWeb = typeof pnp.Web === 'function';
    r.lists = (await pnp.sp.web.lists.filter('Hidden eq false and BaseTemplate eq 100')
      .select('Id', 'Title', 'EnableAttachments', 'ItemCount', 'RootFolder/ServerRelativeUrl').expand('RootFolder').get())
      .map(l => ({ Title: l.Title, url: l.RootFolder && l.RootFolder.ServerRelativeUrl, att: l.EnableAttachments, n: l.ItemCount }));
    const info = await list().select('Id', 'Title', 'EnableAttachments', 'ListItemEntityTypeFullName', 'ValidationFormula').get();
    r.list = info;
    const fields = await list().fields.filter('Hidden eq false').get();
    const keep = ['InternalName', 'EntityPropertyName', 'TypeAsString', 'Required', 'ReadOnlyField', 'FromBaseType', 'Sealed',
      'DefaultValue', 'Choices', 'FillInChoice', 'MaxLength', 'DisplayFormat', 'AllowMultipleValues', 'SelectionMode',
      'MinimumValue', 'MaximumValue', 'ShowAsPercentage', 'RichText', 'AppendOnly', 'NumberOfLines', 'EnforceUniqueValues',
      'ValidationFormula', 'LookupList', 'CurrencyLocaleId'];
    r.fieldKeysSample = Object.keys(fields.find(f => f.InternalName === 'ChoiceA') || {}).sort();
    r.fields = fields.filter(f => !f.FromBaseType || f.InternalName === 'Title').map(f => {
      const o = {}; keep.forEach(k => { if (f[k] !== undefined && f[k] !== null && f[k] !== '') o[k] = f[k]; }); return o;
    });

    const type = info.ListItemEntityTypeFullName;
    async function add(name, payload) {
      try {
        const res = await list().items.add(payload, type);
        return { name, ok: true, id: res.data.Id };
      } catch (e) {
        return { name, ok: false, err: String(e.message || e).slice(0, 300) };
      }
    }
    const me = await pnp.sp.web.currentUser.get();
    r.adds = [];
    // A: only Title + the required text; everything else omitted (defaults?) incl. required ChoiceReqDef
    r.adds.push(await add('A-omitted', { Title: 'B0 A omitted', TxtReq: 'x' }));
    // B: explicit null for every type
    r.adds.push(await add('B-nulls', {
      Title: 'B0 B nulls', TxtReq: 'x', ChoiceReqDef: 'Urgent',
      TxtDefault: null, NotePlain: null, NoteRich: null, NumDefault: null, Money: null, ChoiceA: null,
      Multi: { results: [] }, DateOnlyCol: null, DateTimeCol: null, LinkCol: null,
      PersonId: null, PeopleId: { results: [] }
    }));
    // C: empty strings instead of null for text/choice
    r.adds.push(await add('C-emptystrings', { Title: 'B0 C empty', TxtReq: 'x', ChoiceReqDef: 'Urgent', TxtDefault: '', ChoiceA: '', NotePlain: '' }));
    // D: a required column with a default sent as null (rejected?)
    r.adds.push(await add('D-required-null', { Title: 'B0 D', TxtReq: 'x', ChoiceReqDef: null }));
    // E: underscore columns, raw vs OData_ keys
    r.adds.push(await add('E-raw-underscore', { Title: 'B0 E raw', TxtReq: 'x', _Under: 'raw' }));
    r.adds.push(await add('F-odata-underscore', { Title: 'B0 F odata', TxtReq: 'x', OData__Under: 'odata', OData__x0032_Num: 2 }));
    // G: full values for every mappable type (shapes the engine sends)
    r.adds.push(await add('G-values', {
      Title: 'B0 G values', TxtReq: 'x', ChoiceReqDef: 'Urgent', TxtShort: 'short', TxtDefault: 'set', NotePlain: 'a\nb',
      NoteRich: '<div>a<br>b</div>', NumPlain: 42, NumDefault: 3, NumPct: 0.5, Money: 12.5, ChoiceA: 'High', ChoiceFill: 'Custom value',
      Multi: { results: ['Red', 'Blue'] }, DateOnlyCol: '2026-10-14T16:00:00.000Z', DateTimeCol: '2026-10-14T18:30:00.000Z',
      YesNo: true, PersonId: me.Id, PeopleId: { results: [me.Id] }, LinkCol: { Url: 'https://example.com', Description: 'Example' },
      EvenNum: 4
    }));
    r.adds.push(await add('H-even-violation', { Title: 'B0 H', TxtReq: 'x', EvenNum: 3 }));
    const ids = r.adds.filter(a => a.ok).map(a => a.id);
    const sel = ['Id', 'Title', 'TxtDefault', 'NotePlain', 'NoteRich', 'NumDefault', 'Money', 'ChoiceA', 'ChoiceReqDef', 'Multi',
      'DateOnlyCol', 'DateTimeCol', 'YesNo', 'PersonId', 'PeopleId', 'LinkCol', 'OData__Under', 'OData__x0032_Num'];
    r.items = ids.length ? await list().items.filter(ids.map(i => 'Id eq ' + i).join(' or ')).select(...sel).get() : [];
    return r;
  }, { SITE, LIST });
  console.log(JSON.stringify(out, null, 1));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(2); });
