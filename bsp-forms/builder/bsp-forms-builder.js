/*! BSP Forms builder · bsp-forms-builder.js */
/* =====================================================================
   BSP Forms builder — build a bsp-forms config against a real list.

   A page library inside bsp-forms (its README is its contract). Runs on a
   SharePoint page next to the engine:

     <div data-bspf-builder></div>
     <script src="…/Code/bsp-forms/bsp-forms.js?v=0.6.0"></script>
     <script src="…/Code/bsp-forms/builder/bsp-forms-builder.js?v=0.1.0"></script>

   - Needs engine 0.6.0+: it validates with BSPForms.normalize (the exact
     check a page runs), reads lists and schemas through BSPForms.lists()
     (read-only — the builder makes no SharePoint calls of its own) and
     loads its UI with BSPForms.loadUi().
   - The document IS the engine's JSON, plus "$builder" keys the engine
     ignores. The user downloads the JSON and a web part stub; the builder
     never writes to SharePoint.
   - Plan and decisions: docs/BUILDER-PLAN.md (D1–D21, B1–B7).
   ===================================================================== */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var MIN_ENGINE = '0.6.0';
  var B = window.BSPFormsBuilder = window.BSPFormsBuilder || {};
  if (B.__loaded) { if (B.scan) B.scan(); return; }
  B.__loaded = true;
  B.version = VERSION;

  var scriptEl = document.currentScript;
  var selfSrc = (scriptEl && scriptEl.src) || '';
  var selfBase = selfSrc ? selfSrc.slice(0, selfSrc.lastIndexOf('/') + 1) : '';
  var selfVer = (/[?&]v=([^&]+)/.exec(selfSrc) || [])[1] || '';

  /* ------------------------------------------------------------------
     Small utilities
     ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function jstr(v) { return JSON.stringify(v); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function verAtLeast(v, min) {
    var a = String(v || '0').split('.').map(Number), b = String(min).split('.').map(Number);
    for (var i = 0; i < 3; i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return true;
  }
  function icon(name, size) {
    return '<svg class="icon icon--' + (size || 16) + '" aria-hidden="true"><use href="#ic-fluent-' + name + '-24-regular"/></svg>';
  }
  function pathOf(url) {
    try { return new URL(url, location.href).pathname.replace(/\/$/, ''); } catch (e) { return url; }
  }
  function slugify(s) {
    var out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return out || 'form';
  }
  // "Contact email" -> "contactEmail"
  function camelId(s) {
    var words = String(s || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    var id = words.map(function (w, i) {
      w = w.toLowerCase();
      return i ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join('').slice(0, 40);
    if (!/^[A-Za-z]/.test(id)) id = 'field' + id;
    return id;
  }
  var ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

  /* ------------------------------------------------------------------
     Control kinds (the palette) and what each can be saved to
     ------------------------------------------------------------------ */
  var KINDS = {
    text:        { label: 'Single line text', icon: 'edit', hue: 'blue' },
    textarea:    { label: 'Multi-line text', icon: 'document', hue: 'blue' },
    number:      { label: 'Number', icon: 'data-bar-vertical', hue: 'teal' },
    boolean:     { label: 'Yes / No', icon: 'checkmark-circle', hue: 'green' },
    choice:      { label: 'Choice', icon: 'filter', hue: 'lavender' },
    multichoice: { label: 'Multi-choice', icon: 'grid', hue: 'lavender' },
    date:        { label: 'Date', icon: 'calendar-ltr', hue: 'orange' },
    person:      { label: 'Person', icon: 'person', hue: 'sky' },
    url:         { label: 'URL', icon: 'open', hue: 'sky' },
    heading:     { label: 'Heading', icon: 'star', hue: 'gray', isStatic: true },
    note:        { label: 'Note', icon: 'info', hue: 'gray', isStatic: true },
    currentUser: { label: 'Current user card', icon: 'person-add', hue: 'gray', isStatic: true },
    locked:      { label: 'Advanced (edit in JSON)', icon: 'settings', hue: 'gray', isStatic: true }
  };
  var PALETTE = ['text', 'textarea', 'number', 'boolean', 'choice', 'multichoice', 'date', 'person', 'url', 'heading', 'note', 'currentUser'];
  var COLORS = ['blue', 'green', 'lavender', 'orange', 'teal', 'berry', 'yellow', 'sky', 'red', 'gray'];
  var SECTION_ICONS = ['', 'person', 'edit', 'document', 'calendar-ltr', 'clock', 'mail', 'phone', 'home', 'grid', 'shield',
    'money', 'receipt', 'folder', 'info', 'question', 'settings', 'star', 'data-bar-vertical', 'attach', 'checkmark-circle'];

  // kind -> SharePoint TypeAsString -> 'ok' | 'warn' (offered, flagged)
  var FITS = {
    text:        { Text: 'ok', Note: 'warn' },
    textarea:    { Note: 'ok', Text: 'warn' },
    number:      { Number: 'ok', Currency: 'ok' },
    boolean:     { Boolean: 'ok', Choice: 'ok', Text: 'ok' },
    choice:      { Choice: 'ok', Text: 'ok' },
    multichoice: { MultiChoice: 'ok' },
    date:        { DateTime: 'ok' },
    person:      { User: 'ok', UserMulti: 'ok' },
    url:         { URL: 'ok', Text: 'ok' }
  };
  var SUPPORTED = {};
  Object.keys(FITS).forEach(function (k) { Object.keys(FITS[k]).forEach(function (t) { SUPPORTED[t] = true; }); });
  var EXCLUDED = {
    Lookup: 'Lookup columns aren’t supported by the builder yet.',
    LookupMulti: 'Multi-value lookup columns aren’t supported.',
    TaxonomyFieldType: 'Managed metadata isn’t supported.',
    TaxonomyFieldTypeMulti: 'Managed metadata isn’t supported.',
    Calculated: 'Calculated — SharePoint fills it in.',
    Computed: 'Computed — SharePoint fills it in.',
    Counter: 'Counter — SharePoint fills it in.',
    Location: 'Location columns aren’t supported.',
    Thumbnail: 'Image columns aren’t supported.',
    Image: 'Image columns aren’t supported.',
    Geolocation: 'Location columns aren’t supported.'
  };

  function kindOf(f) {
    var k = f && f.$builder && f.$builder.kind;
    if (k && KINDS[k] && k !== 'locked') return k;
    switch (f && f.type) {
      case 'text': case 'email': case 'phone': return 'text';
      case 'textarea': return 'textarea';
      case 'number': case 'currency': return 'number';
      case 'link': return 'url';
      case 'boolean': case 'choice': case 'multichoice': case 'date': case 'person':
      case 'heading': case 'note': case 'currentUser': return f.type;
      default: return 'locked'; // hidden, lookup, assignments … preserved, not edited
    }
  }
  function isValueKind(k) { return KINDS[k] && !KINDS[k].isStatic; }

  /* ------------------------------------------------------------------
     Schema -> column catalog (B3)
     ------------------------------------------------------------------ */
  function entityName(name) { return name.charAt(0) === '_' ? 'OData_' + name : name; }
  function classify(fd) {
    var c = { name: fd.InternalName, title: fd.Title || fd.InternalName, type: fd.TypeAsString, fd: fd, ok: true, reason: '' };
    function no(r) { c.ok = false; c.reason = r; return c; }
    if (fd.ReadOnlyField) return no('Read-only — SharePoint fills it in.');
    if (EXCLUDED[c.type]) return no(EXCLUDED[c.type]);
    if (fd.EntityPropertyName && fd.EntityPropertyName !== entityName(c.name)) {
      return no('Its REST name (' + fd.EntityPropertyName + ') doesn’t follow its internal name, so a form can’t write it.');
    }
    if (c.type === 'Number' && fd.ShowAsPercentage) return no('A percent column stores 0–1, so a form would save 50 as 5000%.');
    if (c.type === 'URL' && fd.DisplayFormat === 1) return no('Picture-format URL columns aren’t supported.');
    if (!SUPPORTED[c.type]) return no('Column type “' + c.type + '” isn’t supported.');
    return c;
  }
  function buildCatalog(schema) {
    var cat = { list: schema.list || {}, cols: [], byName: Object.create(null) };
    (schema.fields || []).forEach(function (fd) {
      if (fd.Hidden) return;
      if (fd.FromBaseType && fd.InternalName !== 'Title') return; // system columns
      var c = classify(fd);
      cat.cols.push(c);
      cat.byName[c.name] = c;
    });
    cat.cols.sort(function (a, b) {
      if (a.name === 'Title') return -1;
      if (b.name === 'Title') return 1;
      return a.title.localeCompare(b.title);
    });
    return cat;
  }
  function fit(kind, col) {
    return col && col.ok && FITS[kind] ? (FITS[kind][col.type] || null) : null;
  }
  function colChoices(col) {
    var ch = col && col.fd && col.fd.Choices;
    if (ch && !Array.isArray(ch) && Array.isArray(ch.results)) ch = ch.results;
    return Array.isArray(ch) ? ch : [];
  }

  /* ------------------------------------------------------------------
     Document helpers (B2)
     ------------------------------------------------------------------ */
  function newDoc() {
    return {
      form: { title: 'Untitled form', intro: '', appearance: { frame: 'card', header: 'band', tint: 'sky' } },
      target: { sendEmpty: true },
      confirmation: { allowAnother: true },
      pages: [{ id: 'page1', title: 'Page 1', sections: [{ id: 'section1', title: '', fields: [] }] }],
      $builder: { version: 1 }
    };
  }
  function eachField(doc, fn) {
    (doc.pages || []).forEach(function (pg, pi) {
      (pg.sections || []).forEach(function (sec, si) {
        (sec.fields || []).forEach(function (f, fi) { fn(f, pg, sec, pi, si, fi); });
      });
    });
  }
  function allIds(doc) {
    var ids = { field: Object.create(null), section: Object.create(null), page: Object.create(null) };
    (doc.pages || []).forEach(function (pg) {
      ids.page[pg.id] = true;
      (pg.sections || []).forEach(function (sec) {
        ids.section[sec.id] = true;
        (sec.fields || []).forEach(function (f) { ids.field[f.id] = true; });
      });
    });
    return ids;
  }
  function uniqueId(base, taken) {
    var id = base, n = 2;
    while (taken[id]) id = base + n++;
    return id;
  }
  function newField(kind, doc) {
    var label = KINDS[kind].label;
    var id = uniqueId(camelId(label), allIds(doc).field);
    var f = { id: id, type: kind };
    switch (kind) {
      case 'text': f.type = 'text'; f.label = 'Single line text'; break;
      case 'textarea': f.label = 'Multi-line text'; f.rows = 4; break;
      case 'number': f.label = 'Number'; f.validation = {}; break;
      case 'boolean': f.label = 'Yes / No'; f.control = 'switch'; break;
      case 'choice': case 'multichoice':
        f.label = kind === 'choice' ? 'Choice' : 'Multi-choice';
        f.choices = [{ value: 'Option 1', color: 'blue' }, { value: 'Option 2', color: 'green' }];
        break;
      case 'date': f.label = 'Date'; break;
      case 'person': f.label = 'Person'; break;
      case 'url': f.type = 'link'; f.label = 'Link'; break;
      case 'heading': f.text = 'Heading'; break;
      case 'note': f.text = 'Something people should know.'; f.style = 'info'; break;
      case 'currentUser': f.label = 'You'; break;
    }
    f.$builder = { kind: kind, autoId: true };
    return f;
  }
  // choices as objects ({ value, label?, color? }) — the editor's shape
  function normChoices(f) {
    if (!Array.isArray(f.choices)) f.choices = [];
    f.choices = f.choices.map(function (c, i) {
      var o = typeof c === 'string' ? { value: c } : c;
      if (!o.color) o.color = COLORS[i % COLORS.length];
      return o;
    });
  }

  /* Mapping a column adapts the control to it (B4 "schema-forced"):
     engine type, choices, bounds, required. */
  function applyColumn(f, col, kind) {
    var fd = col.fd, t = col.type;
    f.column = col.name;
    if (f.$builder) delete f.$builder.logicOnly;
    f.validation = f.validation || {};
    switch (kind) {
      case 'text':
        if (t === 'Text' && fd.MaxLength && (!f.validation.maxLength || f.validation.maxLength > fd.MaxLength)) f.validation.maxLength = fd.MaxLength;
        break;
      case 'textarea':
        if (t === 'Note') f.richText = !!fd.RichText; else delete f.richText;
        if (t === 'Text' && fd.MaxLength) f.validation.maxLength = Math.min(f.validation.maxLength || fd.MaxLength, fd.MaxLength);
        break;
      case 'number':
        f.type = t === 'Currency' ? 'currency' : 'number';
        if (f.type === 'currency') delete f.display;
        if (fd.MinimumValue != null && (f.validation.min == null || f.validation.min < fd.MinimumValue)) f.validation.min = fd.MinimumValue;
        if (fd.MaximumValue != null && (f.validation.max == null || f.validation.max > fd.MaximumValue)) f.validation.max = fd.MaximumValue;
        break;
      case 'boolean':
        if (t === 'Boolean') delete f.values;
        else if (!f.values) f.values = { on: 'Yes', off: 'No' };
        break;
      case 'choice': case 'multichoice':
        normChoices(f);
        if (t === 'Choice' || t === 'MultiChoice') {
          var allowed = colChoices(col);
          var subset = f.choices.length && f.choices.every(function (c) { return allowed.indexOf(c.value) > -1; });
          if (!subset) {
            var had = Object.create(null);
            f.choices.forEach(function (c) { had[c.value] = c; });
            f.choices = allowed.map(function (v, i) { return had[v] || { value: v, color: COLORS[i % COLORS.length] }; });
          }
          if (!fd.FillInChoice) delete f.fillIn;
        }
        break;
      case 'date':
        if (fd.DisplayFormat === 0) delete f.includeTime;
        break;
      case 'person':
        f.multiple = t === 'UserMulti';
        break;
      case 'url':
        if (t === 'URL') { f.type = 'link'; if (f.validation) delete f.validation.url; }
        else { f.type = 'text'; f.validation.url = true; delete f.withDescription; }
        break;
    }
    if (fd.Required) f.required = true;
    // the column's default, shown in the form so what's seen is what's saved
    // (target.sendEmpty): removable like any default (E6a)
    var dv = fd.DefaultValue;
    if (f.default === undefined && dv != null && dv !== '') {
      if (kind === 'text' || kind === 'textarea') f.default = dv;
      else if (kind === 'choice' && f.choices.some(function (c) { return c.value === dv; })) f.default = dv;
      else if (kind === 'number' && !isNaN(Number(dv))) f.default = Number(dv);
      else if (kind === 'boolean' && t === 'Boolean') f.default = dv === '1';
    }
    if (f.validation && !Object.keys(f.validation).length) delete f.validation;
  }
  function unmap(f) {
    delete f.column;
    delete f.default;
  }

  /* ------------------------------------------------------------------
     Id references (B4): one walker for rename, delete and checks. It knows
     every place a field id appears, including structures the builder
     doesn't edit (prompts, afterSubmit), through {en, fr} pairs.
     ------------------------------------------------------------------ */
  function ruleSites(rule, out, where) {
    if (!rule || typeof rule !== 'object') return;
    if (Array.isArray(rule.all)) rule.all.forEach(function (r) { ruleSites(r, out, where); });
    if (Array.isArray(rule.any)) rule.any.forEach(function (r) { ruleSites(r, out, where); });
    if (rule.not) ruleSites(rule.not, out, where);
    if (typeof rule.field === 'string') out.push({ obj: rule, key: 'field', where: where });
    if (typeof rule.compareTo === 'string' && rule.compareTo !== '@today') out.push({ obj: rule, key: 'compareTo', where: where });
  }
  function textSites(o, keys, out, where) {
    if (!o || typeof o !== 'object') return;
    keys.forEach(function (k) {
      var v = o[k];
      if (typeof v === 'string') out.push({ obj: o, key: k, where: where + '.' + k, token: true });
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        ['en', 'fr'].forEach(function (l) { if (typeof v[l] === 'string') out.push({ obj: v, key: l, where: where + '.' + k + '.' + l, token: true }); });
      }
    });
  }
  function screenSites(s, out, where) {
    if (!s || typeof s !== 'object') return;
    textSites(s, ['title', 'message', 'copy'], out, where);
    textSites(s.link, ['text'], out, where + '.link');
    textSites(s.redirect, ['url'], out, where + '.redirect');
  }
  // [{ obj, key, where, token?, setKeys? }]
  function refSites(doc) {
    var out = [];
    (doc.pages || []).forEach(function (pg) {
      ruleSites(pg.visibleWhen, out, 'page "' + pg.id + '" show-when');
      ruleSites(pg.endWhen, out, 'page "' + pg.id + '" end-when');
      (pg.sections || []).forEach(function (sec) {
        ruleSites(sec.visibleWhen, out, 'section "' + sec.id + '" show-when');
        (sec.fields || []).forEach(function (f) {
          var w = 'field "' + f.id + '"';
          ruleSites(f.visibleWhen, out, w + ' show-when');
          ruleSites(f.lockWhen, out, w + ' lockWhen');
          (Array.isArray(f.rules) ? f.rules : []).forEach(function (r) {
            if (r && typeof r.compareTo === 'string' && r.compareTo !== '@today') out.push({ obj: r, key: 'compareTo', where: w + ' date rule' });
          });
          if (f.choicesWhen && typeof f.choicesWhen.field === 'string') out.push({ obj: f.choicesWhen, key: 'field', where: w + ' choicesWhen' });
          var set = f.prompt && f.prompt.confirm && f.prompt.confirm.set;
          if (set && typeof set === 'object') out.push({ obj: f.prompt.confirm, key: 'set', where: w + ' prompt.confirm.set', setKeys: true });
        });
      });
    });
    var t = doc.target || {};
    textSites(t, ['titleTemplate'], out, 'target');
    if (t.set && typeof t.set === 'object') textSites(t.set, Object.keys(t.set), out, 'target.set');
    textSites(doc.confirmation, ['title', 'message'], out, 'confirmation');
    textSites(doc.confirmation && doc.confirmation.redirect, ['url'], out, 'confirmation.redirect');
    textSites(doc.submitConfirm, ['title', 'message'], out, 'submitConfirm');
    var as = doc.afterSubmit;
    if (as) {
      if (as.lookup && typeof as.lookup.matchField === 'string') out.push({ obj: as.lookup, key: 'matchField', where: 'afterSubmit.lookup.matchField' });
      screenSites(as.found, out, 'afterSubmit.found');
      screenSites(as.notFound, out, 'afterSubmit.notFound');
    }
    screenSites(doc.queryError, out, 'queryError');
    return out;
  }
  function tokenRe(id) { return new RegExp('\\{field:' + escRe(id) + '\\}', 'g'); }
  function refsTo(doc, id) {
    var hits = [];
    refSites(doc).forEach(function (s) {
      if (s.setKeys) { if (Object.prototype.hasOwnProperty.call(s.obj.set, id)) hits.push(s.where); }
      else if (s.token) { if (tokenRe(id).test(s.obj[s.key])) hits.push(s.where); }
      else if (s.obj[s.key] === id) hits.push(s.where);
    });
    return hits;
  }
  function renameRefs(doc, from, to) {
    refSites(doc).forEach(function (s) {
      if (s.setKeys) {
        if (!Object.prototype.hasOwnProperty.call(s.obj.set, from)) return;
        var next = {};
        Object.keys(s.obj.set).forEach(function (k) { next[k === from ? to : k] = s.obj.set[k]; });
        s.obj.set = next;
      } else if (s.token) {
        s.obj[s.key] = s.obj[s.key].replace(tokenRe(from), '{field:' + to + '}');
      } else if (s.obj[s.key] === from) s.obj[s.key] = to;
    });
  }
  // ids referenced anywhere that no field has
  function danglingRefs(doc) {
    var ids = allIds(doc).field, out = [];
    refSites(doc).forEach(function (s) {
      if (s.setKeys) Object.keys(s.obj.set).forEach(function (k) { if (!ids[k]) out.push({ id: k, where: s.where }); });
      else if (s.token) {
        var re = /\{field:([^}]+)\}/g, m;
        while ((m = re.exec(s.obj[s.key]))) if (!ids[m[1]]) out.push({ id: m[1], where: s.where });
      } else if (!ids[s.obj[s.key]]) out.push({ id: s.obj[s.key], where: s.where });
    });
    return out;
  }

  /* ------------------------------------------------------------------
     Shared columns are the builder's to maintain: a column mapped by more
     than one control is declared, nothing else is.
     ------------------------------------------------------------------ */
  function sharedOf(doc) {
    var seen = Object.create(null), shared = [];
    eachField(doc, function (f) {
      if (!f.column) return;
      if (seen[f.column] && shared.indexOf(f.column) < 0) shared.push(f.column);
      seen[f.column] = true;
    });
    return shared;
  }

  /* ------------------------------------------------------------------
     Checks (B7). Two sources, labelled: "schema" (will a save succeed and
     store what the form shows?) and "engine" (will the page load it?).
     ------------------------------------------------------------------ */
  var ALWAYS_TOKENS = /\{(form:title|date|time|now|user:name|user:email)\}/;
  function templateAlwaysFilled(t) {
    if (typeof t !== 'string' || !t.trim()) return false;
    if (ALWAYS_TOKENS.test(t)) return true;
    return /\S/.test(t.replace(/\{[^}]*\}/g, ''));
  }
  function endIndex(doc) {
    var at = -1;
    (doc.pages || []).forEach(function (pg, i) { if (at < 0 && pg.endWhen) at = i; });
    return at;
  }
  function unconditional(f, pg, sec, pi, endAt) {
    return !f.visibleWhen && !f.choicesWhen && !sec.visibleWhen && !pg.visibleWhen && (endAt < 0 || pi <= endAt);
  }
  function computeIssues(doc, schema) {
    var out = [];
    function add(level, source, msg, sel) { out.push({ level: level, source: source, msg: msg, sel: sel || { t: 'form', id: null } }); }
    var cat = schema && schema.state === 'ready' ? schema.catalog : null;
    var hasList = !!(doc.target && (doc.target.listUrl || doc.target.listTitle || doc.target.listId));
    if (!hasList) add('error', 'schema', 'Pick the SharePoint list this form saves to.');
    else if (schema && schema.state === 'error') add('error', 'schema', 'The list’s columns couldn’t be read: ' + schema.err);
    else if (!cat) add('warn', 'schema', 'Loading the list’s columns…');

    var endAt = endIndex(doc);
    var maps = Object.create(null); // column -> [{ f, uncond }]
    eachField(doc, function (f, pg, sec, pi) {
      var kind = kindOf(f), sel = { t: 'field', id: f.id };
      var name = '“' + (f.label || f.text || f.id) + '”';
      if (!isValueKind(kind)) return;
      var logicOnly = f.$builder && f.$builder.logicOnly;
      if ((kind === 'choice' || kind === 'multichoice') && !(f.choices || []).length) add('error', 'schema', name + ' has no choices.', sel);
      if (kind === 'number' && (f.display === 'dropdown' || f.display === 'slider')) {
        var v = f.validation || {};
        var whole = function (n) { return typeof n === 'number' && isFinite(n) && n % 1 === 0; };
        if (!whole(v.min) || !whole(v.max) || v.max <= v.min) add('error', 'schema', name + ': a ' + f.display + ' needs a whole-number minimum and maximum.', sel);
        else if (f.display === 'dropdown' && v.max - v.min + 1 > 200) add('error', 'schema', name + ': a dropdown lists at most 200 numbers — use a slider.', sel);
      }
      if (logicOnly) { if (f.column) add('error', 'schema', name + ' is marked “not saved” but has a column.', sel); return; }
      if (!f.column) { add('error', 'schema', name + ' isn’t saved anywhere — pick a column, or mark it “Not saved”.', sel); return; }
      (maps[f.column] = maps[f.column] || []).push({ f: f, uncond: unconditional(f, pg, sec, pi, endAt) });
      if (!cat) return;
      var col = cat.byName[f.column];
      if (!col) { add('error', 'schema', name + ' saves to “' + f.column + '”, which the list doesn’t have.', sel); return; }
      if (!col.ok) { add('error', 'schema', name + ' saves to “' + col.title + '”: ' + col.reason, sel); return; }
      var ft = fit(kind, col);
      if (!ft) { add('error', 'schema', name + ' (' + KINDS[kind].label + ') can’t save to a ' + col.type + ' column (“' + col.title + '”).', sel); return; }
      if (ft === 'warn') add('warn', 'schema', name + ' saves to a ' + col.type + ' column — it works, but a ' + (kind === 'text' ? 'single line of text' : 'multiple lines of text') + ' column fits better.', sel);
      var fd = col.fd, v2 = f.validation || {};
      if (fd.Required && !f.required) add('error', 'schema', name + ' saves to a column the list requires, so it must be required.', sel);
      if ((kind === 'choice' || kind === 'multichoice') && (col.type === 'Choice' || col.type === 'MultiChoice')) {
        var allowed = colChoices(col);
        var bad = (f.choices || []).map(function (c) { return typeof c === 'string' ? c : c.value; }).filter(function (v) { return allowed.indexOf(v) < 0; });
        if (bad.length) add('error', 'schema', name + ': “' + bad.join('”, “') + '” ' + (bad.length > 1 ? 'aren’t choices' : 'isn’t a choice') + ' of “' + col.title + '”.', sel);
        if (f.fillIn && !fd.FillInChoice) add('error', 'schema', name + ': “' + col.title + '” doesn’t allow fill-in values, so “Other” can’t be offered.', sel);
      }
      if (kind === 'boolean' && f.values && col.type === 'Choice') {
        var cc = colChoices(col);
        ['on', 'off'].forEach(function (k) {
          if (cc.indexOf(f.values[k]) < 0) add('warn', 'schema', name + ': “' + f.values[k] + '” isn’t one of “' + col.title + '”’s choices. SharePoint saves it anyway, but list filters won’t know it.', sel);
        });
      }
      if (col.type === 'Text' && fd.MaxLength && (kind === 'text' || kind === 'textarea' || kind === 'url') && (!v2.maxLength || v2.maxLength > fd.MaxLength)) {
        add('error', 'schema', name + ': “' + col.title + '” holds at most ' + fd.MaxLength + ' characters — set the maximum length to ' + fd.MaxLength + ' or less.', sel);
      }
      if (kind === 'number') {
        if (fd.MinimumValue != null && (v2.min == null || v2.min < fd.MinimumValue)) add('error', 'schema', name + ': “' + col.title + '” accepts nothing below ' + fd.MinimumValue + ' — set the minimum to at least that.', sel);
        if (fd.MaximumValue != null && (v2.max == null || v2.max > fd.MaximumValue)) add('error', 'schema', name + ': “' + col.title + '” accepts nothing above ' + fd.MaximumValue + ' — set the maximum to at most that.', sel);
      }
      if (kind === 'date' && f.includeTime && fd.DisplayFormat === 0) add('error', 'schema', name + ': “' + col.title + '” is date-only, so it can’t take a time.', sel);
      if (kind === 'person') {
        if (f.multiple && col.type === 'User') add('error', 'schema', name + ' allows several people, but “' + col.title + '” holds one.', sel);
        if (!f.multiple && col.type === 'UserMulti') add('warn', 'schema', name + ' allows one person; “' + col.title + '” could hold several.', sel);
      }
      if (kind === 'url' && col.type === 'URL' && f.type !== 'link') add('error', 'schema', name + ': a hyperlink column needs the URL control’s link mode.', sel);
      if (fd.EnforceUniqueValues) add('warn', 'schema', name + ': “' + col.title + '” must be unique — the form can’t check that; a duplicate fails with SharePoint’s message.', sel);
      if (fd.ValidationFormula) add('warn', 'schema', name + ': “' + col.title + '” has a validation formula the form can’t check; a failing submit shows SharePoint’s message.', sel);
    });

    // shared columns: variants must be mutually exclusive — only rules can say so
    Object.keys(maps).forEach(function (c) {
      if (maps[c].length < 2) return;
      var bare = maps[c].filter(function (m) { return m.uncond; });
      if (bare.length) {
        add('warn', 'schema', '“' + c + '” is saved by ' + maps[c].length + ' controls (' + maps[c].map(function (m) { return m.f.id; }).join(', ') +
          '). Only one should ever show — give each a show-when rule.', { t: 'field', id: bare[0].f.id });
      }
    });

    // required columns, on every path (B7; REST doesn't enforce Required — B0)
    if (cat) {
      var t = doc.target || {};
      cat.cols.forEach(function (col) {
        if (!col.ok || !col.fd.Required) return;
        var m = maps[col.name] || [];
        if (m.some(function (x) { return x.uncond && x.f.required; })) return;
        if (t.set && typeof t.set[col.name] === 'string' && t.set[col.name].trim()) return;
        if (col.name === 'Title' && !m.length && templateAlwaysFilled(t.titleTemplate)) return;
        var dv = col.fd.DefaultValue;
        if (dv != null && dv !== '' && m.every(function (x) { return x.f.required; })) return; // left out -> default applies
        if (col.name === 'Title' && !m.length) {
          add('error', 'schema', 'The list requires a Title. Map a required control to it, or set a title template with fixed text or a token like {form:title}.');
        } else if (m.length) {
          add('error', 'schema', 'The list requires “' + col.title + '”, but not every path through the form fills it in — the control that saves it must always show.', { t: 'field', id: m[0].f.id });
        } else {
          add('error', 'schema', 'The list requires “' + col.title + '”. Add a required control for it.');
        }
      });
      var att = doc.attachments;
      if (att && att.enabled) {
        if (!cat.list.enableAttachments) add('error', 'schema', 'Attachments are on, but the list has attachments turned off.');
        if ((att.maxFiles || 10) > 5) add('error', 'schema', 'Attachments: at most 5 files.');
        if ((att.maxFileSizeMb || 10) > 10) add('error', 'schema', 'Attachments: at most 10 MB per file.');
      }
      if (cat.list.validationFormula) add('warn', 'schema', 'The list has a validation formula the form can’t check; a failing submit shows SharePoint’s message.');
    }

    danglingRefs(doc).forEach(function (d) { add('error', 'schema', d.where + ' refers to “' + d.id + '”, which no control has.'); });

    // the engine's own load check (E9a) — exactly what a page would reject
    var eng = window.BSPForms && window.BSPForms.normalize ? window.BSPForms.normalize(serialize(doc)).errors : [];
    eng.forEach(function (e) {
      var m = /field "([^"]+)"/.exec(e);
      add('error', 'engine', e, m ? { t: 'field', id: m[1] } : null);
    });
    return out;
  }

  /* ------------------------------------------------------------------
     Serialize (fixed key order, empty optional strings dropped) + stub
     ------------------------------------------------------------------ */
  var TOP_ORDER = ['$comment', 'form', 'target', 'sharedColumns', 'submitConfirm', 'confirmation', 'afterSubmit',
    'queryError', 'attachments', 'strings', 'pages'];
  var DROP_EMPTY = ['label', 'hint', 'placeholder', 'description', 'intro', 'toggleText', 'title', 'titleTemplate', 'text', 'message', 'icon'];
  function tidy(o) {
    if (Array.isArray(o)) return o.map(tidy);
    if (!o || typeof o !== 'object') return o;
    var out = {};
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (v === undefined) return;
      if (v === '' && DROP_EMPTY.indexOf(k) > -1) return;
      if (k === '$builder' && v && typeof v === 'object') {
        v = clone(v); delete v.autoId;
        if (!Object.keys(v).length) return;
      }
      v = tidy(v);
      if (k === 'validation' && v && typeof v === 'object' && !Object.keys(v).length) return;
      out[k] = v;
    });
    // builder metadata reads last in every object
    if (out.$builder) { var b = out.$builder; delete out.$builder; out.$builder = b; }
    return out;
  }
  function serialize(doc) {
    var d = tidy(clone(doc));
    var shared = sharedOf(d);
    if (shared.length) d.sharedColumns = shared; else delete d.sharedColumns;
    var out = {};
    TOP_ORDER.forEach(function (k) { if (d[k] !== undefined) out[k] = d[k]; });
    Object.keys(d).forEach(function (k) { if (!(k in out) && k !== '$builder') out[k] = d[k]; });
    if (d.$builder) out.$builder = d.$builder;
    return out;
  }
  function stubHtml(title, configUrl, engineSrc, validate) {
    var safe = String(title || 'form').replace(/--+/g, '—');
    return '<!-- BSP Forms — ' + safe + '\n' +
      '     Made with the form builder ' + new Date().toISOString().slice(0, 10) + '. Paste into a custom-script web part.\n' +
      (validate ? '     data-validate shows the config check above the form: remove it after the first load. -->\n' : '     -->\n') +
      '<div data-bsp-form' + (validate ? ' data-validate' : '') + ' data-config="' + esc(configUrl) + '"></div>\n' +
      '<script src="' + esc(engineSrc) + '"></script>\n';
  }
  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* draft autosave (per builder page; storage can be absent or full) */
  var DRAFT_KEY = 'bspf-builder-draft:' + location.pathname;
  function readDraft() { try { var s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function writeDraft(doc) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: doc, savedAt: new Date().toISOString() })); } catch (e) { /* best effort */ } }
  function dropDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* best effort */ } }

  // the pure parts, for tests and devtools
  B.core = {
    KINDS: KINDS, FITS: FITS, kindOf: kindOf, classify: classify, buildCatalog: buildCatalog, fit: fit,
    newDoc: newDoc, newField: newField, applyColumn: applyColumn, refSites: refSites, refsTo: refsTo,
    renameRefs: renameRefs, danglingRefs: danglingRefs, sharedOf: sharedOf, computeIssues: computeIssues,
    serialize: serialize, stubHtml: stubHtml, camelId: camelId, slugify: slugify, templateAlwaysFilled: templateAlwaysFilled
  };

  /* ------------------------------------------------------------------
     Alpine component — window.bspFormsBuilder(), the house global-factory
     shape (no Alpine.data()). Selection is by id; the document is
     replaced wholesale on undo/redo/restore.
     ------------------------------------------------------------------ */
  window.bspFormsBuilder = function () {
    var hist = { past: [], future: [], last: null };
    var timers = { change: null };
    var lists = window.BSPForms.lists();
    return {
      doc: newDoc(),
      sel: { t: 'form', id: null },
      schema: { state: 'none', err: '', catalog: null },
      pick: { open: false, site: '', state: 'idle', lists: [], err: '' },
      ask: { open: false, title: '', msg: '', ok: '', then: null },
      palette: null,
      issues: [], nErr: 0, nWarn: 0, showIssues: false,
      dl: { open: false, slug: '', validate: true, done: false, json: '', stub: '' },
      draft: null,
      full: false,
      drag: null, dropAt: null,
      idDraft: '', idErr: '', note: '',

      init: function () {
        var self = this;
        var d = readDraft();
        if (d && d.doc && Array.isArray(d.doc.pages)) this.draft = d;
        hist.last = JSON.stringify(this.doc);
        this.$watch('doc', function () { self.changed(); });
        this.recheck();
      },

      /* ---- change tracking: undo history, autosave, checks ---- */
      changed: function () {
        var self = this;
        clearTimeout(timers.change);
        timers.change = setTimeout(function () {
          var snap = JSON.stringify(self.doc);
          if (snap !== hist.last) {
            hist.past.push(hist.last);
            if (hist.past.length > 50) hist.past.shift();
            hist.future = [];
            hist.last = snap;
            writeDraft(JSON.parse(snap));
          }
          self.recheck();
        }, 300);
      },
      recheck: function () {
        this.issues = computeIssues(this.doc, this.schema);
        this.nErr = this.issues.filter(function (i) { return i.level === 'error'; }).length;
        this.nWarn = this.issues.length - this.nErr;
      },
      canUndo: function () { return hist.past.length > 0; },
      canRedo: function () { return hist.future.length > 0; },
      undo: function () { this.travel(hist.past, hist.future); },
      redo: function () { this.travel(hist.future, hist.past); },
      travel: function (from, to) {
        clearTimeout(timers.change);
        var cur = JSON.stringify(this.doc);
        if (cur !== hist.last) { hist.past.push(hist.last); hist.last = cur; } // flush a pending edit first
        if (!from.length) return;
        to.push(hist.last);
        hist.last = from.pop();
        this.doc = JSON.parse(hist.last);
        writeDraft(this.doc);
        if (!this.findSel()) this.select('form');
        this.syncIdDraft();
        var self = this;
        this.$nextTick(function () { self.recheck(); });
      },
      keys: function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        var k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); }
      },

      /* ---- draft ---- */
      restoreDraft: function () {
        var d = this.draft;
        this.draft = null;
        if (!d) return;
        this.doc = d.doc;
        this.select('form');
        var l = this.doc.$builder && this.doc.$builder.list;
        if (l && l.listId) this.loadSchema({ siteUrl: l.siteUrl, listId: l.listId });
      },
      discardDraft: function () { this.draft = null; dropDraft(); },
      draftWhen: function () {
        try { return new Date(this.draft.savedAt).toLocaleString(); } catch (e) { return ''; }
      },
      newForm: function () {
        var self = this;
        this.confirm('Start a new form?', 'The current form is replaced. Download it first if you want to keep it — undo can bring it back in this session.', 'Start new', function () {
          self.doc = newDoc();
          self.schema = { state: 'none', err: '', catalog: null };
          self.select('form');
        });
      },

      /* ---- generic confirm dialog (the design system's .dialog) ---- */
      confirm: function (title, msg, ok, then) {
        this.ask = { open: true, title: title, msg: msg, ok: ok, then: then };
        var root = this.$root;
        this.$nextTick(function () { var b = root.querySelector('.bfb-ask .btn--primary'); if (b) b.focus(); });
      },
      askOk: function () { var f = this.ask.then; this.ask.open = false; this.ask.then = null; if (f) f(); },
      askNo: function () { this.ask.open = false; this.ask.then = null; },

      /* ---- finding things ---- */
      loc: function (t, id) {
        var pages = this.doc.pages || [];
        for (var pi = 0; pi < pages.length; pi++) {
          var pg = pages[pi];
          if (t === 'page' && pg.id === id) return { pg: pg, pi: pi };
          for (var si = 0; si < (pg.sections || []).length; si++) {
            var sec = pg.sections[si];
            if (t === 'section' && sec.id === id) return { pg: pg, pi: pi, sec: sec, si: si };
            for (var fi = 0; fi < (sec.fields || []).length; fi++) {
              if (t === 'field' && sec.fields[fi].id === id) return { pg: pg, pi: pi, sec: sec, si: si, f: sec.fields[fi], fi: fi };
            }
          }
        }
        return null;
      },
      findSel: function () { return this.sel.t === 'form' ? true : this.loc(this.sel.t, this.sel.id); },
      get cur() { var l = this.sel.t === 'field' && this.loc('field', this.sel.id); return l ? l.f : null; },
      get curPage() { var l = this.sel.t === 'page' && this.loc('page', this.sel.id); return l ? l.pg : null; },
      get curSection() { var l = this.sel.t === 'section' && this.loc('section', this.sel.id); return l ? l.sec : null; },
      kindOf: function (f) { return kindOf(f); },
      kindLabel: function (f) { return KINDS[kindOf(f)].label; },
      kindIcon: function (f) { return KINDS[kindOf(f)].icon; },
      kindHue: function (f) { return KINDS[kindOf(f)].hue; },
      isValue: function (f) { return isValueKind(kindOf(f)); },
      fieldName: function (f) { return f.label || f.text || f.id; },
      isSel: function (t, id) { return this.sel.t === t && (t === 'form' || this.sel.id === id); },
      select: function (t, id) {
        this.sel = { t: t, id: id || null };
        this.palette = null;
        this.syncIdDraft();
        this.note = '';
      },
      syncIdDraft: function () { this.idDraft = this.sel.t === 'field' ? this.sel.id : ''; this.idErr = ''; },
      issuesFor: function (t, id) {
        return this.issues.filter(function (i) { return i.sel && i.sel.t === t && i.sel.id === id; });
      },
      worst: function (t, id) {
        var list = this.issuesFor(t, id);
        return list.some(function (i) { return i.level === 'error'; }) ? 'error' : list.length ? 'warn' : '';
      },
      goIssue: function (i) {
        if (i.sel && i.sel.t !== 'form' && this.loc(i.sel.t, i.sel.id)) this.select(i.sel.t, i.sel.id); else this.select('form');
        this.showIssues = false;
      },

      /* ---- structure: add / remove / duplicate ---- */
      addPage: function () {
        var ids = allIds(this.doc);
        var n = this.doc.pages.length + 1;
        var pid = uniqueId('page' + n, ids.page), sid = uniqueId('section' + Object.keys(ids.section).length + 1, ids.section);
        this.doc.pages.push({ id: pid, title: 'Page ' + n, sections: [{ id: sid, title: '', fields: [] }] });
        this.select('page', pid);
      },
      addSection: function (pageId) {
        var l = this.loc('page', pageId);
        if (!l) return;
        var sid = uniqueId('section' + (Object.keys(allIds(this.doc).section).length + 1), allIds(this.doc).section);
        l.pg.sections.push({ id: sid, title: 'New section', fields: [] });
        this.select('section', sid);
      },
      openPalette: function (secId) { this.palette = this.palette === secId ? null : secId; },
      addField: function (secId, kind) {
        var l = this.loc('section', secId);
        if (!l) return;
        var f = newField(kind, this.doc);
        l.sec.fields.push(f);
        this.palette = null;
        this.select('field', f.id);
      },
      duplicate: function (id) {
        var l = this.loc('field', id);
        if (!l) return;
        var f = clone(l.f);
        f.id = uniqueId(f.id + 'Copy', allIds(this.doc).field);
        delete f.column;   // a copy saving to the same column would be a shared variant
        f.$builder = f.$builder || { kind: kindOf(l.f) };
        f.$builder.autoId = false;
        l.sec.fields.splice(l.fi + 1, 0, f);
        this.select('field', f.id);
      },
      remove: function (t, id) {
        var self = this, l = this.loc(t, id);
        if (!l) return;
        var ids = [];
        if (t === 'field') ids = [id];
        else if (t === 'section') ids = l.sec.fields.map(function (f) { return f.id; });
        else l.pg.sections.forEach(function (s) { s.fields.forEach(function (f) { ids.push(f.id); }); });
        var blocked = [];
        ids.forEach(function (fid) {
          refsTo(self.doc, fid).forEach(function (w) {
            if (w.indexOf('field "' + fid + '"') === 0) return; // its own rules go with it
            if (ids.some(function (x) { return w.indexOf('field "' + x + '"') === 0; })) return;
            blocked.push('“' + fid + '” is used by ' + w);
          });
        });
        if (blocked.length) { this.note = 'Can’t delete yet — ' + blocked.join('; ') + '. Remove those uses first.'; return; }
        if (t === 'page' && this.doc.pages.length < 2) { this.note = 'A form needs at least one page.'; return; }
        if (t === 'section' && l.pg.sections.length < 2) { this.note = 'A page needs at least one section.'; return; }
        var what = t === 'field' ? '“' + this.fieldName(l.f) + '”' : t === 'section' ? 'this section and its ' + ids.length + ' control(s)' : 'this page and its ' + ids.length + ' control(s)';
        this.confirm('Delete ' + (t === 'field' ? 'control' : t) + '?', 'Delete ' + what + '? Undo can bring it back.', 'Delete', function () {
          var m = self.loc(t, id);
          if (!m) return;
          if (t === 'field') m.sec.fields.splice(m.fi, 1);
          else if (t === 'section') m.pg.sections.splice(m.si, 1);
          else self.doc.pages.splice(m.pi, 1);
          self.select('form');
        });
      },

      /* ---- ordering: move up/down (keyboard path) and drag (D20) ---- */
      move: function (t, id, dir) {
        var l = this.loc(t, id);
        if (!l) return;
        var pages = this.doc.pages;
        if (t === 'page') {
          var j = l.pi + dir;
          if (j < 0 || j >= pages.length) return;
          pages.splice(j, 0, pages.splice(l.pi, 1)[0]);
        } else if (t === 'section') {
          var secs = l.pg.sections, k = l.si + dir;
          if (k >= 0 && k < secs.length) secs.splice(k, 0, secs.splice(l.si, 1)[0]);
          else {
            var np = pages[l.pi + dir];
            if (!np || secs.length < 2) return;
            var s = secs.splice(l.si, 1)[0];
            if (dir < 0) np.sections.push(s); else np.sections.unshift(s);
          }
        } else {
          var fs = l.sec.fields, m = l.fi + dir;
          if (m >= 0 && m < fs.length) fs.splice(m, 0, fs.splice(l.fi, 1)[0]);
          else {
            // across a section boundary (and across pages)
            var flat = [];
            pages.forEach(function (p) { p.sections.forEach(function (sx) { flat.push(sx); }); });
            var at = flat.indexOf(l.sec), ns = flat[at + dir];
            if (!ns) return;
            var f = fs.splice(l.fi, 1)[0];
            if (dir < 0) ns.fields.push(f); else ns.fields.unshift(f);
          }
        }
        this.$nextTick(function () {
          var el = document.querySelector('[data-bfb-node="' + t + ':' + id + '"] .bfb-node__main');
          if (el) el.focus();
        });
      },
      dragStart: function (t, id, ev) {
        this.drag = { t: t, id: id };
        try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', t + ':' + id); } catch (e) { /* IE-era */ }
      },
      dragOver: function (t, id, ev) {
        if (!this.drag) return;
        var ok = this.drag.t === t || (this.drag.t === 'field' && t === 'section') || (this.drag.t === 'section' && t === 'page');
        if (!ok || (this.drag.t === t && this.drag.id === id)) { this.dropAt = null; return; }
        ev.preventDefault();
        var r = ev.currentTarget.getBoundingClientRect();
        var pos = this.drag.t !== t ? 'into' : (ev.clientY < r.top + r.height / 2 ? 'before' : 'after');
        this.dropAt = { t: t, id: id, pos: pos };
      },
      dropClass: function (t, id) {
        var d = this.dropAt;
        return d && d.t === t && d.id === id ? 'is-drop-' + d.pos : '';
      },
      dragEnd: function () { this.drag = null; this.dropAt = null; },
      drop: function () {
        var d = this.drag, at = this.dropAt;
        this.drag = null; this.dropAt = null;
        if (!d || !at) return;
        var src = this.loc(d.t, d.id);
        if (!src) return;
        var node, list;
        if (d.t === 'field') { list = src.sec.fields; node = list.splice(src.fi, 1)[0]; }
        else if (d.t === 'section') {
          if (src.pg.sections.length < 2 && !(at.t === 'section' && this.loc('section', at.id).pg === src.pg)) { this.note = 'A page needs at least one section.'; return; }
          list = src.pg.sections; node = list.splice(src.si, 1)[0];
        } else { list = this.doc.pages; node = list.splice(src.pi, 1)[0]; }
        var tgt = this.loc(at.t, at.id);
        if (at.pos === 'into') {
          if (at.t === 'section') tgt.sec.fields.push(node); else tgt.pg.sections.push(node);
        } else {
          var arr = at.t === 'field' ? tgt.sec.fields : at.t === 'section' ? tgt.pg.sections : this.doc.pages;
          var idx = at.t === 'field' ? tgt.fi : at.t === 'section' ? tgt.si : tgt.pi;
          arr.splice(at.pos === 'after' ? idx + 1 : idx, 0, node);
        }
        this.select(d.t, d.id);
      },

      /* ---- ids + labels ---- */
      labelInput: function () {
        var f = this.cur;
        if (!f || !(f.$builder && f.$builder.autoId)) return;
        var taken = allIds(this.doc).field;
        delete taken[f.id];
        var next = uniqueId(camelId(f.label || KINDS[kindOf(f)].label), taken);
        if (next !== f.id) { renameRefs(this.doc, f.id, next); f.id = next; this.sel.id = next; this.idDraft = next; }
      },
      commitId: function () {
        var f = this.cur, v = String(this.idDraft || '').trim();
        if (!f || v === f.id) { this.idErr = ''; return; }
        if (!ID_RE.test(v)) { this.idErr = 'Letters, digits and _ only, starting with a letter.'; return; }
        if (allIds(this.doc).field[v]) { this.idErr = 'Another control already has that id.'; return; }
        renameRefs(this.doc, f.id, v);
        f.id = v;
        f.$builder = f.$builder || { kind: kindOf(f) };
        f.$builder.autoId = false;
        this.sel.id = v;
        this.idErr = '';
      },
      refsHere: function () { var f = this.cur; return f ? refsTo(this.doc, f.id) : []; },

      /* ---- list + schema (B3) ---- */
      openPicker: function () {
        this.pick.open = true;
        if (!this.pick.site && this.doc.$builder && this.doc.$builder.list && this.doc.$builder.list.siteUrl) this.pick.site = this.doc.$builder.list.siteUrl;
        if (this.pick.state === 'idle') this.loadLists();
        var root = this.$root;
        this.$nextTick(function () { var i = root.querySelector('.bfb-pick input'); if (i) i.focus(); });
      },
      loadLists: function () {
        var self = this;
        this.pick.state = 'loading'; this.pick.err = '';
        lists.ready().then(function () { return lists.getWebLists(self.pick.site || undefined); }).then(function (ls) {
          self.pick.lists = ls; self.pick.state = 'ready';
        }).catch(function (e) {
          self.pick.state = 'error';
          self.pick.err = (e && e.message) || String(e);
        });
      },
      currentListId: function () { var l = this.doc.$builder && this.doc.$builder.list; return l ? l.listId : null; },
      chooseList: function (l) {
        var self = this, curId = this.currentListId();
        if (curId === l.id) { this.pick.open = false; return; }
        var mapped = 0;
        eachField(this.doc, function (f) { if (f.column) mapped++; });
        var go = function () { self.useList(l); };
        if (curId && mapped) {
          this.confirm('Switch lists?', 'Every control’s column mapping (' + mapped + ') is cleared — the controls, their choices and rules stay. Undo can bring the mappings back.', 'Switch and clear', go);
        } else go();
      },
      useList: function (l) {
        var self = this;
        this.pick.open = false;
        eachField(this.doc, function (f) { unmap(f); });
        delete this.doc.sharedColumns;
        this.loadSchema({ siteUrl: this.pick.site || undefined, listId: l.id }, function (res) {
          var web = pathOf(res.list.webUrl || '');
          self.doc.target = self.doc.target || {};
          delete self.doc.target.listTitle; delete self.doc.target.listId;
          self.doc.target.siteUrl = web || '/';
          self.doc.target.listUrl = res.list.url;
          if (self.doc.target.sendEmpty == null) self.doc.target.sendEmpty = true;
          self.doc.$builder = self.doc.$builder || { version: 1 };
          self.doc.$builder.list = { siteUrl: web || '/', listId: res.list.id, listTitle: res.list.title, listUrl: res.list.url };
        });
      },
      loadSchema: function (spec, then) {
        var self = this;
        this.schema = { state: 'loading', err: '', catalog: null };
        lists.ready().then(function () { return lists.getListSchema(spec); }).then(function (res) {
          self.schema = { state: 'ready', err: '', catalog: buildCatalog(res) };
          if (then) then(res);
          self.recheck();
        }).catch(function (e) {
          self.schema = { state: 'error', err: (e && e.message) || String(e), catalog: null };
          self.recheck();
        });
      },
      listTitle: function () { var l = this.doc.$builder && this.doc.$builder.list; return l ? l.listTitle : ''; },
      catalogCols: function () { return this.schema.catalog ? this.schema.catalog.cols : []; },
      colUsers: function (name) {
        var out = [];
        eachField(this.doc, function (f) { if (f.column === name) out.push(f.label || f.id); });
        return out;
      },
      // an unmapped column's status line: a required one is fine when its
      // default applies (verified on dev, B0) or Title has a template
      hasDefault: function (c) { return c.fd.DefaultValue != null && c.fd.DefaultValue !== ''; },
      reqUnmet: function (c) {
        if (!c.fd.Required || this.hasDefault(c)) return false;
        return !(c.name === 'Title' && templateAlwaysFilled(this.doc.target && this.doc.target.titleTemplate));
      },
      colFree: function (c) {
        if (!c.fd.Required) return 'not mapped';
        if (this.hasDefault(c)) return 'required — its default is saved';
        return this.reqUnmet(c) ? 'required — not mapped' : 'required — the item title fills it';
      },
      colFlags: function (c) {
        var fd = c.fd, out = [];
        if (fd.Required) out.push('required');
        if (fd.DefaultValue != null && fd.DefaultValue !== '') {
          out.push(c.type === 'Boolean' ? 'default ' + (fd.DefaultValue === '1' ? 'Yes' : 'No') : 'default “' + fd.DefaultValue + '”');
        }
        if (fd.MaxLength && c.type === 'Text') out.push('max ' + fd.MaxLength);
        if (c.type === 'DateTime') out.push(fd.DisplayFormat === 0 ? 'date only' : 'date + time');
        if (c.type === 'Number' || c.type === 'Currency') {
          if (fd.MinimumValue != null) out.push('min ' + fd.MinimumValue);
          if (fd.MaximumValue != null) out.push('max ' + fd.MaximumValue);
        }
        if (fd.FillInChoice) out.push('fill-in');
        if (fd.EnforceUniqueValues) out.push('unique');
        return out;
      },

      /* ---- mapping (B4) ---- */
      // columns this control can save to: [{ name, label, used, warn }]
      colOptions: function (f) {
        var self = this, kind = kindOf(f);
        return this.catalogCols().filter(function (c) { return fit(kind, c); }).map(function (c) {
          var users = [];
          eachField(self.doc, function (x) { if (x !== f && x.column === c.name) users.push(x.label || x.id); });
          return { name: c.name, label: c.title + (c.title !== c.name ? ' (' + c.name + ')' : '') + ' — ' + c.type +
            (fit(kind, c) === 'warn' ? ' · not ideal' : '') + (users.length ? ' · also used by ' + users.join(', ') : '') };
        });
      },
      curCol: function () {
        var f = this.cur;
        return f && f.column && this.schema.catalog ? this.schema.catalog.byName[f.column] || null : null;
      },
      setColumn: function (name) {
        var f = this.cur;
        if (!f) return;
        if (!name) { unmap(f); return; }
        var col = this.schema.catalog && this.schema.catalog.byName[name];
        if (!col) return;
        delete f.default; // the new column's default replaces the old one's
        applyColumn(f, col, kindOf(f));
      },
      setLogicOnly: function (on) {
        var f = this.cur;
        if (!f) return;
        f.$builder = f.$builder || { kind: kindOf(f) };
        if (on) { unmap(f); f.$builder.logicOnly = true; } else delete f.$builder.logicOnly;
      },
      isLogicOnly: function () { var f = this.cur; return !!(f && f.$builder && f.$builder.logicOnly); },
      colRequired: function () { var c = this.curCol(); return !!(c && c.fd.Required); },
      colDateOnly: function () { var c = this.curCol(); return !!(c && c.type === 'DateTime' && c.fd.DisplayFormat === 0); },
      colIs: function (types) { var c = this.curCol(); return !!(c && types.split(',').indexOf(c.type) > -1); },
      colMax: function () { var c = this.curCol(); return c && c.type === 'Text' ? c.fd.MaxLength : null; },

      /* ---- type-specific setters ---- */
      validateAs: function () {
        var f = this.cur;
        if (!f) return '';
        if (f.type === 'email' || f.type === 'phone') return f.type;
        return f.validation && f.validation.url ? 'url' : '';
      },
      setValidateAs: function (v) {
        var f = this.cur;
        if (!f) return;
        f.validation = f.validation || {};
        delete f.validation.url;
        if (v === 'email' || v === 'phone') f.type = v;
        else { f.type = 'text'; if (v === 'url') f.validation.url = true; }
      },
      num: function (obj, key, raw) {
        // number inputs: '' removes the key
        if (raw === '' || raw == null) delete obj[key];
        else if (!isNaN(Number(raw))) obj[key] = Number(raw);
      },
      v: function () { var f = this.cur; if (f && !f.validation) f.validation = {}; return f ? f.validation : {}; },
      setDisplay: function (d) {
        var f = this.cur;
        if (!f) return;
        if (d === 'input') delete f.display; else { f.display = d; this.v().integer = true; }
      },
      numberBounded: function () {
        var v = (this.cur && this.cur.validation) || {};
        return typeof v.min === 'number' && typeof v.max === 'number' && v.min % 1 === 0 && v.max % 1 === 0 && v.max > v.min;
      },
      setWords: function (on) {
        var f = this.cur;
        if (!f) return;
        if (on) f.values = f.values || { on: 'Yes', off: 'No' }; else delete f.values;
      },
      setMe: function (on) { var f = this.cur; if (!f) return; if (on) f.default = '@me'; else delete f.default; },
      setOpt: function (key, on) { var f = this.cur; if (!f) return; if (on) f[key] = true; else delete f[key]; },

      /* ---- choices editor ---- */
      choiceRows: function () {
        // a Choice/MultiChoice column: every column choice, included ones
        // first in the control's order; otherwise the control's own list
        var f = this.cur, col = this.curCol();
        if (!f) return [];
        normChoicesQuiet(f);
        if (!col || (col.type !== 'Choice' && col.type !== 'MultiChoice')) {
          return f.choices.map(function (c, i) { return { c: c, i: i, on: true, fixed: false }; });
        }
        var rows = f.choices.map(function (c, i) { return { c: c, i: i, on: true, fixed: true }; });
        colChoices(col).forEach(function (v) {
          if (!f.choices.some(function (c) { return c.value === v; })) rows.push({ c: { value: v }, i: -1, on: false, fixed: true });
        });
        return rows;
      },
      choiceFixed: function () { var c = this.curCol(); return !!(c && (c.type === 'Choice' || c.type === 'MultiChoice')); },
      toggleChoice: function (row) {
        var f = this.cur;
        if (row.on) { if (f.choices.length > 1) f.choices.splice(row.i, 1); else this.note = 'Keep at least one choice.'; }
        else f.choices.push({ value: row.c.value, color: COLORS[f.choices.length % COLORS.length] });
        if (f.default != null && !f.choices.some(function (c) { return c.value === f.default; })) delete f.default;
      },
      moveChoice: function (i, dir) {
        var a = this.cur.choices, j = i + dir;
        if (j < 0 || j >= a.length) return;
        a.splice(j, 0, a.splice(i, 1)[0]);
      },
      addChoice: function () {
        var a = this.cur.choices, n = a.length + 1, v = 'Option ' + n;
        while (a.some(function (c) { return c.value === v; })) v = 'Option ' + ++n;
        a.push({ value: v, color: COLORS[a.length % COLORS.length] });
      },
      dropChoice: function (i) {
        var a = this.cur.choices;
        if (a.length < 2) { this.note = 'Keep at least one choice.'; return; }
        a.splice(i, 1);
      },
      setChoiceLabel: function (c, v) { if (v && v !== c.value) c.label = v; else delete c.label; },
      canFillIn: function () {
        var c = this.curCol();
        return !c || c.type === 'Text' || !!c.fd.FillInChoice;
      },

      /* ---- download (B7) ---- */
      openDownload: function () {
        if (this.nErr) { this.showIssues = true; return; }
        this.dl.open = true;
        this.dl.done = false;
        if (!this.dl.slug) this.dl.slug = slugify(this.doc.form && this.doc.form.title);
      },
      configUrl: function () { return pathOf(window.BSPForms.engineBase || '') + '/forms/' + slugify(this.dl.slug) + '.json'; },
      slugOrForm: function () { return slugify(this.dl.slug); },
      doDownload: function (what) {
        var slug = slugify(this.dl.slug);
        this.dl.slug = slug;
        if (what !== 'stub') {
          this.doc.$builder = this.doc.$builder || { version: 1 };
          this.doc.$builder.savedAt = new Date().toISOString();
          downloadText(slug + '.json', JSON.stringify(serialize(this.doc), null, 2) + '\n', 'application/json');
        }
        if (what !== 'json') {
          downloadText(slug + '.webpart.html', stubHtml(this.doc.form && this.doc.form.title, this.configUrl(), window.BSPForms.engineSrc || '', this.dl.validate), 'text/html');
        }
        this.dl.done = true;
      },
      jsonText: function () { return JSON.stringify(serialize(this.doc), null, 2); },
      tokens: ['{form:title}', '{user:name}', '{user:email}', '{date}', '{time}'],
      addToken: function (tok) {
        var t = this.doc.target;
        t.titleTemplate = (t.titleTemplate ? t.titleTemplate + ' ' : '') + tok;
      },
      fieldTokens: function () {
        var out = [];
        eachField(this.doc, function (f) { if (isValueKind(kindOf(f))) out.push('{field:' + f.id + '}'); });
        return out;
      }
    };
  };
  function normChoicesQuiet(f) {
    // only rewrite when something isn't already an object (no needless writes
    // inside a render — they'd retrigger the deep watch)
    if (!Array.isArray(f.choices)) { f.choices = []; return; }
    if (f.choices.some(function (c) { return typeof c === 'string' || !c.color; })) normChoices(f);
  }

  /* ------------------------------------------------------------------
     Markup
     ------------------------------------------------------------------ */
  function seg(model, opts, setter, disabledExpr) {
    // a segmented control: opts [[value, label], …]; model = expression
    return '<div class="bfb-seg" role="radiogroup">' + opts.map(function (o) {
      var val = esc(jstr(o[0]));
      return '<button type="button" role="radio" class="bfb-seg__opt" :class="{ \'is-on\': ' + model + ' === ' + val + ' }"' +
        ' :aria-checked="' + model + ' === ' + val + ' ? \'true\' : \'false\'"' +
        (disabledExpr ? ' :disabled="' + disabledExpr.split('$v').join(val) + '"' : '') +
        ' @click="' + setter.split('$v').join(val) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function sw(label, model, change, disabled) {
    return '<label class="switch bfb-switch">' +
      '<input type="checkbox" :checked="' + model + '" @change="' + change + '"' + (disabled ? ' :disabled="' + disabled + '"' : '') + '>' +
      '<span class="switch__track"></span><span>' + esc(label) + '</span></label>';
  }
  function fieldRow(label, inner, hint) {
    return '<div class="field bfb-prop"><label class="field__label">' + esc(label) + '</label>' + inner +
      (hint ? '<p class="field__hint">' + hint + '</p>' : '') + '</div>';
  }
  function card(title, iconName, inner, extra) {
    return '<section class="bfb-card"' + (extra || '') + '><h3 class="bfb-card__title">' + icon(iconName, 16) + '<span>' + esc(title) + '</span></h3>' + inner + '</section>';
  }

  function renderOutline() {
    var h = '<aside class="bfb-outline" aria-label="Form outline">';
    h += '<div class="bfb-outline__head"><span class="bfb-eyebrow">Outline</span>' +
      '<button type="button" class="btn btn--sm btn--subtle" @click="addPage()">' + icon('add') + '<span>Page</span></button></div>';
    // the form node
    h += '<div class="bfb-node bfb-node--form" data-bfb-node="form:" :class="{ \'is-sel\': isSel(\'form\') }">' +
      '<button type="button" class="bfb-node__main" @click="select(\'form\')">' +
      '<span class="bfb-tile bfb-tile--blue">' + icon('document', 16) + '</span>' +
      '<span class="bfb-node__text"><span class="bfb-node__title" x-text="doc.form.title || \'Untitled form\'"></span>' +
      '<span class="bfb-node__sub" x-text="listTitle() ? \'Saves to \' + listTitle() : \'No list yet\'"></span></span></button>' +
      '<span class="bfb-dot bfb-dot--error" x-show="worst(\'form\', null)===\'error\'" x-cloak title="Has problems"></span></div>';
    // pages
    h += '<template x-for="(pg, pi) in doc.pages" :key="pg.id">';
    h += '<div class="bfb-page">';
    h += '<div class="bfb-node bfb-node--page" :data-bfb-node="\'page:\' + pg.id" :class="[isSel(\'page\', pg.id) ? \'is-sel\' : \'\', dropClass(\'page\', pg.id)]"' +
      ' draggable="true" @dragstart="dragStart(\'page\', pg.id, $event)" @dragend="dragEnd()"' +
      ' @dragover="dragOver(\'page\', pg.id, $event)" @drop.prevent="drop()">' +
      '<span class="bfb-grip" aria-hidden="true">⋮⋮</span>' +
      '<button type="button" class="bfb-node__main" @click="select(\'page\', pg.id)">' +
      '<span class="bfb-step" x-text="pi + 1"></span>' +
      '<span class="bfb-node__text"><span class="bfb-node__title" x-text="pg.title || (\'Page \' + (pi + 1))"></span>' +
      '<span class="bfb-node__sub" x-text="pg.sections.reduce(function (n, s) { return n + s.fields.length; }, 0) + \' controls\'"></span></span></button>' +
      '<span class="bfb-node__tools">' +
      '<button type="button" class="icon-btn" title="Move up" aria-label="Move page up" @click="move(\'page\', pg.id, -1)" :disabled="pi===0">' + icon('arrow-up') + '</button>' +
      '<button type="button" class="icon-btn" title="Move down" aria-label="Move page down" @click="move(\'page\', pg.id, 1)" :disabled="pi===doc.pages.length-1">' + icon('arrow-down') + '</button>' +
      '<button type="button" class="icon-btn" title="Delete page" aria-label="Delete page" @click="remove(\'page\', pg.id)">' + icon('delete') + '</button>' +
      '</span></div>';
    // sections
    h += '<template x-for="(sec, si) in pg.sections" :key="sec.id">';
    h += '<div class="bfb-section">';
    h += '<div class="bfb-node bfb-node--section" :data-bfb-node="\'section:\' + sec.id" :class="[isSel(\'section\', sec.id) ? \'is-sel\' : \'\', dropClass(\'section\', sec.id)]"' +
      ' draggable="true" @dragstart.stop="dragStart(\'section\', sec.id, $event)" @dragend="dragEnd()"' +
      ' @dragover.stop="dragOver(\'section\', sec.id, $event)" @drop.prevent.stop="drop()">' +
      '<span class="bfb-grip" aria-hidden="true">⋮⋮</span>' +
      '<button type="button" class="bfb-node__main" @click="select(\'section\', sec.id)">' +
      '<span class="bfb-tile bfb-tile--neutral">' + icon('grid', 16) + '</span>' +
      '<span class="bfb-node__text"><span class="bfb-node__title" x-text="sec.title || \'Untitled section\'"></span>' +
      '<span class="bfb-node__sub" x-text="(sec.columns === 2 ? \'Two columns\' : \'One column\') + \' · \' + sec.fields.length + \' controls\'"></span></span></button>' +
      '<span class="bfb-node__tools">' +
      '<button type="button" class="icon-btn" title="Move up" aria-label="Move section up" @click="move(\'section\', sec.id, -1)">' + icon('arrow-up') + '</button>' +
      '<button type="button" class="icon-btn" title="Move down" aria-label="Move section down" @click="move(\'section\', sec.id, 1)">' + icon('arrow-down') + '</button>' +
      '<button type="button" class="icon-btn" title="Delete section" aria-label="Delete section" @click="remove(\'section\', sec.id)">' + icon('delete') + '</button>' +
      '</span></div>';
    // fields
    h += '<div class="bfb-fields">';
    h += '<template x-for="(f, fi) in sec.fields" :key="f.id">';
    h += '<div class="bfb-node bfb-node--field" :data-bfb-node="\'field:\' + f.id"' +
      ' :class="[isSel(\'field\', f.id) ? \'is-sel\' : \'\', dropClass(\'field\', f.id), worst(\'field\', f.id) ? \'has-\' + worst(\'field\', f.id) : \'\']"' +
      ' draggable="true" @dragstart.stop="dragStart(\'field\', f.id, $event)" @dragend="dragEnd()"' +
      ' @dragover.stop="dragOver(\'field\', f.id, $event)" @drop.prevent.stop="drop()">' +
      '<span class="bfb-grip" aria-hidden="true">⋮⋮</span>' +
      '<button type="button" class="bfb-node__main" @click="select(\'field\', f.id)">' +
      '<span class="bfb-tile" :class="\'bfb-tile--\' + kindHue(f)"><svg class="icon icon--16" aria-hidden="true"><use :href="\'#ic-fluent-\' + kindIcon(f) + \'-24-regular\'"/></svg></span>' +
      '<span class="bfb-node__text"><span class="bfb-node__title"><span x-text="fieldName(f)"></span>' +
      '<span class="bfb-req" x-show="f.required" aria-label="required">*</span></span>' +
      '<span class="bfb-node__sub">' +
      '<span x-text="kindLabel(f)"></span>' +
      '<template x-if="isValue(f) && f.column"><span class="bfb-colpill" x-text="\'→ \' + f.column"></span></template>' +
      '<template x-if="isValue(f) && !f.column && f.$builder && f.$builder.logicOnly"><span class="bfb-colpill bfb-colpill--muted">not saved</span></template>' +
      '<template x-if="isValue(f) && !f.column && !(f.$builder && f.$builder.logicOnly)"><span class="bfb-colpill bfb-colpill--error">not mapped</span></template>' +
      '</span></span></button>' +
      '<span class="bfb-node__tools">' +
      '<button type="button" class="icon-btn" title="Move up" aria-label="Move control up" @click="move(\'field\', f.id, -1)">' + icon('arrow-up') + '</button>' +
      '<button type="button" class="icon-btn" title="Move down" aria-label="Move control down" @click="move(\'field\', f.id, 1)">' + icon('arrow-down') + '</button>' +
      '<button type="button" class="icon-btn" title="Duplicate" aria-label="Duplicate control" @click="duplicate(f.id)">' + icon('add') + '</button>' +
      '<button type="button" class="icon-btn" title="Delete" aria-label="Delete control" @click="remove(\'field\', f.id)">' + icon('delete') + '</button>' +
      '</span></div>';
    h += '</template>';
    h += '<div class="bfb-empty" x-show="!sec.fields.length" @dragover="dragOver(\'section\', sec.id, $event)" @drop.prevent="drop()">Drop controls here, or add one below.</div>';
    // palette
    h += '<div class="bfb-add">' +
      '<button type="button" class="bfb-add__btn" @click="openPalette(sec.id)" :aria-expanded="palette===sec.id ? \'true\' : \'false\'">' + icon('add') + '<span>Add control</span></button>' +
      '<div class="bfb-palette" x-show="palette===sec.id" x-cloak @click.outside="palette=null" @keydown.escape.stop="palette=null">' +
      PALETTE.map(function (k) {
        return '<button type="button" class="bfb-palette__item" @click="addField(sec.id, ' + esc(jstr(k)) + ')">' +
          '<span class="bfb-tile bfb-tile--' + KINDS[k].hue + '">' + icon(KINDS[k].icon, 16) + '</span><span>' + esc(KINDS[k].label) + '</span></button>';
      }).join('') + '</div></div>';
    h += '</div></div></template>';
    h += '<button type="button" class="bfb-add__btn bfb-add__btn--section" @click="addSection(pg.id)">' + icon('add') + '<span>Add section</span></button>';
    h += '</div></template>';
    h += '</aside>';
    return h;
  }

  function renderFormProps() {
    var h = '<div class="bfb-props__head"><span class="bfb-tile bfb-tile--blue bfb-tile--lg">' + icon('document', 20) + '</span>' +
      '<div><div class="bfb-eyebrow">Form</div><h2 class="bfb-props__title" x-text="doc.form.title || \'Untitled form\'"></h2></div></div>';
    h += card('Basics', 'edit',
      fieldRow('Title', '<input class="input" type="text" x-model="doc.form.title">') +
      fieldRow('Intro', '<textarea class="textarea" rows="3" x-model="doc.form.intro"></textarea>', 'Shown under the title. [text](url) makes a link.') +
      '<div class="bfb-prop">' + sw('Show the title on the page', 'doc.form.showTitle !== false', 'if ($event.target.checked) delete doc.form.showTitle; else doc.form.showTitle = false') + '</div>');
    h += card('Saves to', 'folder',
      '<div class="bfb-listcard" :class="{ \'is-empty\': !listTitle() }">' +
      '<span class="bfb-tile bfb-tile--sky">' + icon('folder', 16) + '</span>' +
      '<div class="bfb-listcard__text"><strong x-text="listTitle() || \'No list picked\'"></strong>' +
      '<span x-text="doc.target.listUrl || \'Pick the list each response is saved to.\'"></span></div>' +
      '<button type="button" class="btn btn--sm" @click="openPicker()" x-text="listTitle() ? \'Change\' : \'Pick a list\'"></button></div>' +
      fieldRow('Item title', '<input class="input" type="text" x-model="doc.target.titleTemplate" placeholder="{form:title} — {user:name}">' +
        '<div class="bfb-tokens"><template x-for="t in tokens.concat(fieldTokens())" :key="t"><button type="button" class="chip bfb-chip" @click="addToken(t)" x-text="t"></button></template></div>',
        'Fills the list’s Title column when no control saves to it.'));
    // the column catalog
    h += card('List columns', 'grid',
      '<div class="bfb-state" x-show="schema.state===\'none\'">Pick a list to see its columns.</div>' +
      '<div class="bfb-state" x-show="schema.state===\'loading\'" x-cloak><span class="spinner spinner--16" aria-hidden="true"></span> Reading the list’s columns…</div>' +
      '<div class="msgbar msgbar--danger" x-show="schema.state===\'error\'" x-cloak>' + icon('dismiss-circle', 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body" x-text="\'The columns couldn’t be read: \' + schema.err"></div></div>' +
      '<div class="bfb-cols" x-show="schema.state===\'ready\'" x-cloak>' +
      '<template x-for="c in catalogCols()" :key="c.name">' +
      '<div class="bfb-col" :class="{ \'is-off\': !c.ok, \'is-used\': colUsers(c.name).length }">' +
      '<div class="bfb-col__main"><span class="bfb-col__title" x-text="c.title"></span><span class="bfb-col__name" x-show="c.title !== c.name" x-text="c.name"></span>' +
      '<span class="bfb-col__type" x-text="c.type"></span>' +
      '<template x-for="fl in colFlags(c)" :key="fl"><span class="bfb-flag" x-text="fl"></span></template></div>' +
      '<div class="bfb-col__state">' +
      '<template x-if="!c.ok"><span class="bfb-col__why" x-text="c.reason"></span></template>' +
      '<template x-if="c.ok && colUsers(c.name).length"><span class="bfb-colpill" x-text="\'← \' + colUsers(c.name).join(\', \')"></span></template>' +
      '<template x-if="c.ok && !colUsers(c.name).length"><span class="bfb-col__free" :class="{ \'is-req\': reqUnmet(c) }" x-text="colFree(c)"></span></template>' +
      '</div></div></template></div>');
    return h;
  }
  function renderPageProps() {
    return '<div class="bfb-props__head"><span class="bfb-tile bfb-tile--blue bfb-tile--lg">' + icon('document', 20) + '</span>' +
      '<div><div class="bfb-eyebrow">Page</div><h2 class="bfb-props__title" x-text="curPage.title || \'Untitled page\'"></h2></div></div>' +
      card('Page', 'edit',
        fieldRow('Title', '<input class="input" type="text" x-model="curPage.title">', 'Shown in the step indicator.') +
        fieldRow('Description', '<textarea class="textarea" rows="2" x-model="curPage.description"></textarea>')) +
      '<p class="bfb-later">' + icon('info') + '<span>Show-when and end-the-form rules come with the rules editor.</span></p>';
  }
  function renderSectionProps() {
    return '<div class="bfb-props__head"><span class="bfb-tile bfb-tile--neutral bfb-tile--lg">' + icon('grid', 20) + '</span>' +
      '<div><div class="bfb-eyebrow">Section</div><h2 class="bfb-props__title" x-text="curSection.title || \'Untitled section\'"></h2></div></div>' +
      card('Section', 'edit',
        fieldRow('Heading', '<input class="input" type="text" x-model="curSection.title">') +
        fieldRow('Description', '<textarea class="textarea" rows="2" x-model="curSection.description"></textarea>') +
        fieldRow('Layout', seg('(curSection.columns === 2 ? 2 : 1)', [[1, 'One column'], [2, 'Two columns']], 'if ($v === 2) curSection.columns = 2; else delete curSection.columns'),
          'Two columns once the form is at least 600px wide; one below. A control can take the full row.') +
        fieldRow('Icon', '<div class="bfb-icons">' + SECTION_ICONS.map(function (n) {
          return '<button type="button" class="bfb-iconpick" :class="{ \'is-on\': (curSection.icon || \'\') === ' + esc(jstr(n)) + ' }"' +
            ' title="' + esc(n || 'none') + '" aria-label="' + esc(n || 'no icon') + '"' +
            ' @click="if (' + esc(jstr(n)) + ') curSection.icon = ' + esc(jstr(n)) + '; else delete curSection.icon">' +
            (n ? icon(n, 16) : '<span class="bfb-iconpick__none">—</span>') + '</button>';
        }).join('') + '</div>', 'Shown in a tile beside the heading.') +
        fieldRow('Background', seg('(curSection.tint || \'\')', [['', 'None'], ['sky', 'Sky'], ['blue', 'Blue'], ['neutral', 'Neutral']], 'if ($v) curSection.tint = $v; else delete curSection.tint')));
  }

  function renderFieldProps() {
    var h = '<div class="bfb-props__head"><span class="bfb-tile bfb-tile--lg" :class="\'bfb-tile--\' + kindHue(cur)">' +
      '<svg class="icon icon--20" aria-hidden="true"><use :href="\'#ic-fluent-\' + kindIcon(cur) + \'-24-regular\'"/></svg></span>' +
      '<div><div class="bfb-eyebrow" x-text="kindLabel(cur)"></div><h2 class="bfb-props__title" x-text="fieldName(cur)"></h2></div></div>';
    // this control's issues
    h += '<template x-for="(i, ii) in issuesFor(\'field\', cur.id)" :key="ii">' +
      '<div class="msgbar bfb-issue" :class="i.level===\'error\' ? \'msgbar--danger\' : \'msgbar--warning\'">' +
      '<div class="msgbar__body"><span class="bfb-src" x-text="i.source===\'engine\' ? \'Engine\' : \'Schema\'"></span> <span x-text="i.msg"></span></div></div></template>';
    // locked (advanced) controls
    h += '<template x-if="kindOf(cur)===\'locked\'"><div class="msgbar msgbar--info">' + icon('info', 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body">This control uses features the builder doesn’t edit (type “<span x-text="cur.type"></span>”). It’s kept exactly as it is — move or delete it here, edit it in the JSON.</div></div></template>';

    // basics
    h += '<template x-if="kindOf(cur)!==\'locked\'"><div>';
    h += '<template x-if="isValue(cur)">' + card('Basics', 'edit',
      fieldRow('Label', '<input class="input" type="text" x-model="cur.label" @input="labelInput()">') +
      fieldRow('Description', '<textarea class="textarea" rows="2" x-model="cur.hint"></textarea>', 'Help text under the control. [text](url) makes a link.') +
      '<div class="bfb-prop bfb-prop--row">' +
      sw('Required', '!!cur.required', 'setOpt(\'required\', $event.target.checked)', 'colRequired()') +
      sw('Full width', 'cur.span===\'full\'', 'if ($event.target.checked) cur.span = \'full\'; else delete cur.span') +
      '</div><p class="field__hint" x-show="colRequired()" x-cloak>The list requires this column, so the control is required.</p>') + '</template>';
    // heading / note / current user
    h += '<template x-if="kindOf(cur)===\'heading\'">' + card('Heading', 'edit',
      fieldRow('Text', '<input class="input" type="text" x-model="cur.text">') +
      fieldRow('Description', '<textarea class="textarea" rows="2" x-model="cur.description"></textarea>')) + '</template>';
    h += '<template x-if="kindOf(cur)===\'note\'">' + card('Note', 'edit',
      fieldRow('Text', '<textarea class="textarea" rows="3" x-model="cur.text"></textarea>', '[text](url) makes a link.') +
      fieldRow('Style', seg('(cur.style || \'info\')', [['info', 'Info'], ['warning', 'Warning'], ['success', 'Success'], ['danger', 'Danger'], ['plain', 'Plain']], 'cur.style = $v'))) + '</template>';
    h += '<template x-if="kindOf(cur)===\'currentUser\'">' + card('Current user card', 'person',
      fieldRow('Label', '<input class="input" type="text" x-model="cur.label">') +
      fieldRow('Description', '<textarea class="textarea" rows="2" x-model="cur.hint"></textarea>')) + '</template>';

    // saves to
    h += '<template x-if="isValue(cur)">' + card('Saves to', 'folder',
      '<div class="bfb-prop" x-show="!isLogicOnly()">' +
      '<label class="field__label" :for="\'bfb-col-\' + cur.id">Column</label>' +
      '<select class="select" :id="\'bfb-col-\' + cur.id" :disabled="schema.state!==\'ready\'" @change="setColumn($event.target.value)">' +
      '<option value="" :selected="!cur.column" x-text="schema.state===\'ready\' ? \'— Pick a column —\' : (listTitle() ? \'Loading columns…\' : \'Pick a list first\')"></option>' +
      '<template x-for="o in colOptions(cur)" :key="o.name"><option :value="o.name" :selected="cur.column===o.name" x-text="o.label"></option></template>' +
      '<template x-if="cur.column && !colOptions(cur).some(function (o) { return o.name === cur.column; })"><option :value="cur.column" selected x-text="cur.column + \' (not compatible)\'"></option></template>' +
      '</select>' +
      '<div class="bfb-colinfo" x-show="curCol()" x-cloak><span class="bfb-col__type" x-text="curCol() && curCol().type"></span>' +
      '<template x-for="fl in (curCol() ? colFlags(curCol()) : [])" :key="fl"><span class="bfb-flag" x-text="fl"></span></template></div>' +
      '</div>' +
      '<div class="bfb-prop">' + sw('Not saved (logic only)', 'isLogicOnly()', 'setLogicOnly($event.target.checked)') +
      '<p class="field__hint">For a control that only drives other questions. Every other control must save to a column.</p></div>') + '</template>';

    // type-specific
    h += '<template x-if="kindOf(cur)===\'text\'">' + card('Text', 'edit',
      fieldRow('Validate as', seg('validateAs()', [['', 'Plain text'], ['email', 'Email'], ['phone', 'Phone'], ['url', 'Web address']], 'setValidateAs($v)')) +
      fieldRow('Example text', '<input class="input" type="text" x-model="cur.placeholder">', 'Shown greyed in the empty box.') +
      '<div class="bfb-prop bfb-prop--row">' +
      '<div class="field"><label class="field__label">Min length</label><input class="input" type="number" min="0" :value="v().minLength" @change="num(v(), \'minLength\', $event.target.value)"></div>' +
      '<div class="field"><label class="field__label">Max length</label><input class="input" type="number" min="1" :max="colMax()" :value="v().maxLength" @change="num(v(), \'maxLength\', $event.target.value)"></div>' +
      '</div>') + '</template>';
    h += '<template x-if="kindOf(cur)===\'textarea\'">' + card('Multi-line text', 'document',
      fieldRow('Example text', '<input class="input" type="text" x-model="cur.placeholder">') +
      '<div class="bfb-prop bfb-prop--row">' +
      '<div class="field"><label class="field__label">Rows</label><input class="input" type="number" min="2" max="20" :value="cur.rows" @change="num(cur, \'rows\', $event.target.value)"></div>' +
      '<div class="field"><label class="field__label">Max length</label><input class="input" type="number" min="1" :value="v().maxLength" @change="num(v(), \'maxLength\', $event.target.value)"></div>' +
      '</div>' +
      '<p class="field__hint" x-show="cur.richText" x-cloak>The column is rich text: line breaks are kept as HTML.</p>') + '</template>';
    h += '<template x-if="kindOf(cur)===\'number\'">' + card('Number', 'data-bar-vertical',
      '<div class="bfb-prop bfb-prop--row">' +
      '<div class="field"><label class="field__label">Minimum</label><input class="input" type="number" :value="v().min" @change="num(v(), \'min\', $event.target.value)"></div>' +
      '<div class="field"><label class="field__label">Maximum</label><input class="input" type="number" :value="v().max" @change="num(v(), \'max\', $event.target.value)"></div>' +
      '</div>' +
      '<div class="bfb-prop">' + sw('Whole numbers only', '!!v().integer', 'if ($event.target.checked) v().integer = true; else delete v().integer', 'cur.display===\'dropdown\' || cur.display===\'slider\'') + '</div>' +
      fieldRow('Shown as', seg('(cur.display || \'input\')', [['input', 'Free entry'], ['dropdown', 'Dropdown'], ['slider', 'Slider']], 'setDisplay($v)',
        '$v !== \'input\' && (cur.type === \'currency\' || !numberBounded())'),
        'A dropdown or slider needs a whole-number minimum and maximum (and isn’t for currency).') +
      fieldRow('Example text', '<input class="input" type="text" x-model="cur.placeholder" :disabled="!!cur.display">')) + '</template>';
    h += '<template x-if="kindOf(cur)===\'boolean\'">' + card('Yes / No', 'checkmark-circle',
      fieldRow('Looks like', seg('(cur.control || \'switch\')', [['switch', 'Switch'], ['checkbox', 'Checkbox']], 'cur.control = $v')) +
      fieldRow('Text beside it', '<input class="input" type="text" x-model="cur.toggleText">', 'E.g. “Yes, I agree”. Without it, a checkbox shows the label.') +
      '<div class="bfb-prop">' + sw('Save words instead of yes/no', '!!cur.values', 'setWords($event.target.checked)', 'colIs(\'Boolean\') || colIs(\'Choice,Text\')') +
      '<p class="field__hint" x-show="colIs(\'Choice,Text\')" x-cloak>The column is ' + '<span x-text="curCol() && curCol().type"></span>, so the control saves these words.</p></div>' +
      '<div class="bfb-prop bfb-prop--row" x-show="cur.values" x-cloak>' +
      '<div class="field"><label class="field__label">When on</label><input class="input" type="text" :value="cur.values && cur.values.on" @input="cur.values.on = $event.target.value"></div>' +
      '<div class="field"><label class="field__label">When off</label><input class="input" type="text" :value="cur.values && cur.values.off" @input="cur.values.off = $event.target.value"></div>' +
      '</div>') + '</template>';
    // choices (single + multi)
    var choices = '<div class="bfb-choices">' +
      '<template x-for="(row, ri) in choiceRows()" :key="row.c.value + \':\' + ri">' +
      '<div class="bfb-choice" :class="{ \'is-off\': !row.on }">' +
      '<template x-if="row.fixed"><label class="check bfb-choice__on"><input type="checkbox" :checked="row.on" @change="toggleChoice(row)"><span class="bfb-sr">Include</span></label></template>' +
      '<span class="bspf-pill bfb-choice__pill" :class="\'bspf-pill--\' + (row.c.color || \'gray\')"><span x-text="row.c.label || row.c.value"></span></span>' +
      '<template x-if="!row.fixed"><input class="input bfb-choice__value" type="text" :value="row.c.value" aria-label="Value" @change="row.c.value = $event.target.value"></template>' +
      '<template x-if="row.on"><input class="input bfb-choice__label" type="text" :value="row.c.label || \'\'" :placeholder="row.fixed ? \'Label (shown)\' : \'Label if different\'" aria-label="Label" @change="setChoiceLabel(row.c, $event.target.value)"></template>' +
      '<template x-if="row.on"><span class="bfb-swatches">' + COLORS.map(function (c) {
        return '<button type="button" class="bspf-dot bspf-dot--' + c + ' bfb-swatch" :class="{ \'is-on\': row.c.color === ' + esc(jstr(c)) + ' }" title="' + c + '" aria-label="' + c + '" @click="row.c.color = ' + esc(jstr(c)) + '"></button>';
      }).join('') + '</span></template>' +
      '<template x-if="row.on"><span class="bfb-choice__tools">' +
      '<button type="button" class="icon-btn" aria-label="Move up" @click="moveChoice(row.i, -1)">' + icon('arrow-up') + '</button>' +
      '<button type="button" class="icon-btn" aria-label="Move down" @click="moveChoice(row.i, 1)">' + icon('arrow-down') + '</button>' +
      '<template x-if="!row.fixed"><button type="button" class="icon-btn" aria-label="Remove" @click="dropChoice(row.i)">' + icon('dismiss') + '</button></template>' +
      '</span></template>' +
      '</div></template></div>' +
      '<button type="button" class="btn btn--sm" x-show="!choiceFixed()" @click="addChoice()">' + icon('add') + '<span>Add a choice</span></button>' +
      '<p class="field__hint" x-show="choiceFixed()" x-cloak>The column’s own choices — tick the ones this form offers. Values can’t change; labels and colours can.</p>';
    h += '<template x-if="kindOf(cur)===\'choice\' || kindOf(cur)===\'multichoice\'">' + card('Choices', 'filter',
      choices +
      '<div class="bfb-prop">' + sw('Offer “Other” (type your own)', '!!cur.fillIn', 'setOpt(\'fillIn\', $event.target.checked)', '!canFillIn() && !cur.fillIn') +
      '<p class="field__hint" x-show="!canFillIn()" x-cloak>The column doesn’t allow fill-in values.</p></div>' +
      fieldRow('Example text', '<input class="input" type="text" x-model="cur.placeholder">') +
      '<div class="bfb-prop bfb-prop--row" x-show="kindOf(cur)===\'multichoice\'">' +
      '<div class="field"><label class="field__label">At least</label><input class="input" type="number" min="0" :value="v().minChoices" @change="num(v(), \'minChoices\', $event.target.value)"></div>' +
      '<div class="field"><label class="field__label">At most</label><input class="input" type="number" min="1" :value="v().maxChoices" @change="num(v(), \'maxChoices\', $event.target.value)"></div>' +
      '</div>') + '</template>';
    h += '<template x-if="kindOf(cur)===\'date\'">' + card('Date', 'calendar-ltr',
      '<div class="bfb-prop">' + sw('Include a time', '!!cur.includeTime', 'setOpt(\'includeTime\', $event.target.checked)', 'colDateOnly()') +
      '<p class="field__hint" x-show="colDateOnly()" x-cloak>The column is date-only.</p></div>' +
      '<p class="bfb-later">' + icon('info') + '<span>Business-day and date-range rules come with the rules editor.</span></p>') + '</template>';
    h += '<template x-if="kindOf(cur)===\'person\'">' + card('Person', 'person',
      '<div class="bfb-prop">' + sw('Start with the person filling it in', 'cur.default===\'@me\'', 'setMe($event.target.checked)') +
      '<p class="field__hint">Still editable — for requests made on someone’s behalf.</p></div>' +
      '<div class="bfb-prop">' + sw('Allow several people', '!!cur.multiple', 'setOpt(\'multiple\', $event.target.checked)', '!!curCol()') +
      '<p class="field__hint" x-show="curCol()" x-cloak>Set by the column (<span x-text="curCol() && curCol().type"></span>).</p></div>' +
      '<div class="bfb-prop bfb-prop--row" x-show="cur.multiple" x-cloak><div class="field"><label class="field__label">At most</label>' +
      '<input class="input" type="number" min="1" :value="v().maxPeople" @change="num(v(), \'maxPeople\', $event.target.value)"></div></div>' +
      fieldRow('Example text', '<input class="input" type="text" x-model="cur.placeholder">')) + '</template>';
    h += '<template x-if="kindOf(cur)===\'url\'">' + card('URL', 'open',
      '<div class="bfb-prop" x-show="cur.type===\'link\'">' + sw('Also ask for display text', '!!cur.withDescription', 'setOpt(\'withDescription\', $event.target.checked)') + '</div>' +
      '<p class="field__hint" x-show="cur.type!==\'link\'">Saved as text and checked as a web address (the column is single line of text).</p>' +
      fieldRow('Example text', '<input class="input" type="text" x-model="cur.placeholder">')) + '</template>';

    // id + references
    h += card('Id', 'settings',
      fieldRow('Control id', '<input class="input bfb-mono" type="text" x-model="idDraft" @change="commitId()" @keydown.enter.prevent="commitId()" spellcheck="false">',
        'Rules and {field:…} tokens use it; renaming updates them.') +
      '<p class="field__error" x-show="idErr" x-text="idErr" x-cloak></p>' +
      '<div class="bfb-refs" x-show="refsHere().length" x-cloak><span class="bfb-eyebrow">Used by</span>' +
      '<template x-for="r in refsHere()" :key="r"><span class="bfb-flag" x-text="r"></span></template></div>');
    h += '<p class="bfb-later">' + icon('info') + '<span>Show-when rules and choice limits come with the rules editor.</span></p>';
    h += '</div></template>';
    return h;
  }

  function renderBuilder() {
    var h = '<div class="bfb" x-data="bspFormsBuilder()" :class="{ \'bfb--full\': full }" @keydown.window="keys($event)">';
    // header band
    h += '<header class="bfb-bar">' +
      '<div class="bfb-bar__brand"><span class="bfb-tile bfb-tile--blue bfb-tile--lg">' + icon('edit', 20) + '</span>' +
      '<div><div class="bfb-eyebrow">BSP Forms</div><div class="bfb-bar__title">Form builder</div></div></div>' +
      '<button type="button" class="bfb-listchip" @click="openPicker()" :class="{ \'is-empty\': !listTitle() }">' + icon('folder') +
      '<span x-text="listTitle() || \'Pick a list\'"></span>' +
      '<span class="spinner spinner--16" x-show="schema.state===\'loading\'" x-cloak aria-hidden="true"></span></button>' +
      '<span class="bfb-bar__spacer"></span>' +
      '<button type="button" class="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" @click="undo()" :disabled="!canUndo()">' + icon('chevron-left') + '</button>' +
      '<button type="button" class="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" @click="redo()" :disabled="!canRedo()">' + icon('chevron-right') + '</button>' +
      '<button type="button" class="bfb-issuesbtn" @click="showIssues = !showIssues" :class="{ \'is-bad\': nErr, \'is-warn\': !nErr && nWarn, \'is-ok\': !nErr && !nWarn }" :aria-expanded="showIssues ? \'true\' : \'false\'">' +
      '<span class="bfb-issuesbtn__dot"></span><span x-text="nErr ? nErr + (nErr === 1 ? \' problem\' : \' problems\') : (nWarn ? nWarn + (nWarn === 1 ? \' warning\' : \' warnings\') : \'Ready\')"></span></button>' +
      '<button type="button" class="btn btn--subtle btn--sm" @click="newForm()">New</button>' +
      '<button type="button" class="icon-btn" :title="full ? \'Exit full screen\' : \'Full screen\'" :aria-label="full ? \'Exit full screen\' : \'Full screen\'" @click="full = !full">' + icon('full-screen-maximize') + '</button>' +
      '<button type="button" class="btn btn--primary" @click="openDownload()" :disabled="nErr > 0" :title="nErr ? \'Fix the problems first\' : \'\'">' + icon('arrow-down') + '<span>Download</span></button>' +
      '</header>';
    // draft banner
    h += '<div class="msgbar msgbar--info bfb-draft" x-show="draft" x-cloak>' + icon('info', 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body">There’s an unsaved draft from <strong x-text="draft && draftWhen()"></strong>.' +
      ' <button type="button" class="btn btn--sm btn--primary" @click="restoreDraft()">Restore it</button>' +
      ' <button type="button" class="btn btn--sm" @click="discardDraft()">Discard</button></div></div>';
    // issues drawer
    h += '<div class="bfb-issues" x-show="showIssues" x-cloak @keydown.escape="showIssues=false">' +
      '<div class="bfb-issues__head"><strong x-text="nErr ? \'Fix these before downloading\' : \'Nothing blocks the download\'"></strong>' +
      '<button type="button" class="icon-btn" aria-label="Close" @click="showIssues=false">' + icon('dismiss') + '</button></div>' +
      '<p class="bfb-issues__empty" x-show="!issues.length">No problems or warnings.</p>' +
      '<template x-for="(i, ii) in issues" :key="ii"><button type="button" class="bfb-issue-row" :class="\'is-\' + i.level" @click="goIssue(i)">' +
      '<span class="bfb-issue-row__lvl" x-text="i.level===\'error\' ? \'Problem\' : \'Warning\'"></span>' +
      '<span class="bfb-src" x-text="i.source===\'engine\' ? \'Engine\' : \'Schema\'"></span>' +
      '<span class="bfb-issue-row__msg" x-text="i.msg"></span></button></template></div>';
    // body: outline | properties
    h += '<div class="bfb-body">';
    h += renderOutline();
    h += '<main class="bfb-props" aria-label="Properties">';
    h += '<div class="msgbar msgbar--warning bfb-note" x-show="note" x-cloak role="status">' + icon('warning', 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body" x-text="note"></div><button type="button" class="icon-btn" aria-label="Dismiss" @click="note=\'\'">' + icon('dismiss') + '</button></div>';
    h += '<template x-if="sel.t===\'form\'"><div class="bfb-props__in">' + renderFormProps() + '</div></template>';
    h += '<template x-if="sel.t===\'page\' && curPage"><div class="bfb-props__in">' + renderPageProps() + '</div></template>';
    h += '<template x-if="sel.t===\'section\' && curSection"><div class="bfb-props__in">' + renderSectionProps() + '</div></template>';
    h += '<template x-if="sel.t===\'field\' && cur"><div class="bfb-props__in">' + renderFieldProps() + '</div></template>';
    h += '</main></div>';

    // list picker dialog
    h += '<div class="scrim bfb-dialog bfb-pick" x-show="pick.open" x-cloak @keydown.escape="pick.open=false" @click.self="pick.open=false">' +
      '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bfb-pick-t">' +
      '<div class="dialog__head"><h2 class="dialog__title" id="bfb-pick-t">Pick the list</h2>' +
      '<p class="dialog__sub">Responses are saved to it. Its columns become what controls can save to.</p></div>' +
      '<div class="dialog__body">' +
      '<div class="bfb-pick__site"><div class="field"><label class="field__label" for="bfb-site">Site</label>' +
      '<input class="input" id="bfb-site" type="text" x-model="pick.site" placeholder="This site — or e.g. /sites/FCUPortal" @keydown.enter.prevent="loadLists()"></div>' +
      '<button type="button" class="btn" @click="loadLists()">Load lists</button></div>' +
      '<div class="bfb-state" x-show="pick.state===\'loading\'"><span class="spinner spinner--16" aria-hidden="true"></span> Loading lists…</div>' +
      '<div class="msgbar msgbar--danger" x-show="pick.state===\'error\'" x-cloak><div class="msgbar__body" x-text="\'Lists couldn’t be loaded: \' + pick.err"></div></div>' +
      '<div class="bfb-lists" x-show="pick.state===\'ready\'" x-cloak>' +
      '<p class="bfb-state" x-show="!pick.lists.length">No custom lists on this site.</p>' +
      '<template x-for="l in pick.lists" :key="l.id"><button type="button" class="bfb-listrow" :class="{ \'is-cur\': currentListId()===l.id }" @click="chooseList(l)">' +
      '<span class="bfb-tile bfb-tile--sky">' + icon('folder', 16) + '</span>' +
      '<span class="bfb-listrow__text"><strong x-text="l.title"></strong><span x-text="l.url"></span></span>' +
      '<span class="bfb-flag" x-text="l.itemCount + \' items\'"></span>' +
      '<span class="bfb-flag" x-show="!l.enableAttachments">no attachments</span>' +
      '<span class="bfb-listrow__cur" x-show="currentListId()===l.id">' + icon('checkmark') + '</span></button></template></div>' +
      '</div><div class="dialog__foot"><button type="button" class="btn" @click="pick.open=false">Close</button></div></div></div>';

    // download dialog
    h += '<div class="scrim bfb-dialog bfb-dl" x-show="dl.open" x-cloak @keydown.escape="dl.open=false" @click.self="dl.open=false">' +
      '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bfb-dl-t">' +
      '<div class="dialog__head"><h2 class="dialog__title" id="bfb-dl-t">Download the form</h2>' +
      '<p class="dialog__sub">Two files: the form itself, and the web part snippet that shows it on a page.</p></div>' +
      '<div class="dialog__body">' +
      '<div class="field"><label class="field__label" for="bfb-slug">File name</label>' +
      '<div class="bfb-slug"><input class="input bfb-mono" id="bfb-slug" type="text" x-model="dl.slug" spellcheck="false"><span class="bfb-mono">.json</span></div></div>' +
      '<label class="check bfb-check"><input type="checkbox" x-model="dl.validate"><span>Show the config check on the first load (<code>data-validate</code>)</span></label>' +
      '<div class="bfb-dl__files">' +
      '<button type="button" class="bfb-filecard" @click="doDownload(\'json\')"><span class="bfb-tile bfb-tile--blue">' + icon('document', 16) + '</span>' +
      '<span><strong x-text="(dl.slug || \'form\') + \'.json\'"></strong><span>The form — upload to Code/bsp-forms/forms/</span></span></button>' +
      '<button type="button" class="bfb-filecard" @click="doDownload(\'stub\')"><span class="bfb-tile bfb-tile--teal">' + icon('open', 16) + '</span>' +
      '<span><strong x-text="(dl.slug || \'form\') + \'.webpart.html\'"></strong><span>The snippet for the page’s web part</span></span></button></div>' +
      '<div class="bfb-check-list" x-show="dl.done" x-cloak><div class="bfb-eyebrow">Next</div><ol>' +
      '<li>Upload <code x-text="slugOrForm() + \'.json\'"></code> to <code x-text="configUrl().replace(/[^/]+$/, \'\')"></code></li>' +
      '<li>Make the page from your template and put the snippet in its custom-script web part.</li>' +
      '<li>Open the page: the config check should show every row OK. Then remove <code>data-validate</code>.</li>' +
      '<li>Submit one test response and check the list item.</li></ol></div>' +
      '</div><div class="dialog__foot"><button type="button" class="btn" @click="dl.open=false">Close</button>' +
      '<button type="button" class="btn btn--primary" @click="doDownload(\'both\')">' + icon('arrow-down') + '<span>Download both</span></button></div></div></div>';

    // confirm dialog
    h += '<div class="scrim bfb-dialog bfb-ask" x-show="ask.open" x-cloak @keydown.escape="askNo()">' +
      '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="bfb-ask-t" aria-describedby="bfb-ask-m">' +
      '<div class="dialog__head"><h2 class="dialog__title" id="bfb-ask-t" x-text="ask.title"></h2></div>' +
      '<div class="dialog__body"><p id="bfb-ask-m" x-text="ask.msg"></p></div>' +
      '<div class="dialog__foot"><button type="button" class="btn" @click="askNo()">Cancel</button>' +
      '<button type="button" class="btn btn--primary" @click="askOk()" x-text="ask.ok"></button></div></div></div>';
    h += '</div>';
    return h;
  }

  /* ------------------------------------------------------------------
     Boot — idempotent per mount, inert in page edit mode, retryable
     ------------------------------------------------------------------ */
  function fail(mount, msg) {
    mount.__bfb = false;
    mount.setAttribute('data-bfb-state', 'error');
    var bar = document.createElement('div');
    bar.className = 'msgbar msgbar--danger';
    bar.setAttribute('role', 'alert');
    bar.setAttribute('data-bfb-fatal', '');
    bar.textContent = 'The form builder couldn’t start: ' + msg;
    mount.querySelectorAll('[data-bfb-fatal]').forEach(function (n) { n.remove(); });
    mount.appendChild(bar);
  }
  function mountOne(mount) {
    if (mount.__bfb) return;
    mount.__bfb = true;
    var NS = window.BSPForms;
    if (!NS || !NS.version) return fail(mount, 'the BSP Forms engine (bsp-forms.js) isn’t on this page — load it before the builder.');
    if (!verAtLeast(NS.version, MIN_ENGINE) || !NS.lists || !NS.loadUi) {
      return fail(mount, 'it needs engine ' + MIN_ENGINE + ' or later (this page has ' + NS.version + ').');
    }
    if (NS.inEditMode && NS.inEditMode()) {
      mount.innerHTML = '<div class="bfb-editnote">BSP Forms builder — opens in view mode.</div>';
      mount.__bfb = false;
      return;
    }
    mount.setAttribute('data-bfb-state', 'initializing');
    NS.loadUi([selfBase + 'bsp-forms-builder.css' + (selfVer ? '?v=' + selfVer : '')]).then(function () {
      mount.querySelectorAll('[data-bfb-fatal]').forEach(function (n) { n.remove(); });
      var host = document.createElement('div');
      host.innerHTML = renderBuilder();
      var root = host.firstChild;
      mount.appendChild(root);
      if (window.Alpine && !root._x_dataStack) window.Alpine.initTree(root);
      mount.setAttribute('data-bfb-state', 'ready');
    }).catch(function (e) { fail(mount, (e && e.message) || String(e)); });
  }
  B.scan = function () {
    document.querySelectorAll('[data-bspf-builder]').forEach(function (m) {
      try { mountOne(m); } catch (e) { fail(m, (e && e.message) || String(e)); }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', B.scan);
  else B.scan();
})();
