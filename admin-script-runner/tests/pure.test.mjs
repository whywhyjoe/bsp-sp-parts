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
  assert.equal(R.currentSlotStart(at(19, 30), [8, 10, 18]).getHours(), 18);
});

test('slot gate: checks once per slot per browser', () => {
  const now = new Date(2026, 8, 28, 10, 30);
  const slot10 = new Date(2026, 8, 28, 10, 0).getTime();
  assert.equal(R.slotGate(now, [8, 10], undefined).check, true);
  assert.equal(R.slotGate(now, [8, 10], slot10 - 1).check, true, 'stamped in the previous slot');
  assert.equal(R.slotGate(now, [8, 10], slot10 + 60000).reason, 'checked-this-slot');
  assert.equal(R.slotGate(new Date(2026, 8, 28, 6, 0), [8, 10], undefined).reason, 'outside-hours');
});

test('end hour: defaults to two hours after the last slot; nothing runs after it', () => {
  assert.equal(R.normalizeSchedule(undefined).until, 20);
  assert.equal(R.normalizeSchedule({ slots: [8, 21] }).until, 23, 'a custom late slot keeps its two hours');
  assert.equal(R.normalizeSchedule({ slots: [8, 23] }).until, 24, 'capped at midnight');
  assert.equal(R.normalizeSchedule({ until: 17 }).until, 17, 'explicit until wins');
  assert.equal(R.normalizeSchedule({ until: 99 }).until, 20, 'invalid until falls back');
  const at = (h, m) => new Date(2026, 8, 28, h, m);
  assert.equal(R.slotGate(at(19, 59), undefined, undefined).check, true, 'the last slot runs until 20:00');
  assert.equal(R.slotGate(at(20, 0), undefined, undefined).reason, 'outside-hours');
  assert.equal(R.slotGate(at(23, 30), undefined, undefined).reason, 'outside-hours', 'no overnight run');
  assert.equal(R.slotGate(at(16, 30), { until: 16 }, undefined).reason, 'outside-hours', 'slots at or after until never start');
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

test('config: "/" means the tenant root site; omitted means the page\'s own web', () => {
  assert.equal(T.siteOf(''), '');
  assert.equal(T.siteOf(undefined), '');
  assert.equal(T.siteOf('/'), '/');
  assert.equal(T.siteOf('//'), '/');
  assert.equal(T.siteOf(' /sites/a/ '), '/sites/a');
  const base = { list: { title: 'L', site: '/' }, fields: ['A'], output: { folder: '/f', file: 'x.md' } };
  const c = T.normalizeConfig(base).config;
  assert.equal(c.list.site, '/');
  assert.equal(c.output.site, '/', 'the output site follows the list site');
  assert.equal(T.normalizeConfig({ ...base, output: { ...base.output, site: '/sites/b/' } }).config.output.site, '/sites/b');
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

test('plain multi-line text loses blank lines too (a blank line would end its bullet)', () => {
  const note = { TypeAsString: 'Note', RichText: false };
  assert.equal(T.valueText('one\r\n\r\ntwo  \n\n\nthree', note), 'one\ntwo\nthree');
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

// ─── task: source watermark (the mid-export edit race) ───────────────────────

test('watermark text round-trips; anything else is not a watermark', () => {
  const d = new Date('2026-10-01T16:17:45Z');
  assert.equal(T.parseWatermark(T.watermarkText(d)).getTime(), d.getTime());
  assert.equal(T.parseWatermark(''), null);
  assert.equal(T.parseWatermark('My notes'), null);
  assert.equal(T.parseWatermark('Source list as of yesterday'), null);
});

test('due decision compares the list with the watermark, not the save time', () => {
  const t = (m) => new Date(Date.UTC(2026, 9, 1, 10, m));
  const slot = t(0);
  // The race: items read at 10:01 (watermark), list edited 10:02, file saved 10:03.
  const raced = { modified: t(3), canEdit: true, source: t(1) };
  assert.equal(T.needsExport(raced, { lastItemModified: t(2) }, null), true, 'the mid-export edit is caught');
  assert.equal(T.needsExport(raced, { lastItemModified: t(1) }, null), false, 'unchanged since the read');
  assert.equal(T.needsExport(raced, { lastItemModified: t(2) }, slot), false, 'but not twice in one slot');
  assert.equal(T.needsExport(null, null, slot), true, 'never exported');
  assert.equal(T.needsExport({ modified: t(3), canEdit: false, source: t(1) }, { lastItemModified: t(9) }, null), false, 'cannot write it');
  // No readable watermark (Title write failed, Title edited): due, never trusted to the save time.
  assert.equal(T.needsExport({ modified: t(3), canEdit: true, source: null }, { lastItemModified: t(2) }, null), true);
  assert.equal(T.needsExport({ modified: t(3), canEdit: true, source: null }, { lastItemModified: t(2) }, slot), false, 'still once per slot');
});

test('settle delay waits out the second of a very recent list change, capped at 2 s', () => {
  const now = Date.UTC(2026, 9, 1, 10, 0, 10);
  assert.equal(T.settleDelay(new Date(now - 500), now), 1500);
  assert.equal(T.settleDelay(new Date(now - 5000), now), 0);
  assert.equal(T.settleDelay(new Date(now + 60000), now), 2000, 'a server clock ahead of ours is capped');
});

// The task end to end against its own mock adapter, no DOM: an edit landing
// mid-export must make the very next check want to export again.
function loadTaskAlone() {
  const window = { location: { origin: 'https://tenant.example' }, __ASR_MOCK_DELAY_MS__: 0 };
  window.setTimeout = setTimeout;
  const ctx = vm.createContext({ window, Intl, Date, Math, JSON, Object, Array, String, Number, Promise, console, isFinite, parseInt, encodeURIComponent, setTimeout });
  vm.runInContext(read('../tasks/sp-list-to-markdown/sp-list-to-markdown.js'), ctx);
  return { window, task: window.adminScriptTasks.find((t) => t.type === 'sp-list-to-markdown') };
}
function taskCtx(config, slotStart) {
  return { config, mock: true, slotStart, log() {}, setStatus() {}, setProgress() {}, isCancelled: () => false, throwIfCancelled() {} };
}

test('an edit landing mid-export is exported at the next check', async () => {
  const { window, task } = loadTaskAlone();
  const config = window.spListToMarkdown._mock.config;
  assert.equal(await task.due(taskCtx(config, null)), true, 'never exported');

  await task.run(taskCtx(config, null));
  const file = Object.values(window.__ASR_MOCK_FILES__)[0];
  assert.match(file.title, /^Source list as of \d{4}-/, 'the watermark is written');
  assert.equal(await task.due(taskCtx(config, null)), false, 'list unchanged since the read');

  window.__ASR_MOCK_EDIT_DURING_EXPORT__ = true;   // the mock bumps the list during the upload
  await task.run(taskCtx(config, null));
  assert.equal(await task.due(taskCtx(config, null)), true, 'the mid-export edit is not lost');
});

test('the shipped sample config is valid as-is: notes ignored, every setting read', () => {
  const sample = JSON.parse(read('../tasks/sp-list-to-markdown/sp-list-to-markdown.config.json'));
  const r = T.normalizeConfig(sample);
  assert.deepEqual(Array.from(r.errors), []);
  assert.equal(r.config.group, 'AssignedTo');
  assert.equal(r.config.subgroup, 'Status');
  assert.equal(r.config.filter, "Status ne 'Closed'");
  assert.equal(r.config.orderBy[0].field, 'DueDate');
  assert.equal(r.config.output.file, 'intake.md');
  assert.deepEqual(R.normalizeSchedule(sample.schedule), R.normalizeSchedule({ slots: [8, 10, 12, 14, 16, 18], until: 20 }));
  // Every real key in the sample has a note.
  for (const k of Object.keys(sample).filter((k) => !k.startsWith('//'))) {
    assert.ok(('//' + k) in sample, 'no note for ' + k);
  }
});

