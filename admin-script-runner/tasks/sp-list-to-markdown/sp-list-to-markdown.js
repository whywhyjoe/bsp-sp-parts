/*! sp-list-to-markdown v0.1.5 — an admin-script-runner task (bsp-sp-parts)
 *
 *  Exports a SharePoint list to one Markdown file in a document library,
 *  overwriting the previous file, so Copilot can read list content it cannot
 *  reliably read from the list itself. Every item is self-contained: its group
 *  values are repeated as bullets, because Copilot reads a document in chunks and
 *  a chunk can lose the heading above it.
 *
 *  due(): one small GET for the output file (age, the visitor's edit permission,
 *  and its source watermark), then one for the list's LastItemModifiedDate —
 *  exported only when the list changed after the watermark and the file
 *  predates the current slot.
 *  run(): list timestamp (= the watermark) → fields → items (one request,
 *  maxItems ≤ 5000) → Markdown → upload → write the watermark into the file's
 *  Title. The watermark is the list's state BEFORE the items were read, so an
 *  edit landing mid-export is newer than it and the next check exports again.
 *
 *  Config reference: ../../docs/03-sp-list-to-markdown.md. Data layer: PnPjs v2
 *  (global pnp2), kept inside makeLiveAdapter(); makeMockAdapter() is its twin.
 */
