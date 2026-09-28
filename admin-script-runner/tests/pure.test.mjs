// Fast tier: pure logic of the runner and the sp-list-to-markdown task. No DOM,
// no network. Both scripts are evaluated in a vm context whose `window` has no
// `document`, so they register and export their pure functions, then stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

function load() {
  const window = {};
  const ctx = vm.createContext({ window, Intl, Date, Math, JSON, Object, Array, String, Number, Promise, console, isFinite, parseInt, encodeURIComponent });
  // Task first, runner second: proves the push-queue works in that load order.
  vm.runInContext(read('../tasks/sp-list-to-markdown/sp-list-to-markdown.js'), ctx);
  vm.runInContext(read('../admin-script-runner.js'), ctx);
  return window;
}

const w = load();
const R = w.adminScriptRunner._pure;
const T = w.spListToMarkdown._pure;
const MOCK = w.spListToMarkdown._mock;

// ─── runner: schedule ────────────────────────────────────────────────────────

test('a task loaded before the runner is still registered', () => {
  assert.deepEqual(Array.from(w.adminScriptRunner.types()), ['sp-list-to-markdown']);
});

test('slots are cleaned: sorted, unique, whole hours 0–23', () => {
  assert.deepEqual(Array.from(R.normalizeSlots([18, 8, 8, 25, -1, 'x', 12.5, '10'])), [8, 10, 18]);
  assert.deepEqual(Array.from(R.normalizeSlots(undefined)), [8, 10, 12, 14, 16, 18]);
});

test('current slot is the latest slot hour at or before now', () => {
  const at = (h, m) => new Date(2026, 8, 28, h, m);
  assert.equal(R.currentSlotStart(at(7, 59), [8, 10]), null);
  assert.equal(R.currentSlotStart(at(8, 0), [8, 10]).getHours(), 8);
  assert.equal(R.currentSlotStart(at(9, 59), [8, 10]).getHours(), 8);
  assert.equal(R.currentSlotStart(at(23, 30), [8, 10, 18]).getHours(), 18);
});

test('slot gate: checks once per slot per browser', () => {
  const now = new Date(2026, 8, 28, 10, 30);
  const slot10 = new Date(2026, 8, 28, 10, 0).getTime();
  assert.equal(R.slotGate(now, [8, 10], undefined).check, true);
  assert.equal(R.slotGate(now, [8, 10], slot10 - 1).check, true, 'stamped in the previous slot');
  assert.equal(R.slotGate(now, [8, 10], slot10 + 60000).reason, 'checked-this-slot');
  assert.equal(R.slotGate(new Date(2026, 8, 28, 6, 0), [8, 10], undefined).reason, 'before-first-slot');
});

// ─── task: config ────────────────────────────────────────────────────────────

test('config: defaults and required keys', () => {
  const ok = T.normalizeConfig({ list: { title: 'L', site: '/sites/a/' }, fields: ['A'], output: { folder: '/sites/a/Docs/', file: 'x.md' } });
  assert.deepEqual(Array.from(ok.errors), []);
  assert.equal(ok.config.maxItems, 50);
  assert.equal(ok.config.heading, 'Title');
  assert.equal(ok.config.output.site, '/sites/a', 'output site defaults to the list site, trailing slash trimmed');
  assert.equal(ok.config.output.folder, '/sites/a/Docs');
  assert.equal(ok.config.orderBy[0].field, 'ID');
  assert.equal(ok.config.orderBy[0].ascending, false);

  const bad = T.normalizeConfig({ fields: [], output: { file: 'a/b.md' }, maxItems: 9000, timeZone: 'Mars/Base' });
  const text = bad.errors.join(' ');
  for (const needle of ['list.title', 'fields', 'output.folder', 'file name', 'maxItems', 'timeZone']) {
    assert.ok(text.includes(needle), 'missing error about ' + needle + ': ' + text);
  }
});

test('config: orderBy accepts a string, an object or a list', () => {
  const base = { list: { title: 'L' }, fields: ['A'], output: { folder: '/f', file: 'x.md' } };
  assert.equal(T.normalizeConfig({ ...base, orderBy: 'DueDate' }).config.orderBy[0].ascending, true);
  assert.equal(T.normalizeConfig({ ...base, orderBy: { field: 'X', ascending: false } }).config.orderBy[0].ascending, false);
  assert.equal(T.normalizeConfig({ ...base, orderBy: ['A', { field: 'B' }] }).config.orderBy.length, 2);
});

// ─── task: query ─────────────────────────────────────────────────────────────

const META = Object.fromEntries(MOCK.fields.map((f) => [f.InternalName, f]));

test('query: people expand Title + EMail, unknown columns are named', () => {
  const c = T.normalizeConfig({ ...MOCK.config }).config;
  const q = T.buildQuery(c, META);
  assert.deepEqual(Array.from(q.errors), []);
  assert.ok(q.select.includes('AssignedTo/Title') && q.select.includes('AssignedTo/EMail'));
  assert.deepEqual(Array.from(q.expand), ['AssignedTo']);
  assert.equal(q.select.filter((s) => s === 'Title').length, 1, 'no duplicates');

  const bad = T.buildQuery(T.normalizeConfig({ ...MOCK.config, fields: ['Nope'], orderBy: 'Gone' }).config, META);
  assert.equal(bad.errors.length, 2);
});