(function (window) {
  'use strict';

  var TYPE = 'sp-list-to-markdown';
  var MAX_ITEMS_CAP = 5000;          // one REST request; SharePoint's $top ceiling
  var DEFAULT_MAX_ITEMS = 50;
  var EDIT_LIST_ITEMS_BIT = 4;       // SP.PermissionKind.EditListItems (3) → Low bit 2

  /* ════════ Config ════════ */

  function normalizeOrderBy(raw) {
    var list = raw === undefined || raw === null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw]);
    var out = list.map(function (o) {
      if (typeof o === 'string') return { field: o.trim(), ascending: true };
      return { field: String((o && o.field) || '').trim(), ascending: !(o && o.ascending === false) };
    }).filter(function (o) { return o.field; });
    return out.length ? out : [{ field: 'ID', ascending: false }];   // default: newest items first
  }

  /** raw JSON → { config, errors[] }. Errors are complete sentences naming the key. */
  function normalizeConfig(raw) {
    var errors = [];
    var c = raw && typeof raw === 'object' ? raw : {};
    var list = c.list || {};
    var output = c.output || {};
    var fields = Array.isArray(c.fields) ? c.fields.map(String).map(function (s) { return s.trim(); }).filter(Boolean) : [];

    if (!list.title) errors.push('list.title is required.');
    if (!fields.length) errors.push('fields must list at least one column internal name.');
    if (!output.folder) errors.push('output.folder is required (server-relative, e.g. /sites/X/Shared Documents/copilot).');
    if (!output.file) errors.push('output.file is required (e.g. intake.md).');
    else if (/[\\/]/.test(output.file)) errors.push('output.file must be a file name, not a path.');

    var maxItems = c.maxItems === undefined ? DEFAULT_MAX_ITEMS : Number(c.maxItems);
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_ITEMS_CAP) {
      errors.push('maxItems must be a whole number from 1 to ' + MAX_ITEMS_CAP + '.');
      maxItems = DEFAULT_MAX_ITEMS;
    }

    var timeZone = c.timeZone ? String(c.timeZone) : '';
    if (timeZone) {
      try { new Intl.DateTimeFormat('en-CA', { timeZone: timeZone }); }
      catch (e) { errors.push('timeZone "' + timeZone + '" is not an IANA zone name (e.g. America/New_York).'); timeZone = ''; }
    }

    var listSite = siteOf(list.site);
    return {
      errors: errors,
      config: {
        title: String(c.title || list.title || 'List export'),
        list: { site: listSite, title: String(list.title || '') },
        fields: fields,
        heading: String(c.heading || 'Title'),
        group: c.group ? String(c.group) : '',
        subgroup: c.subgroup ? String(c.subgroup) : '',
        filter: c.filter ? String(c.filter) : '',
        orderBy: normalizeOrderBy(c.orderBy),
        maxItems: maxItems,
        timeZone: timeZone,
        output: {
          site: output.site ? siteOf(output.site) : listSite,
          folder: trimSlash(String(output.folder || '')),
          file: String(output.file || '')
        }
      }
    };
  }

  function trimSlash(s) { return String(s || '').trim().replace(/\/+$/, ''); }

  /* Site setting → '' (omitted: the page's own web), '/' (the tenant root site)
     or '/sites/x'. Trimming alone would turn "/" into "" and silently mean
     "this page's web" instead. */
  function siteOf(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    return trimSlash(raw) || '/';
  }

  /* ════════ Query (pure) ════════ */

  var EXPANDED = { User: 1, UserMulti: 1, Lookup: 1, LookupMulti: 1 };

  function lookupShown(meta) {
    var shown = String((meta && meta.LookupField) || '');
    return /^[A-Za-z0-9_]+$/.test(shown) ? shown : 'Title';
  }

  /** Every column the Markdown needs, in output order, de-duplicated. */
  function neededFields(config) {
    var seen = Object.create(null);
    var out = [];
    [config.heading, config.group, config.subgroup].concat(config.fields).forEach(function (n) {
      if (n && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out;
  }

  /** config + field metadata (by internal name) → { select, expand, errors }. */
  function buildQuery(config, metaByName) {
    var errors = [];
    var select = ['ID'];
    var expand = [];
    neededFields(config).forEach(function (name) {
      var meta = metaByName[name];
      if (!meta) { errors.push('Column "' + name + '" is not in the list (use internal names).'); return; }
      if (meta.TypeAsString === 'User' || meta.TypeAsString === 'UserMulti') {
        select.push(name + '/Title', name + '/EMail');
        expand.push(name);
      } else if (EXPANDED[meta.TypeAsString]) {
        select.push(name + '/' + lookupShown(meta));
        expand.push(name);
      } else {
        select.push(name);
      }
    });
    config.orderBy.forEach(function (o) {
      if (!metaByName[o.field]) errors.push('orderBy column "' + o.field + '" is not in the list.');
    });
    return { select: select, expand: expand, errors: errors };
  }

  /* ════════ Values → text (pure) ════════ */

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, name) {
      if (name[0] === '#') {
        var code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return isFinite(code) ? String.fromCodePoint(code) : m;
      }
      var key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
    });
  }

  /** Rich text → plain text that keeps line breaks and list items. */
  function stripHtml(html) {
    var text = String(html || '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '\n- ')
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    return decodeEntities(text)
      .replace(/​/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')   // no blank lines: one would end the bullet this text sits in
      .trim();
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Date → 'YYYY-MM-DD HH:mm' in timeZone ('' = the browser's zone). */
  function formatDateTime(date, timeZone) {
    var opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    if (timeZone) opts.timeZone = timeZone;
    var p = {};
    new Intl.DateTimeFormat('en-CA', opts).formatToParts(date).forEach(function (part) { p[part.type] = part.value; });
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
  }

  /* SharePoint stores a date-only value as midnight in the SITE's zone, expressed
     in UTC (Eastern: 2026-09-01T04:00:00Z). Rounding to the nearest UTC midnight
     recovers the calendar date for any site zone within ±11h — never shifts a day. */
  function formatDateOnly(date) {
    var day = 86400000;
    var d = new Date(Math.round(date.getTime() / day) * day);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function asArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : (Array.isArray(v.results) ? v.results : []);
  }

  function person(u, short) {
    if (!u) return '';
    var name = String(u.Title || '').trim();
    var mail = String(u.EMail || '').trim();
    return short || !mail ? name : name + ' (' + mail + ')';
  }

  /** One field value → text. short = heading context (names only, one line). */
  function valueText(value, meta, opts) {
    opts = opts || {};
    if (value === null || value === undefined || value === '') return '';
    var type = meta ? meta.TypeAsString : '';
    switch (type) {
      case 'User': return person(value, opts.short);
      case 'UserMulti': return asArray(value).map(function (u) { return person(u, opts.short); }).filter(Boolean).join('; ');
      case 'Lookup': return typeof value === 'object' ? String(value[lookupShown(meta)] == null ? '' : value[lookupShown(meta)]) : String(value);
      case 'LookupMulti': return asArray(value).map(function (v) { return String(v && v[lookupShown(meta)] != null ? v[lookupShown(meta)] : ''); }).filter(Boolean).join('; ');
      case 'MultiChoice': return asArray(value).filter(function (s) { return typeof s === 'string' && s; }).join('; ');
      case 'Boolean': return value ? 'Yes' : 'No';
      case 'DateTime': {
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return meta.DisplayFormat === 0 ? formatDateOnly(d) : formatDateTime(d, opts.timeZone);
      }
      case 'URL': {
        if (typeof value !== 'object') return String(value);
        var url = String(value.Url || '').trim();
        var label = String(value.Description || '').trim();
        if (!url) return '';
        if (opts.short) return label || url;
        return !label || label === url ? url : '[' + label + '](' + url + ')';
      }
      case 'Note': {
        var s = String(value);
        if (meta.RichText || /^\s*<(div|p|span|br)\b/i.test(s)) return stripHtml(s);
        return s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
      }
      case 'TaxonomyFieldType': return typeof value === 'object' ? String(value.Label || '') : String(value);
      case 'TaxonomyFieldTypeMulti': return asArray(value).map(function (t) { return String((t && t.Label) || ''); }).filter(Boolean).join('; ');
      default:
        if (typeof value === 'object') return '';   // an unrendered shape — omitted rather than printed as [object Object]
        return String(value).trim();
    }
  }

  function oneLine(text) { return String(text).replace(/\s+/g, ' ').trim(); }

  /* ════════ Markdown (pure) ════════ */

  function labelOf(name, metaByName) {
    var meta = metaByName[name];
    return (meta && meta.Title) || name;
  }

  /** Group items by one field, groups sorted A→Z with "(none)" last; item order kept. */
  function groupBy(items, name, metaByName, timeZone) {
    var buckets = Object.create(null);
    var order = [];
    items.forEach(function (item) {
      var key = oneLine(valueText(item[name], metaByName[name], { short: true, timeZone: timeZone }));
      if (!Object.prototype.hasOwnProperty.call(buckets, key)) { buckets[key] = []; order.push(key); }
      buckets[key].push(item);
    });
    order.sort(function (a, b) {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
    return order.map(function (key) { return { key: key || '(none)', items: buckets[key] }; });
  }

  function bullet(label, text) {
    // Continuation lines are indented two spaces so they stay inside the bullet.
    return '- ' + label + ': ' + String(text).replace(/\n/g, '\n  ');
  }

  /**
   * input: { config, metaByName, items, list: { title, url, itemUrl(id) }, exportedAt: Date }
   * → the complete Markdown document.
   */
  function buildMarkdown(input) {
    var c = input.config;
    var meta = input.metaByName;
    var tz = c.timeZone;
    var md = [];

    md.push('# ' + oneLine(c.title), '');
    md.push('- Source list: ' + input.list.title + ' (' + input.list.url + ')');
    md.push('- Exported: ' + formatDateTime(input.exportedAt, tz) + ' (' + (tz || zoneName()) + ')');
    md.push('- Items: ' + input.items.length + (input.items.length >= c.maxItems ? ' (limit of ' + c.maxItems + ' reached — more items may exist)' : ''));
    if (c.filter) md.push('- Filter: ' + c.filter);
    md.push('- Order: ' + c.orderBy.map(function (o) { return labelOf(o.field, meta) + (o.ascending ? ' ascending' : ' descending'); }).join(', '));
    md.push('', '---');

    // Bullets: group + subgroup values repeated on every item, then the configured
    // fields; the heading field is the item's own heading, never a bullet.
    var bulletFields = neededFields(c).filter(function (n) { return n !== c.heading; });
    var itemLevel = c.group ? (c.subgroup ? 4 : 3) : 2;

    function emitItem(item) {
      var heading = oneLine(valueText(item[c.heading], meta[c.heading], { short: true, timeZone: tz })) || '(untitled)';
      md.push('', repeat('#', itemLevel) + ' ' + heading, '');
      bulletFields.forEach(function (name) {
        var text = valueText(item[name], meta[name], { timeZone: tz });
        if (text) md.push(bullet(labelOf(name, meta), text));
      });
      md.push('- Item link: ' + input.list.itemUrl(item.ID));
    }

    if (!input.items.length) {
      md.push('', 'No items matched.');
    } else if (!c.group) {
      input.items.forEach(emitItem);
    } else {
      groupBy(input.items, c.group, meta, tz).forEach(function (g) {
        md.push('', '## ' + labelOf(c.group, meta) + ': ' + g.key);
        if (!c.subgroup) { g.items.forEach(emitItem); return; }
        groupBy(g.items, c.subgroup, meta, tz).forEach(function (s) {
          md.push('', '### ' + labelOf(c.subgroup, meta) + ': ' + s.key);
          s.items.forEach(emitItem);
        });
      });
    }
    md.push('');
    return md.join('\n');
  }

  function repeat(ch, n) { return new Array(n + 1).join(ch); }

  function zoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch (e) { return 'local time'; }
  }

  /* The source watermark, stored in the output file's Title column. */
  var WATERMARK_PREFIX = 'Source list as of ';
  function watermarkText(date) { return WATERMARK_PREFIX + date.toISOString(); }
  function parseWatermark(title) {
    var m = /^Source list as of (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)$/.exec(String(title || '').trim());
    if (!m) return null;
    var d = new Date(m[1]);
    return isNaN(d.getTime()) ? null : d;
  }

  /** due()'s decision, given the file state, the list state and the slot start. */
  function needsExport(file, list, slotStart) {
    if (!file) return true;                                    // never exported
    if (!file.canEdit) return false;                           // this visitor could not write it
    if (slotStart && file.modified >= slotStart) return false; // already exported this slot
    // Compare against the watermark (the list's state when it was read). A file
    // without a readable one (first export whose Title write failed, a broken
    // Title column, a hand-edited Title) is due: its save time could hide an
    // edit that landed mid-export. The slot gate keeps that to once per slot.
    if (!file.source) return true;
    return list.lastItemModified > file.source;
  }

  /** EffectiveBasePermissions → can the user edit items (i.e. overwrite the file)? */
  function canEdit(perms) {
    if (!perms) return false;
    return (Number(perms.Low) & EDIT_LIST_ITEMS_BIT) !== 0;
  }

  /* ════════ Live adapter — PnPjs v2, the only place SharePoint is touched ════════ */

  function waitForPnp2(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function check() {
        var p = window.pnp2;
        if (p && p.sp && typeof p.sp.createIsolated === 'function') { resolve(p); return; }
        if (Date.now() - start >= timeoutMs) {
          reject(new Error('PnPjs v2 (pnp2.bundle.js) is not loaded on this page — the web part stub must include it.'));
          return;
        }
        window.setTimeout(check, 100);
      })();
    });
  }

  /* The page's own web: modern pages live in <web>/SitePages/; classic context
     is the fallback. Config normally names the site explicitly anyway. */
  function currentWebPath() {
    var path = window.location.pathname;
    var at = path.toLowerCase().indexOf('/sitepages/');
    if (at >= 0) return path.slice(0, at);
    var ctx = window._spPageContextInfo;
    return ctx && ctx.webServerRelativeUrl ? trimSlash(ctx.webServerRelativeUrl) : '';
  }

  /* pnp2 HttpRequestError → "[404] File Not Found." */
  function spError(e) {
    var msg = String(e && e.message ? e.message : e);
    var at = msg.indexOf('::>');
    if (at >= 0) {
      try {
        var body = JSON.parse(msg.slice(at + 3));
        var inner = (body['odata.error'] && body['odata.error'].message && body['odata.error'].message.value) ||
          (body.error && body.error.message && (body.error.message.value || body.error.message));
        if (inner) return '[' + (e.status || '?') + '] ' + inner;
      } catch (x) { /* fall through to the raw message */ }
    }
    return msg;
  }

  function wrap(what, promise) {
    return promise.catch(function (e) {
      var err = new Error(what + ': ' + spError(e));
      err.status = e && e.status;
      throw err;
    });
  }

  function makeLiveAdapter() {
    var webs = Object.create(null);
    function web(sitePath) {
      var path = sitePath === '/' ? '' : (sitePath || currentWebPath());
      var url = window.location.origin + path;
      if (!webs[url]) {
        webs[url] = waitForPnp2(15000).then(function (p) {
          return p.sp.createIsolated({ baseUrl: url });
        }).then(function (sp) { return sp.web; });
      }
      return webs[url];
    }
    return {
      /* → { modified: Date, canEdit } | null when the file does not exist yet.
         One request. TimeLastModified is UTC; the list item's Modified is NOT —
         it arrives in the site's regional time with no zone, and new Date()
         would misread it by the zone offset (paid for: a just-written file
         looked hours old). */
      fileState: function (sitePath, filePath) {
        return web(sitePath).then(function (w) {
          return w.getFileByServerRelativePath(filePath)
            .select('TimeLastModified', 'ListItemAllFields/EffectiveBasePermissions', 'ListItemAllFields/Title').expand('ListItemAllFields')();
        }).then(function (file) {
          var item = file.ListItemAllFields || {};
          return {
            modified: new Date(file.TimeLastModified),
            canEdit: canEdit(item.EffectiveBasePermissions),
            source: parseWatermark(item.Title)
          };
        }, function (e) {
          if (e && e.status === 404) return null;
          throw new Error('reading ' + filePath + ': ' + spError(e));
        });
      },
      listState: function (sitePath, title) {
        return wrap('reading list "' + title + '"', web(sitePath).then(function (w) {
          return w.lists.getByTitle(title).select('Title', 'BaseTemplate', 'LastItemModifiedDate', 'RootFolder/ServerRelativeUrl').expand('RootFolder')();
        })).then(function (l) {
          return {
            title: l.Title,
            baseTemplate: l.BaseTemplate,
            lastItemModified: new Date(l.LastItemModifiedDate),
            rootPath: l.RootFolder.ServerRelativeUrl
          };
        });
      },
      fields: function (sitePath, title) {
        return wrap('reading columns of "' + title + '"', web(sitePath).then(function (w) {
          return w.lists.getByTitle(title).fields.select('InternalName', 'Title', 'TypeAsString', 'LookupField', 'DisplayFormat', 'RichText')();
        }));
      },
      items: function (sitePath, title, q) {
        return wrap('reading items of "' + title + '"', web(sitePath).then(function (w) {
          var coll = w.lists.getByTitle(title).items;
          var query = coll.select.apply(coll, q.select);
          if (q.expand.length) query = query.expand.apply(query, q.expand);
          if (q.filter) query = query.filter(q.filter);
          q.orderBy.forEach(function (o) { query = query.orderBy(o.field, o.ascending); });
          return query.top(q.top)();
        }));
      },
      upload: function (sitePath, folder, file, text) {
        return wrap('saving ' + file + ' to ' + folder, web(sitePath).then(function (w) {
          return w.getFolderByServerRelativeUrl(folder).files.add(file, text, true);
        })).then(function (r) { return r && r.data ? r.data.ServerRelativeUrl : folder + '/' + file; });
      },
      /* Title ← watermark. validateUpdateListItem with bNewDocumentUpdate=true
         adds no extra version; it answers 200 even when a field fails, so the
         per-field HasException is what counts. */
      stampSource: function (sitePath, filePath, text) {
        return wrap('recording the source time on ' + filePath, web(sitePath).then(function (w) {
          return w.getFileByServerRelativePath(filePath).getItem();
        }).then(function (item) {
          return item.validateUpdateListItem([{ FieldName: 'Title', FieldValue: text }], true);
        })).then(function (results) {
          var bad = (Array.isArray(results) ? results : (results && results.value) || []).filter(function (f) { return f && f.HasException; });
          if (bad.length) throw new Error('recording the source time on ' + filePath + ': ' + (bad[0].ErrorMessage || 'the Title column rejected the value'));
        });
      }
    };
  }

  /* ════════ Mock adapter — same interface, canned data, opt-in only ════════ */

  var MOCK_FIELDS = [
    { InternalName: 'ID', Title: 'ID', TypeAsString: 'Counter' },
    { InternalName: 'Title', Title: 'Title', TypeAsString: 'Text' },
    { InternalName: 'AssignedTo', Title: 'Assigned To', TypeAsString: 'User' },
    { InternalName: 'Status', Title: 'Status', TypeAsString: 'Choice' },
    { InternalName: 'TaskType', Title: 'Task Type', TypeAsString: 'MultiChoice' },
    { InternalName: 'DueDate', Title: 'Due Date', TypeAsString: 'DateTime', DisplayFormat: 1 },
    { InternalName: 'StartDate', Title: 'Start Date', TypeAsString: 'DateTime', DisplayFormat: 0 },
    { InternalName: 'Description', Title: 'Description', TypeAsString: 'Note', RichText: true },
    { InternalName: 'RefLink', Title: 'Reference Link', TypeAsString: 'URL' }
  ];
  var MOCK_ITEMS = [
    { ID: 3, Title: 'New vendor intake form', AssignedTo: { Title: 'Avery Chen', EMail: 'avery@example.org' }, Status: 'New',
      TaskType: ['Feature', 'Admin'], DueDate: '2026-10-01T16:30:00Z', StartDate: '2026-09-21T04:00:00Z',
      Description: '<div><p>Build the vendor form.</p><ul><li>Fields from the spec</li><li>Approval step</li></ul></div>',
      RefLink: { Url: 'https://example.org/spec', Description: 'Spec doc' } },
    { ID: 2, Title: 'Fix broken nav link', AssignedTo: { Title: 'Sam Field', EMail: 'sam@example.org' }, Status: 'In progress',
      TaskType: ['Bug'], DueDate: null, StartDate: '2026-09-14T04:00:00Z', Description: 'Footer link to HR 404s.', RefLink: null },
    { ID: 1, Title: 'Quarterly content review', AssignedTo: null, Status: 'New',
      TaskType: [], DueDate: '2026-12-15T14:00:00Z', StartDate: null, Description: null, RefLink: null }
  ];

  var MOCK_LIST_MODIFIED = new Date(Date.now() - 3600000);

  function makeMockAdapter() {
    var files = window.__ASR_MOCK_FILES__ = window.__ASR_MOCK_FILES__ || {};
    var delay = typeof window.__ASR_MOCK_DELAY_MS__ === 'number' ? window.__ASR_MOCK_DELAY_MS__ : 350;
    function later(value) { return new Promise(function (r) { window.setTimeout(function () { r(value); }, delay); }); }
    return {
      fileState: function (sitePath, filePath) {
        var f = files[filePath];
        return later(f ? { modified: f.modified, canEdit: true, source: parseWatermark(f.title) } : null);
      },
      listState: function (sitePath, title) {
        return later({ title: title, baseTemplate: 100, lastItemModified: MOCK_LIST_MODIFIED, rootPath: (sitePath || '/sites/mock') + '/Lists/' + title });
      },
      fields: function () { return later(JSON.parse(JSON.stringify(MOCK_FIELDS))); },
      items: function (sitePath, title, q) { return later(JSON.parse(JSON.stringify(MOCK_ITEMS)).slice(0, q.top)); },
      upload: function (sitePath, folder, file, text) {
        var path = folder + '/' + file;
        // The dev harness sets this to show the panel's error state.
        if (window.__ASR_MOCK_FAIL__) return later(null).then(function () { throw new Error('saving ' + file + ': [403] Access denied (mock)'); });
        files[path] = { modified: new Date(), text: text, title: '' };
        window.__ASR_MOCK_UPLOADS__ = (window.__ASR_MOCK_UPLOADS__ || 0) + 1;
        // The dev harness sets this to simulate someone editing the list mid-export.
        if (window.__ASR_MOCK_EDIT_DURING_EXPORT__) {
          window.__ASR_MOCK_EDIT_DURING_EXPORT__ = false;
          MOCK_LIST_MODIFIED = new Date();
        }
        return later(path);
      },
      stampSource: function (sitePath, filePath, text) {
        if (files[filePath]) files[filePath].title = text;
        return later(undefined);
      }
    };
  }

  /* ════════ The task ════════ */

  function configOrThrow(ctx) {
    var r = normalizeConfig(ctx.config);
    if (r.errors.length) throw new Error('Config: ' + r.errors.join(' '));
    return r.config;
  }

  function adapterFor(ctx) { return ctx.mock ? makeMockAdapter() : makeLiveAdapter(); }

  function due(ctx) {
    var c = configOrThrow(ctx);
    var a = adapterFor(ctx);
    var filePath = c.output.folder + '/' + c.output.file;
    return a.fileState(c.output.site, filePath).then(function (file) {
      if (file && !file.canEdit) { ctx.log('no edit permission on ' + filePath + ' — skipping'); return false; }
      if (!file || (ctx.slotStart && file.modified >= ctx.slotStart)) return needsExport(file, null, ctx.slotStart);
      return a.listState(c.list.site, c.list.title).then(function (l) {
        return needsExport(file, l, ctx.slotStart);
      });
    });
  }

  /* LastItemModifiedDate has one-second resolution. If the list changed within
     the last moment, wait until that second is safely over before reading the
     items: then any edit the read misses carries a LATER second than the
     watermark and is caught next time. 2 s also absorbs modest clock skew
     between this browser and SharePoint. */
  var SETTLE_MS = 2000;
  function settleDelay(lastItemModified, nowMs) {
    return Math.max(0, Math.min(SETTLE_MS, lastItemModified.getTime() + SETTLE_MS - nowMs));
  }

  function run(ctx) {
    var c = configOrThrow(ctx);
    var a = adapterFor(ctx);
    var metaByName = Object.create(null);
    var list;
    var itemCount = 0;
    var saved = '';
    var chars = 0;

    ctx.setStatus('Reading the list…');
    ctx.setProgress(0.05);
    return a.listState(c.list.site, c.list.title).then(function (l) {
      list = l;   // list.lastItemModified becomes the watermark
      ctx.throwIfCancelled();
      var wait = settleDelay(list.lastItemModified, Date.now());
      return wait ? new Promise(function (r) { window.setTimeout(r, wait); }) : null;
    }).then(function () {
      ctx.setProgress(0.2);
      return a.fields(c.list.site, c.list.title);
    }).then(function (fields) {
      fields.forEach(function (f) { metaByName[f.InternalName] = f; });
      var q = buildQuery(c, metaByName);
      if (q.errors.length) throw new Error(q.errors.join(' '));
      ctx.throwIfCancelled();
      ctx.setStatus('Reading up to ' + c.maxItems + ' items…');
      ctx.setProgress(0.35);
      return a.items(c.list.site, c.list.title, { select: q.select, expand: q.expand, filter: c.filter, orderBy: c.orderBy, top: c.maxItems });
    }).then(function (items) {
      ctx.throwIfCancelled();
      itemCount = items.length;
      ctx.setStatus('Writing Markdown for ' + items.length + ' items…');
      ctx.setProgress(0.6);
      var origin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : 'https://tenant.example';
      var listUrl = origin + encodePath(list.rootPath);
      var form = list.baseTemplate === 101 ? '/Forms/DispForm.aspx' : '/DispForm.aspx';
      var markdown = buildMarkdown({
        config: c,
        metaByName: metaByName,
        items: items,
        list: { title: list.title, url: listUrl, itemUrl: function (id) { return listUrl + form + '?ID=' + id; } },
        exportedAt: new Date()
      });
      chars = markdown.length;
      ctx.throwIfCancelled();
      ctx.setStatus('Saving ' + c.output.file + '…');
      ctx.setProgress(0.75);
      return a.upload(c.output.site, c.output.folder, c.output.file, markdown);
    }).then(function (path) {
      saved = path;
      ctx.setStatus('Recording the source time…');
      ctx.setProgress(0.9);
      return a.stampSource(c.output.site, c.output.folder + '/' + c.output.file, watermarkText(list.lastItemModified));
    }).then(function () {
      ctx.setStatus('Saved ' + c.output.file + ' (' + itemCount + ' items).');
      ctx.setProgress(1);
      return { items: itemCount, file: saved, chars: chars, sourceAsOf: list.lastItemModified.toISOString() };
    });
  }

  function encodePath(path) { return String(path).split('/').map(encodeURIComponent).join('/'); }

  var MOCK_CONFIG = {
    title: 'Intake requests (mock)',
    list: { title: 'Intake Test' },
    fields: ['Status', 'TaskType', 'DueDate', 'StartDate', 'Description', 'RefLink'],
    group: 'AssignedTo',
    orderBy: [{ field: 'ID', ascending: false }],
    maxItems: 50,
    output: { folder: '/sites/mock/Shared Documents/copilot', file: 'intake.md' }
  };

  (window.adminScriptTasks = window.adminScriptTasks || []).push({
    type: TYPE,
    label: 'Export list to Markdown',
    mockConfig: MOCK_CONFIG,
    due: due,
    run: run
  });

  window.spListToMarkdown = {
    version: '0.1.0',
    _pure: {
      normalizeConfig: normalizeConfig, siteOf: siteOf, buildQuery: buildQuery,
      watermarkText: watermarkText, parseWatermark: parseWatermark, needsExport: needsExport, settleDelay: settleDelay, buildMarkdown: buildMarkdown,
      valueText: valueText, stripHtml: stripHtml, formatDateOnly: formatDateOnly,
      formatDateTime: formatDateTime, groupBy: groupBy, canEdit: canEdit
    },
    _mock: { fields: MOCK_FIELDS, items: MOCK_ITEMS, config: MOCK_CONFIG, makeMockAdapter: makeMockAdapter }
  };
})(typeof window !== 'undefined' ? window : globalThis);