// ─── task: values ────────────────────────────────────────────────────────────

test('date-only values keep their calendar day for US site zones', () => {
  // Eastern midnight 2026-09-01 is stored as 04:00Z; Pacific as 07:00Z.
  assert.equal(T.formatDateOnly(new Date('2026-09-01T04:00:00Z')), '2026-09-01');
  assert.equal(T.formatDateOnly(new Date('2026-09-01T07:00:00Z')), '2026-09-01');
  // A +10 site stores it as the previous day, 14:00Z.
  assert.equal(T.formatDateOnly(new Date('2026-08-31T14:00:00Z')), '2026-09-01');
});

test('date+time values render in the configured zone', () => {
  assert.equal(T.formatDateTime(new Date('2026-10-01T16:30:00Z'), 'America/New_York'), '2026-10-01 12:30');
});

test('rich text keeps line breaks and list items', () => {
  assert.equal(T.stripHtml('<div><p>One &amp; two</p><ul><li>a</li><li>b</li></ul></div>'), 'One & two\n- a\n- b');
  assert.equal(T.stripHtml('x<br>y&#39;s'), "x\ny's");
});

test('value text per type', () => {
  const u = { Title: 'Avery Chen', EMail: 'a@x.org' };
  assert.equal(T.valueText(u, META.AssignedTo), 'Avery Chen (a@x.org)');
  assert.equal(T.valueText(u, META.AssignedTo, { short: true }), 'Avery Chen');
  assert.equal(T.valueText(['A', 'B'], META.TaskType), 'A; B');
  assert.equal(T.valueText({ Url: 'https://e.org', Description: 'Spec' }, META.RefLink), '[Spec](https://e.org)');
  assert.equal(T.valueText({ Url: 'https://e.org', Description: 'Spec' }, META.RefLink, { short: true }), 'Spec');
  assert.equal(T.valueText(true, { TypeAsString: 'Boolean' }), 'Yes');
  assert.equal(T.valueText(null, META.Status), '');
  assert.equal(T.valueText({ weird: 1 }, { TypeAsString: 'Mystery' }), '', 'unknown object shapes are omitted');
});

test('groups sort A→Z with blank last, and names that look like object internals are safe', () => {
  const items = [{ S: 'b' }, { S: null }, { S: 'constructor' }, { S: 'a' }, { S: 'b' }];
  const groups = T.groupBy(items, 'S', { S: { TypeAsString: 'Text' } }, '');
  assert.deepEqual(Array.from(groups, (g) => g.key), ['a', 'b', 'constructor', '(none)']);
  assert.equal(groups[1].items.length, 2);
});

test('edit permission is read from EffectiveBasePermissions.Low', () => {
  assert.equal(T.canEdit({ High: '432', Low: '1011030767' }), true);   // Contribute
  assert.equal(T.canEdit({ High: '176', Low: '138612833' }), false);   // Read
  assert.equal(T.canEdit(null), false);
});

// ─── task: markdown ──────────────────────────────────────────────────────────

test('markdown: groups, repeated group bullets, item links, empty values skipped', () => {
  const config = T.normalizeConfig({ ...MOCK.config, subgroup: 'Status', timeZone: 'America/New_York' }).config;
  const md = T.buildMarkdown({
    config,
    metaByName: META,
    items: MOCK.items,
    list: { title: 'Intake Test', url: 'https://t/sites/a/Lists/Intake', itemUrl: (id) => 'https://t/sites/a/Lists/Intake/DispForm.aspx?ID=' + id },
    exportedAt: new Date('2026-09-28T14:05:00Z')
  });
  assert.match(md, /^# Intake requests \(mock\)\n/);
  assert.match(md, /- Exported: 2026-09-28 10:05 \(America\/New_York\)/);
  assert.match(md, /\n## Assigned To: Avery Chen\n\n### Status: New\n\n#### New vendor intake form\n\n- Assigned To: Avery Chen \(avery@example\.org\)\n- Status: New\n/);
  assert.match(md, /- Description: Build the vendor form\.\n  - Fields from the spec\n  - Approval step/);
  assert.match(md, /- Start Date: 2026-09-21\n/);
  assert.match(md, /- Item link: https:\/\/t\/sites\/a\/Lists\/Intake\/DispForm\.aspx\?ID=3/);
  assert.ok(md.indexOf('## Assigned To: (none)') > md.indexOf('## Assigned To: Sam Field'), 'blank group last');
  assert.doesNotMatch(md, /Due Date: \n/, 'empty values are not printed');
});

test('markdown: no group → items at level 2; limit reached is disclosed', () => {
  const config = T.normalizeConfig({ ...MOCK.config, group: '', maxItems: 3 }).config;
  const md = T.buildMarkdown({ config, metaByName: META, items: MOCK.items, list: { title: 'L', url: 'u', itemUrl: () => 'u' }, exportedAt: new Date() });
  assert.match(md, /\n## New vendor intake form\n/);
  assert.match(md, /limit of 3 reached/);
});
