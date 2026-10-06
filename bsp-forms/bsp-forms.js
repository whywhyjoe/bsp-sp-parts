/*! BSP Forms · v0.1.0 · bsp-forms.js */
/* =====================================================================
   BSP Forms — JSON-configured forms for SharePoint pages, built on the
   BMO SharePoint Design System (BSP).

   One shared engine, deployed once. Each custom-script web part insert is:

     <div data-bsp-form data-config="/sites/FCUPortal/Code/bsp-forms/forms/my-form.json"></div>
     <script src="https://…/sites/FCUPortal/Code/bsp-forms/bsp-forms.js?v=1"></script>

   The engine:
   - is a classic script (no modules, no build step), idempotent per mount,
     safe to evaluate more than once on one page (web parts re-run scripts);
   - injects the BSP CSS + its own layer, the icon sprite, Alpine and the
     self-hosted pnpjs 2 bundle if the page doesn't already have them;
   - renders the form from the JSON config, and writes submissions to a
     SharePoint list via pnpjs v2 (`pnp.sp.setup` + fluent API);
   - honors SharePoint page edit mode (renders an inert note instead).

   Optional page-level overrides (set BEFORE this script):
     window.BSP_FORMS_SETTINGS = {
       designBase: '/sites/FCUPortal/Code/bsp-design/', // BSP css + sprite
       libBase:    '/sites/FCUPortal/Code/lib/',        // alpine + pnp
       alpineUrl:  null,   // full override of the Alpine url
       pnpUrl:     null,   // full override of the pnpjs 2 bundle url
       webUrl:     null,   // page web absolute url override
       mockSp:     null    // dev-only mock adapter (see dev/mock-sp.js)
     };
   Every key has a default derived from this script's own URL, so an
   ordinary deployment needs no configuration at all.
   ===================================================================== */
(function () {
  'use strict';

  var VERSION = '0.4.1';
  var NS = window.BSPForms = window.BSPForms || {};
  if (NS.__engineLoaded) { if (NS.scan) NS.scan(); return; }
  NS.__engineLoaded = true;
  NS.version = VERSION;
  NS._defs = {};

  /* ------------------------------------------------------------------
     Settings + base resolution
     ------------------------------------------------------------------ */
  var settings = window.BSP_FORMS_SETTINGS || {};
  var scriptEl = document.currentScript;
  var engineSrc = (scriptEl && scriptEl.src) || '';
  var engineBase = engineSrc ? engineSrc.slice(0, engineSrc.lastIndexOf('/') + 1) : '';
  var engineVer = (function () {
    var m = /[?&]v=([^&]+)/.exec(engineSrc);
    return m ? m[1] : '';
  })();

  function normPath(u) {
    // resolve ../ segments in an absolute-ish url or path
    try { return new URL(u, location.href).href; } catch (e) { return u; }
  }
  var designBase = settings.designBase || (engineBase ? normPath(engineBase + '../bsp-design/') : '');
  var libBase = settings.libBase || (engineBase ? normPath(engineBase + '../lib/') : '');
  var alpineUrl = settings.alpineUrl || (libBase + 'alpine.js');
  var pnpUrl = settings.pnpUrl || (libBase + 'pnp2.bundle.js');

  var hostNonce = (scriptEl && scriptEl.nonce) ||
    (function () { var s = document.querySelector('script[nonce]'); return s ? s.nonce : ''; })();

  /* ------------------------------------------------------------------
     Small utilities
     ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // textarea -> rich-text Note column: escape, keep line breaks as <br>
  // (a rich-text column renders HTML, so raw newlines would collapse)
  function toRichText(s) {
    return '<div>' + esc(s).replace(/\r\n|\r|\n/g, '<br>') + '</div>';
  }
  function jstr(v) { return JSON.stringify(v); }
  function fmtStr(tpl, map) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
      return (map && k in map) ? map[k] : m;
    });
  }
  var uidSeq = 0;
  function nextUid() { return 'bspf' + (++uidSeq) + '_' + Math.floor(Math.random() * 1e6).toString(36); }
  function safeKey(id) {
    var k = String(id || '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(k)) k = 'f_' + k;
    // names that collide with Object.prototype (or set the prototype) can't
    // be state keys — dot access and {}-map lookups would misbehave
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') k = 'f_' + k;
    return k;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  /* Date helpers — all comparisons are calendar-day based. */
  function parseDateVal(v) {
    // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (native input values)
    if (!v || typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function today0() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // test seam: BSPForms.clock = function () { return <ms>; } pins "now"
  function nowMs() { return typeof NS.clock === 'function' ? NS.clock() : Date.now(); }

  /* Business time (form.businessHours) — counted on the business time
     zone's WALL CLOCK, so the viewer's own zone and DST never matter.
     A moment is { day: civil day number, min: minute of day }. Working
     time is the overlap with [start, end) on business weekdays; anything
     outside hours counts as the last close (6pm Tue == 5pm Tue). One
     "business day" = end - start working minutes. Holidays aren't modeled. */
  function hhmm(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function civilDay(y, mo, d) { return Math.round(Date.UTC(y, mo - 1, d) / 86400000); }
  function bizNow(bh, nowMs) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: bh.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(nowMs == null ? Date.now() : nowMs)).forEach(function (p) { parts[p.type] = p.value; });
    return { day: civilDay(+parts.year, +parts.month, +parts.day), min: (+parts.hour % 24) * 60 + (+parts.minute) };
  }
  function bizAtDate(bh, v) {
    // date-only value -> the moment it stands for (bh.dateAt: 'end' | 'start')
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v || '');
    if (!m) return null;
    if (m[4] != null) {
      // includeTime: the picker shows the VIEWER's wall clock, so convert to
      // an instant, then to the business zone's wall clock (a 2pm pick in
      // Vancouver is 5pm Eastern)
      var ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
      return isNaN(ms) ? null : bizNow(bh, ms);
    }
    return { day: civilDay(+m[1], +m[2], +m[3]), min: bh.dateAt === 'start' ? bh._start : bh._end };
  }
  function bizMinutes(bh, a, b) {
    if (b.day < a.day || (b.day === a.day && b.min <= a.min)) return 0;
    if (b.day - a.day > 366) return Infinity; // far future: never "within"
    var total = 0;
    for (var day = a.day; day <= b.day; day++) {
      if (bh.days.indexOf(new Date(day * 86400000).getUTCDay()) < 0) continue;
      var lo = Math.max(bh._start, day === a.day ? a.min : 0);
      var hi = Math.min(bh._end, day === b.day ? b.min : 1440);
      if (hi > lo) total += hi - lo;
    }
    return total;
  }
  // inclusive: a target exactly n business days away still counts as within
  function bizWithin(bh, v, n, nowMs) {
    var t = bizAtDate(bh, v), now = bizNow(bh, nowMs);
    // a day already gone is invalid input (blocked elsewhere), not "urgent" —
    // otherwise a half-typed year (0202-…) would trip locks and prompts
    if (!t || t.day < now.day) return false;
    return bizMinutes(bh, now, t) <= n * (bh._end - bh._start);
  }
  // earliest date (YYYY-MM-DD) that is at least n business days away
  function bizDateAfter(bh, n, nowMs) {
    var now = bizNow(bh, nowMs), need = n * (bh._end - bh._start);
    for (var day = now.day; day < now.day + 400; day++) {
      if (bizMinutes(bh, now, { day: day, min: bh.dateAt === 'start' ? bh._start : bh._end }) >= need) {
        return new Date(day * 86400000).toISOString().slice(0, 10);
      }
    }
    return null;
  }
  function bizToday(bh, nowMs) { return new Date(bizNow(bh, nowMs).day * 86400000).toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((a - b) / 86400000); }
  function fmtDate(d) { return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }

  /* ------------------------------------------------------------------
     Default UX / error strings — every user-visible string lives here
     and can be overridden per form via config.strings.
     ------------------------------------------------------------------ */
  var DEFAULT_STRINGS = {
    next: 'Next', back: 'Back', submit: 'Submit', submitting: 'Submitting…',
    requiredField: 'This field is required.',
    invalidEmail: 'Enter a valid email address (name@example.com).',
    invalidPhone: 'Enter a valid phone number.',
    invalidUrl: 'Enter a valid web address, starting with http:// or https://.',
    invalidNumber: 'Enter a number.',
    numberInteger: 'Enter a whole number.',
    numberMin: 'Must be at least {min}.',
    numberMax: 'Must be no more than {max}.',
    textMinLength: 'Must be at least {min} characters.',
    textMaxLength: 'Must be {max} characters or fewer.',
    patternMismatch: 'This doesn’t match the expected format.',
    choiceRequired: 'Choose an option.',
    multiMin: 'Choose at least {min} option(s).',
    multiMax: 'Choose no more than {max} option(s).',
    personRequired: 'Add at least one person.',
    personMax: 'Add no more than {max} people.',
    personPlaceholder: 'Type a name or email…',
    personSearching: 'Searching the directory…',
    personNoResults: 'No matching people found.',
    personResolveFailed: 'Couldn’t confirm {name} against the directory. Remove and re-add them.',
    dateAfter: 'Must be after {other}.',
    dateOnOrAfter: 'Must be on or after {other}.',
    dateBefore: 'Must be before {other}.',
    dateOnOrBefore: 'Must be on or before {other}.',
    todayLabel: 'today',
    comboPlaceholder: 'Select an option',
    comboPlaceholderMulti: 'Select one or more options',
    fillInPlaceholder: 'Or enter your own…',
    fillInAdd: 'Add',
    lookupLoading: 'Loading options…',
    lookupError: 'Couldn’t load the options for this field. Try again later.',
    linkUrlPlaceholder: 'https://…',
    linkDescPlaceholder: 'Display text (optional)',
    attachDrop: 'Drag files here, or click to browse',
    attachHint: '',
    attachTooLarge: '{name} is larger than the {max} MB limit.',
    attachTooMany: 'No more than {max} files can be attached.',
    attachBadType: '{name} isn’t an accepted file type. Accepted: {types}.',
    attachRequired: 'Attach at least one file.',
    attachRemove: 'Remove attachment',
    attachDone: 'Uploaded',
    pageError: 'Fix the highlighted fields to continue.',
    submitFailed: 'Your response wasn’t submitted — nothing was saved. Try again in a moment.',
    submitFailedDetail: 'Details: {detail}',
    attachPartialTitle: 'Response saved — attachments incomplete',
    attachPartial: 'Your answers were saved, but {n} attachment(s) failed to upload.',
    attachRetry: 'Retry failed uploads',
    attachSkip: 'Continue without them',
    confirmTitle: 'Thank you — your response was submitted.',
    promptTitle: 'Please confirm', promptOk: 'OK',
    redirectCountdown: 'Redirecting in {n} seconds…', redirectPaused: 'Copy the link first, then you’ll be redirected.',
    redirectNow: 'Go now',
    copyBlocked: 'Your browser didn’t allow copying automatically. Copy the link below to continue.',
    copyLabel: 'Original link', copyButton: 'Copy link',
    confirmMessage: '',
    confirmAnother: 'Submit another response',
    configLoadError: 'This form couldn’t be loaded. If this keeps happening, contact the form owner.',
    configLoadDetail: '(BSP Forms: {detail})',
    noContext: 'No SharePoint connection was found on this page, so the form can’t submit.',
    editModeNote: 'BSP Forms — renders in view mode. Config:',
    stepOf: 'Step {n} of {total}',
    doctorTitle: 'Form configuration check',
    doctorOk: 'OK', doctorWarn: 'Check', doctorError: 'Problem'
  };

  /* ------------------------------------------------------------------
     Asset loading — idempotent; every injected element carries a
     data-bspf marker so re-evaluation never duplicates anything.
     ------------------------------------------------------------------ */
  function canonicalUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
  }
  function ensureCss(href, key) {
    if (document.querySelector('link[data-bspf-css="' + key + '"]')) return;
    // dedupe by canonical URL (query-stripped), never by basename — an
    // unrelated stylesheet that happens to be called components.css must
    // not suppress the real one
    var wanted = canonicalUrl(href.split('?')[0]);
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var lh = (links[i].getAttribute('href') || '').split('?')[0];
      if (lh && canonicalUrl(lh) === wanted) return;
    }
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-bspf-css', key);
    document.head.appendChild(l);
  }
  function ensureStyles() {
    ensureCss(designBase + 'colors_and_type.css', 'tokens');
    ensureCss(designBase + 'components.css', 'components');
    ensureCss(engineBase + 'bsp-forms.css' + (engineVer ? '?v=' + engineVer : ''), 'bspf');
  }

  var spritePromise = null;
  function ensureSprite() {
    if (document.getElementById('ic-fluent-checkmark-24-regular')) return Promise.resolve();
    if (spritePromise) return spritePromise;
    spritePromise = fetch(designBase + 'fluent-basic-icons.svg', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('sprite HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        if (document.getElementById('ic-fluent-checkmark-24-regular')) return;
        var box = document.createElement('div');
        box.innerHTML = text;
        var svg = box.querySelector('svg');
        if (!svg) throw new Error('sprite parse failed');
        svg.style.display = 'none';
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('data-bspf', 'sprite');
        document.body.insertBefore(svg, document.body.firstChild);
      })
      .catch(function (e) { console.warn('[BSP Forms] icon sprite unavailable:', e); });
    return spritePromise;
  }

  var scriptPromises = {};
  // hideAmd: modern SharePoint pages run an AMD loader, so a UMD bundle
  // injected late registers as an anonymous AMD module and never sets its
  // global (window.pnp stays undefined). Hide define.amd — not define
  // itself — for the load, and restore it on success AND failure.
  function loadScript(url, key, hideAmd) {
    if (scriptPromises[key]) return scriptPromises[key];
    scriptPromises[key] = new Promise(function (resolve, reject) {
      var amd = null;
      if (hideAmd && typeof window.define === 'function' && window.define.amd) {
        amd = window.define.amd;
        try { delete window.define.amd; } catch (e) { window.define.amd = undefined; }
      }
      function restore() { if (amd) { window.define.amd = amd; amd = null; } }
      var s = document.createElement('script');
      s.src = url;
      if (hostNonce) s.nonce = hostNonce;
      s.setAttribute('data-bspf-script', key);
      s.onload = function () { restore(); resolve(); };
      s.onerror = function () { restore(); delete scriptPromises[key]; reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
    return scriptPromises[key];
  }
  function whenPnp() {
    if (settings.mockSp) return Promise.resolve();
    if (window.pnp && window.pnp.sp) return Promise.resolve();
    return loadScript(pnpUrl, 'pnp', true).then(function () {
      if (!(window.pnp && window.pnp.sp)) throw new Error('pnpjs bundle loaded but window.pnp.sp is missing');
    });
  }
  function whenAlpine() {
    if (window.Alpine) return Promise.resolve();
    return loadScript(alpineUrl, 'alpine');
  }

  /* ------------------------------------------------------------------
     SharePoint page context + user
     ------------------------------------------------------------------ */
  function probeContexts() {
    var out = [];
    [window, window.parent, window.top].forEach(function (w) {
      try { if (w && w.location.href && w._spPageContextInfo) out.push(w._spPageContextInfo); } catch (e) { /* cross-origin — expected */ }
    });
    return out;
  }
  function getPageWebUrl() {
    if (settings.webUrl) return settings.webUrl;
    var ctxs = probeContexts();
    return ctxs.length ? ctxs[0].webAbsoluteUrl : null;
  }
  // Modern pages don't reliably expose _spPageContextInfo (the custom-script
  // web part only injects it when its toggle is on). Without it, find the
  // page's web over REST: try <path>/_api/web from the page's folder upward —
  // a folder that isn't a web answers 404, so the first hit is the deepest
  // web holding the page. Resolved once per page and shared by every mount.
  var restUser = null;
  var pageWebPromise = null;
  function resolvePageWeb() {
    var known = getPageWebUrl();
    if (known) return Promise.resolve(known);
    if (pageWebPromise) return pageWebPromise;
    var parts = location.pathname.split('/').slice(1, -1); // drop the leading '' and the page file
    var cands = [];
    for (var n = parts.length; n >= 0; n--) cands.push('/' + parts.slice(0, n).join('/'));
    var opts = { credentials: 'same-origin', headers: { accept: 'application/json;odata=nometadata' } };
    function tryAt(i) {
      if (i >= cands.length) return Promise.resolve(null);
      var base = location.origin + cands[i].replace(/\/$/, '');
      return fetch(base + '/_api/web?$select=Url', opts)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (j) { return j && j.Url ? j.Url : tryAt(i + 1); });
    }
    pageWebPromise = tryAt(0).then(function (url) {
      if (!url) { pageWebPromise = null; return null; } // retryable
      return fetch(url + '/_api/web/currentuser?$select=Title,Email,LoginName', opts)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (u) {
          if (u) restUser = { name: u.Title || '', email: u.Email || '', login: u.LoginName || '' };
          return url;
        });
    });
    return pageWebPromise;
  }
  function getUserInfo() {
    if (settings.mockSp && settings.mockSp.userInfo) return settings.mockSp.userInfo();
    var ctxs = probeContexts();
    if (!ctxs.length && restUser) return restUser;
    var c = ctxs[0] || {};
    return { name: c.userDisplayName || '', email: c.userEmail || '', login: c.userLoginName || '' };
  }
  function absUrl(u) {
    if (!u) return u;
    if (/^https?:/i.test(u)) return u;
    if (u.charAt(0) === '/') return location.origin + u;
    return u;
  }
  function resolveAsset(p) {
    // config asset paths ("abacus-icons/x.svg") resolve against the deployed
    // design-system folder; absolute urls/paths pass through untouched.
    if (!p) return p;
    if (/^https?:/i.test(p) || p.charAt(0) === '/') return p;
    return designBase + p;
  }

  /* ------------------------------------------------------------------
     SP adapter — one seam over pnpjs v2, replaceable by a mock.
     The mock (dev/mock-sp.js) implements the same method names.
     ------------------------------------------------------------------ */
  function makeAdapter(cfg) {
    if (settings.mockSp) return settings.mockSp;

    var pageWeb = getPageWebUrl();
    var targetWeb = cfg.target.siteUrl ? absUrl(cfg.target.siteUrl) : pageWeb;

    function requireCtx() {
      if (!targetWeb) throw new Error('no-context');
    }
    // target.listUrl: server-relative ("/sites/x/Lists/My List") or relative
    // to the target web ("Lists/My List"). Survives a list being renamed.
    function listServerRelUrl(u, webUrl) {
      if (u.charAt(0) === '/') return u;
      var w = webUrl || targetWeb;
      var base = w ? new URL(w, location.origin).pathname.replace(/\/$/, '') : '';
      return base + '/' + u.replace(/^\.?\//, '');
    }
    // any list by { siteUrl?, listUrl | listTitle } — same routing as the target list
    function listOf(spec) {
      var webUrl = spec.siteUrl ? absUrl(spec.siteUrl) : targetWeb;
      var w = spec.siteUrl ? web(webUrl) : web();
      return spec.listUrl ? w.getList(listServerRelUrl(spec.listUrl, webUrl)) : w.lists.getByTitle(spec.listTitle);
    }
    // OData string literal: a single quote is doubled (same rule as the
    // dcspad SPUtils esc helper)
    function odataStr(v) { return String(v).replace(/'/g, "''"); }
    // pnp loaded + page web known (resolved over REST when the page has no
    // _spPageContextInfo). Every SharePoint call goes through this.
    function whenCtx() {
      return whenPnp().then(resolvePageWeb).then(function (url) {
        if (url) {
          pageWeb = pageWeb || url;
          targetWeb = targetWeb || url;
        }
        requireCtx();
      });
    }
    function setupFor(url) {
      // pnpjs v2 setup is global; re-assert the base before operations so
      // two forms targeting different webs on one page stay correct.
      window.pnp.sp.setup({ sp: { baseUrl: url } });
    }
    function web(url) {
      var p = window.pnp;
      var target = url || targetWeb;
      if (typeof p.Web === 'function') return p.Web(target);
      setupFor(target);
      return p.sp.web;
    }
    function list() {
      var w = web();
      if (cfg.target.listId) return w.lists.getById(cfg.target.listId);
      if (cfg.target.listUrl) return w.getList(listServerRelUrl(cfg.target.listUrl));
      return w.lists.getByTitle(cfg.target.listTitle);
    }

    return {
      isMock: false,
      webUrl: function () { return targetWeb; },
      ready: function () {
        return whenCtx().then(function () {
          setupFor(targetWeb);
        });
      },
      userInfo: getUserInfo,
      searchPeople: function (q, max) {
        return whenCtx().then(function () {
          setupFor(pageWeb || targetWeb);
          return window.pnp.sp.profiles.clientPeoplePickerSearchUser({
            AllowEmailAddresses: false,
            AllowMultipleEntities: false,
            MaximumEntitySuggestions: max || 8,
            PrincipalSource: 15,   // all sources
            PrincipalType: 1,      // users only — no DLs, security/SP groups
            QueryString: q
          });
        }).then(function (entities) {
          return (entities || [])
            .filter(function (e) {
              if (e.EntityType && e.EntityType !== 'User') return false;
              if (e.IsResolved === false) return false;
              var mail = e.EntityData && (e.EntityData.Email || e.EntityData.SPUserID) ? e.EntityData.Email : (e.Description || '');
              // best-effort exclusion of system/room/service principals:
              // they typically resolve without a usable email.
              return !!mail;
            })
            .map(function (e) {
              return {
                key: e.Key,
                text: e.DisplayText,
                email: (e.EntityData && e.EntityData.Email) || e.Description || '',
                id: null
              };
            });
        });
      },
      ensureUser: function (key) {
        return whenCtx().then(function () {
          return web().ensureUser(key);
        }).then(function (r) { return r.data.Id; });
      },
      addItem: function (payload) {
        return whenCtx().then(function () {
          return list().items.add(payload);
        }).then(function (r) { return { id: r.data.Id, item: r.item }; });
      },
      addAttachment: function (itemRef, name, file) {
        return itemRef.attachmentFiles.add(name, file);
      },
      // first row where matchColumn equals value (SharePoint compares text
      // case-insensitively); returns returnColumn as a string — a Hyperlink
      // column's { Url } or a plain text value — or null
      lookupValue: function (lk) {
        return whenCtx().then(function () {
          return listOf(lk).items
            .select(lk.returnColumn)
            .filter(lk.matchColumn + " eq '" + odataStr(lk.value) + "'")
            .top(1)
            .get();
        }).then(function (rows) {
          var v = rows && rows[0] ? rows[0][lk.returnColumn] : null;
          if (v && typeof v === 'object') v = v.Url;
          return v ? String(v) : null;
        });
      },
      getListFields: function (spec) {
        return whenCtx().then(function () {
          return (spec ? listOf(spec) : list()).fields
            .select('InternalName', 'Title', 'TypeAsString', 'Required', 'ReadOnlyField', 'Hidden', 'RichText')
            .filter('Hidden eq false')
            .get();
        });
      },
      getLookupItems: function (lk) {
        var display = lk.displayField || 'Title';
        return whenCtx().then(function () {
          var w = lk.siteUrl ? web(absUrl(lk.siteUrl)) : web();
          return w.lists.getByTitle(lk.listTitle).items
            .select('Id', display)
            .orderBy(display, true)
            .top(lk.top || 500)
            .get();
        }).then(function (items) {
          return (items || []).map(function (it) { return { id: it.Id, text: String(it[display] == null ? it.Id : it[display]) }; });
        });
      }
    };
  }

  /* ------------------------------------------------------------------
     Config normalization + structural validation
     ------------------------------------------------------------------ */
  var TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'currency', 'choice',
    'multichoice', 'boolean', 'date', 'person', 'link', 'lookup', 'heading', 'note', 'hidden'];

  /* Values from the page URL (field.query). Parameter names match
     case-insensitively; URLSearchParams decodes the value, so an encoded
     link/name arrives as its plain text. field.normalize then trims it:
     keep "alnum" (a-z, 0-9 only), case "lower"/"upper", maxLength. */
  function readQuery(name) {
    var want = String(name).toLowerCase(), found = null;
    try {
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (found === null && k.toLowerCase() === want) found = v;
      });
    } catch (e) { /* no URLSearchParams: treat as absent */ }
    return found;
  }
  function normalizeVal(v, n) {
    var s = String(v == null ? '' : v).trim();
    if (!n) return s;
    if (n.keep === 'alnum') s = s.replace(/[^A-Za-z0-9]/g, '');
    if (n.case === 'lower') s = s.toLowerCase();
    else if (n.case === 'upper') s = s.toUpperCase();
    if (n.maxLength > 0) s = s.slice(0, n.maxLength);
    return s;
  }
  // only http(s) and server-relative targets leave the form as a link/redirect
  function safeHref(u) {
    var s = String(u == null ? '' : u).trim();
    return /^https?:\/\/[^\s]+$/i.test(s) || /^\/(?!\/)[^\s]*$/.test(s) ? s : '';
  }
  var PILL_CYCLE = ['blue', 'green', 'lavender', 'orange', 'teal', 'berry', 'yellow', 'sky', 'red', 'gray'];

  function normalizeConfig(raw) {
    var errors = [];
    var cfg = JSON.parse(JSON.stringify(raw || {}));

    cfg.form = cfg.form || {};
    cfg.form.appearance = Object.assign(
      { frame: 'card', header: 'band', tint: 'sky', icon: null },
      cfg.form.appearance || {});
    cfg.strings = Object.assign({}, DEFAULT_STRINGS, cfg.strings || {});
    // business calendar for withinBusinessDays rules and date prompts
    var bhRaw = cfg.form.businessHours;
    cfg._bh = null;
    if (bhRaw) {
      var bh = {
        timeZone: bhRaw.timeZone,
        days: Array.isArray(bhRaw.days) ? bhRaw.days : [1, 2, 3, 4, 5],
        dateAt: bhRaw.dateAt || 'end',
        _start: hhmm(bhRaw.start || '09:00'), _end: hhmm(bhRaw.end || '17:00')
      };
      if (!bh.timeZone) errors.push('form.businessHours.timeZone is required (e.g. "America/Toronto")');
      else {
        try { new Intl.DateTimeFormat('en-US', { timeZone: bh.timeZone }); }
        catch (e) { errors.push('form.businessHours.timeZone "' + bh.timeZone + '" is not a valid time zone'); }
      }
      if (bh._start == null || bh._end == null || bh._end <= bh._start) {
        errors.push('form.businessHours start/end must be "HH:MM" with end after start');
      }
      if (bh.dateAt !== 'end' && bh.dateAt !== 'start') errors.push('form.businessHours.dateAt must be "end" or "start"');
      cfg._bh = bh;
    }
    cfg.target = cfg.target || {};
    if (!cfg.target.listTitle && !cfg.target.listId && !cfg.target.listUrl) {
      errors.push('target.listTitle, target.listUrl or target.listId is required');
    }
    cfg.confirmation = Object.assign({ title: null, message: null, allowAnother: true }, cfg.confirmation || {});
    cfg.attachments = Object.assign({
      enabled: false, required: false, label: 'Attachments', hint: '',
      maxFiles: 10, maxFileSizeMb: 10, accept: null, page: null
    }, cfg.attachments || {});

    if (!Array.isArray(cfg.pages) || !cfg.pages.length) errors.push('pages must be a non-empty array');
    cfg.pages = cfg.pages || [];

    // null-prototype maps: field/section ids are author-supplied, so keys
    // like "constructor" must be plain data, not inherited properties
    var byKey = Object.create(null), ordered = [], keyOfId = Object.create(null);
    var sectionsById = Object.create(null);
    cfg.pages.forEach(function (pg, pi) {
      pg.id = pg.id || ('page' + (pi + 1));
      pg.sections = Array.isArray(pg.sections) ? pg.sections : [];
      if (!pg.sections.length) errors.push('page "' + pg.id + '" has no sections');
      pg.sections.forEach(function (sec, si) {
        sec.id = sec.id || (pg.id + '_s' + (si + 1));
        sec._page = pi;
        if (sectionsById[sec.id]) errors.push('duplicate section id "' + sec.id + '"');
        else sectionsById[sec.id] = sec;
        sec.fields = Array.isArray(sec.fields) ? sec.fields : [];
        if (sec.columns != null && sec.columns !== 1 && sec.columns !== 2) {
          errors.push('section "' + sec.id + '": columns must be 1 or 2');
        }
        sec.fields.forEach(function (f, fi) {
          if (!f.id) { errors.push('field #' + (fi + 1) + ' in section "' + sec.id + '" is missing an id'); f.id = sec.id + '_f' + fi; }
          if (TYPES.indexOf(f.type) < 0) errors.push('field "' + f.id + '": unknown type "' + f.type + '"');
          if (f.span != null && f.span !== 'full') errors.push('field "' + f.id + '": span must be "full" (or omitted)');
          var k = safeKey(f.id);
          if (byKey[k]) errors.push('duplicate field id "' + f.id + '"');
          f.k = k; f.page = pi; f.section = sec.id;
          f.validation = f.validation || {};
          if (f.validation.pattern != null) {
            // compile once: a bad pattern is a config error, never a
            // silently-disabled rule
            try { f._pattern = new RegExp(f.validation.pattern); }
            catch (e) { errors.push('field "' + f.id + '": validation.pattern is invalid (' + e.message + ')'); }
          }
          if (f.type === 'choice' || f.type === 'multichoice') {
            var ch = Array.isArray(f.choices) ? f.choices : [];
            if (!ch.length) errors.push('field "' + f.id + '": choices are required for type ' + f.type);
            f.choices = ch.map(function (c, ci) {
              var o = (typeof c === 'string') ? { value: c } : Object.assign({}, c);
              if (!o.color) o.color = PILL_CYCLE[ci % PILL_CYCLE.length];
              return o;
            });
          }
          if (f.type === 'lookup') {
            f.lookup = f.lookup || {};
            if (!f.lookup.listTitle) errors.push('field "' + f.id + '": lookup.listTitle is required');
            if (!f.color) f.color = 'blue';
          }
          if (f.type === 'person') f.multiple = !!f.multiple;
          if (f.type === 'date') f.includeTime = !!f.includeTime;
          if (f.type === 'heading' || f.type === 'note') f.column = null;
          byKey[k] = f; keyOfId[f.id] = k; ordered.push(f);
        });
      });
    });

    // resolve rule references
    function checkRuleRefs(rule, where) {
      if (!rule) return;
      if (rule.all) return rule.all.forEach(function (r) { checkRuleRefs(r, where); });
      if (rule.any) return rule.any.forEach(function (r) { checkRuleRefs(r, where); });
      if (rule.not) return checkRuleRefs(rule.not, where);
      if (rule.field && !keyOfId[rule.field]) errors.push(where + ': rule references unknown field "' + rule.field + '"');
      if (rule.op === 'withinBusinessDays' && !cfg._bh) errors.push(where + ': withinBusinessDays needs form.businessHours');
      if (rule.compareTo && rule.compareTo !== '@today' && !keyOfId[rule.compareTo]) {
        errors.push(where + ': rule compares to unknown field "' + rule.compareTo + '"');
      }
    }
    ordered.forEach(function (f) {
      checkRuleRefs(f.visibleWhen, 'field "' + f.id + '"');
      var where = 'field "' + f.id + '"';
      if (f.control != null && (f.type !== 'boolean' || (f.control !== 'switch' && f.control !== 'checkbox'))) {
        errors.push(where + ': control is "switch" or "checkbox", on boolean fields only');
      }
      if (f.values != null) {
        if (f.type !== 'boolean') errors.push(where + ': values is only for boolean fields');
        else if (typeof f.values.on !== 'string' || typeof f.values.off !== 'string') {
          errors.push(where + ': values needs string "on" and "off"');
        }
      }
      if (f.lockWhen) {
        checkRuleRefs(f.lockWhen, where + ' lockWhen');
        if (f.lockValue === undefined) f.lockValue = true;
      }
      if (f.query != null) {
        if (typeof f.query !== 'string' || !f.query) errors.push(where + ': query must be a URL parameter name');
        if (['text', 'textarea', 'email', 'phone', 'hidden', 'choice'].indexOf(f.type) < 0) {
          errors.push(where + ': query works on text, textarea, email, phone, hidden and choice fields');
        }
      }
      if (f.normalize != null && (typeof f.normalize !== 'object' ||
          (f.normalize.keep != null && f.normalize.keep !== 'alnum') ||
          (f.normalize.case != null && f.normalize.case !== 'lower' && f.normalize.case !== 'upper'))) {
        errors.push(where + ': normalize takes { keep: "alnum", case: "lower" | "upper", maxLength }');
      }
      if (f.type === 'hidden' && !f.query && f.default == null) errors.push(where + ': a hidden field needs query or default');
      if (f.readOnly && f.type !== 'text') errors.push(where + ': readOnly is only for text fields');
      if (f.prompt) {
        var pr = f.prompt;
        if (f.type !== 'date') errors.push(where + ': prompt is only for date fields');
        if (!cfg._bh) errors.push(where + ': prompt needs form.businessHours');
        if (!(+pr.withinBusinessDays > 0)) errors.push(where + ': prompt.withinBusinessDays must be a positive number');
        if (!pr.message) errors.push(where + ': prompt.message is required');
        Object.keys((pr.confirm && pr.confirm.set) || {}).forEach(function (id) {
          if (!keyOfId[id]) errors.push(where + ': prompt.confirm.set references unknown field "' + id + '"');
        });
        if (pr.alternative && !(+pr.alternative.moveToBusinessDays > 0)) {
          errors.push(where + ': prompt.alternative.moveToBusinessDays must be a positive number');
        }
      }
      (f.rules || []).forEach(function (r) {
        checkRuleRefs({ field: f.id, compareTo: r.compareTo }, 'field "' + f.id + '"');
      });
    });
    cfg.pages.forEach(function (pg) {
      pg.sections.forEach(function (sec) { checkRuleRefs(sec.visibleWhen, 'section "' + sec.id + '"'); });
    });

    // afterSubmit (post-submit lookup + result screens) and queryError
    function checkScreen(s, where) {
      if (!s || typeof s !== 'object') { errors.push(where + ' must be an object'); return; }
      if (s.redirect && !s.redirect.url) errors.push(where + '.redirect.url is required');
    }
    var as = cfg.afterSubmit;
    if (as) {
      if (as.lookup) {
        var lk = as.lookup;
        if (!lk.listUrl && !lk.listTitle) errors.push('afterSubmit.lookup needs listUrl or listTitle');
        if (!lk.matchColumn || !lk.returnColumn) errors.push('afterSubmit.lookup needs matchColumn and returnColumn');
        if (!keyOfId[lk.matchField]) errors.push('afterSubmit.lookup.matchField "' + lk.matchField + '" is not a field id');
        checkScreen(as.found, 'afterSubmit.found');
      }
      checkScreen(as.notFound, 'afterSubmit.notFound');
    }
    if (cfg.queryError) checkScreen(cfg.queryError, 'queryError');

    if (cfg.attachments.enabled && cfg.attachments.section != null) {
      // render inside a section (its page wins over attachments.page)
      var asec = sectionsById[cfg.attachments.section];
      if (!asec) errors.push('attachments.section "' + cfg.attachments.section + '" is not a section id');
      else if (asec.visibleWhen) errors.push('attachments.section "' + asec.id + '" must not have visibleWhen');
      else cfg.attachments.page = asec._page;
    }
    if (cfg.attachments.enabled) {
      var ap = cfg.attachments.page;
      if (ap == null) cfg.attachments.page = cfg.pages.length - 1;
      else if (ap < 0 || ap >= cfg.pages.length) { errors.push('attachments.page is out of range'); cfg.attachments.page = cfg.pages.length - 1; }
    }

    // shared columns — several fields may write one column, but only when
    // the config says so explicitly; accidental duplicates are config errors.
    var shared = Array.isArray(cfg.sharedColumns) ? cfg.sharedColumns.slice() : [];
    var colFields = Object.create(null);
    ordered.forEach(function (f) {
      if (f.column) (colFields[f.column] = colFields[f.column] || []).push(f.id);
    });
    Object.keys(colFields).forEach(function (col) {
      if (colFields[col].length > 1 && shared.indexOf(col) < 0) {
        errors.push('column "' + col + '" is mapped by multiple fields (' + colFields[col].join(', ') +
          ') — declare it in sharedColumns to confirm the conditional variants are intentional');
      }
    });
    shared.forEach(function (col) {
      if (!colFields[col]) errors.push('sharedColumns entry "' + col + '" is not mapped by any field');
    });
    cfg._sharedColumns = shared; cfg._colFields = colFields;

    cfg._byKey = byKey; cfg._ordered = ordered; cfg._keyOfId = keyOfId;
    cfg._sectionsById = sectionsById;
    return { cfg: cfg, errors: errors };
  }

  /* ------------------------------------------------------------------
     Rule engine — visibility + date comparisons.
     get(fieldId) -> current value. Date ops compare calendar days:
       value(field)  <op>  value(compareTo) + days
     ------------------------------------------------------------------ */
  var DATE_OPS = { after: 1, onOrAfter: 1, before: 1, onOrBefore: 1 };

  function isEmptyVal(v) {
    if (v == null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return !v.url && !v.id && !v.text;
    return false;
  }
  function evalDateOp(op, mine, base, days) {
    if (!mine || !base) return null; // unknown — caller decides
    var b = new Date(base.getTime() + (days || 0) * 86400000);
    var d = dayDiff(mine, b);
    if (op === 'after') return d > 0;
    if (op === 'onOrAfter') return d >= 0;
    if (op === 'before') return d < 0;
    if (op === 'onOrBefore') return d <= 0;
    return null;
  }
  // bh = the form's normalized businessHours (needed only by withinBusinessDays)
  function evalRule(rule, get, bh) {
    if (!rule) return true;
    if (rule.all) return rule.all.every(function (r) { return evalRule(r, get, bh); });
    if (rule.any) return rule.any.some(function (r) { return evalRule(r, get, bh); });
    if (rule.not) return !evalRule(rule.not, get, bh);
    var v = get(rule.field);
    var op = rule.op || 'equals';
    if (DATE_OPS[op]) {
      var mine = parseDateVal(v);
      var base = rule.compareTo === '@today' ? today0() : parseDateVal(get(rule.compareTo));
      var r = evalDateOp(op, mine, base, rule.days);
      return r === null ? false : r;
    }
    switch (op) {
      case 'equals': return eqLoose(v, rule.value);
      case 'notEquals': return !eqLoose(v, rule.value);
      case 'in': return Array.isArray(rule.value) && rule.value.some(function (x) { return eqLoose(v, x); });
      case 'notIn': return !(Array.isArray(rule.value) && rule.value.some(function (x) { return eqLoose(v, x); }));
      case 'includes': return Array.isArray(v) && v.indexOf(rule.value) > -1;
      case 'includesAny': return Array.isArray(v) && Array.isArray(rule.value) && rule.value.some(function (x) { return v.indexOf(x) > -1; });
      case 'includesAll': return Array.isArray(v) && Array.isArray(rule.value) && rule.value.every(function (x) { return v.indexOf(x) > -1; });
      case 'isEmpty': return isEmptyVal(v);
      case 'notEmpty': return !isEmptyVal(v);
      case 'withinBusinessDays': return !!bh && !isEmptyVal(v) && bizWithin(bh, v, +rule.value, nowMs());
      default: return false;
    }
  }
  function eqLoose(a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    if (a == null) return b == null || b === '';
    return String(a) === String(b);
  }

  /* ------------------------------------------------------------------
     Field validators — return '' (ok) or a message. Warnings for date
     warn-mode rules are returned separately.
     ------------------------------------------------------------------ */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function validPhone(v) {
    if (!/^\+?[\d\s().-]{7,24}$/.test(v)) return false;
    return (v.match(/\d/g) || []).length >= 7;
  }
  function validUrl(v) {
    try { var u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------------------
     Markup builders — every user-supplied string is escaped; every
     Alpine expression only references the instance's own state/methods.
     ------------------------------------------------------------------ */
  var ICONS = {
    info: 'ic-fluent-info-24-regular',
    warning: 'ic-fluent-warning-24-regular',
    success: 'ic-fluent-checkmark-circle-24-regular',
    danger: 'ic-fluent-dismiss-circle-24-regular'
  };
  function icon(name, size) {
    return '<svg class="icon icon--' + (size || 16) + '" aria-hidden="true"><use href="#' + name + '"/></svg>';
  }
  // Author prose (intro, descriptions, hints, notes, confirmation): escaped,
  // then [text](url) becomes a link. Only http(s), mailto, server-relative
  // and #anchor targets. Off-page links open in a new tab so a half-filled
  // form isn't lost.
  var LINK_RE = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^)\s]*)\)/g;
  function prose(s) {
    return esc(s).replace(LINK_RE, function (m, text, href) {
      var ext = href.charAt(0) !== '#';
      return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + text + '</a>';
    });
  }

  function fieldShell(f, inner, S) {
    var noLabel = f.type === 'heading' || f.type === 'note' || f.type === 'boolean';
    var h = '<div class="field' + (f.span === 'full' ? ' bspf-field--full' : '') + '" data-bspf-field="' + esc(f.k) + '"';
    if (f.visibleWhen) h += ' x-show="vis(' + esc(jstr(f.k)) + ')" x-cloak';
    h += '>';
    if (!noLabel) {
      h += '<label class="field__label" for="' + esc(f.domId) + '">' + esc(f.label || f.id);
      if (f.required) h += ' <span class="field__req" aria-hidden="true">*</span>';
      h += '</label>';
    }
    h += inner;
    if (f.hint) h += '<p class="field__hint">' + prose(f.hint) + '</p>';
    if (f.type !== 'heading' && f.type !== 'note') {
      h += '<p class="field__error" role="alert" x-show="errors.' + f.k + '" x-text="errors.' + f.k + '" x-cloak></p>';
      h += '<p class="bspf-field__warning" x-show="warnings.' + f.k + '" x-text="warnings.' + f.k + '" x-cloak></p>';
    }
    h += '</div>';
    return h;
  }

  function inputCommon(f) {
    return ' id="' + esc(f.domId) + '" @blur="touch(' + esc(jstr(f.k)) + ')"' +
      ' @input="reval(' + esc(jstr(f.k)) + ')" :aria-invalid="errors.' + f.k + ' ? \'true\' : \'false\'"' +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
  }

  function renderReadOnly(f) {
    // shown, never edited (e.g. a value carried in from the URL); the row
    // disappears when there's nothing to show. x-text = never parsed as HTML.
    var vis = f.visibleWhen ? 'values.' + f.k + ' && vis(' + esc(jstr(f.k)) + ')' : 'values.' + f.k;
    var h = '<div class="field bspf-readonly' + (f.span === 'full' ? ' bspf-field--full' : '') + '" data-bspf-field="' + esc(f.k) + '"' +
      ' x-show="' + vis + '" x-cloak>';
    h += '<span class="field__label">' + esc(f.label || f.id) + '</span>';
    h += '<p class="bspf-readonly__value" id="' + esc(f.domId) + '" x-text="values.' + f.k + '"></p>';
    if (f.hint) h += '<p class="field__hint">' + prose(f.hint) + '</p>';
    return h + '</div>';
  }

  function renderText(f, S) {
    if (f.readOnly) return renderReadOnly(f);
    var type = f.type === 'email' ? 'email' : (f.type === 'phone' ? 'tel' : 'text');
    var maxAttr = f.validation.maxLength ? ' maxlength="' + (+f.validation.maxLength) + '"' : '';
    return fieldShell(f,
      '<input class="input" type="' + type + '"' + maxAttr + ' x-model.trim="values.' + f.k + '"' + inputCommon(f) + '>', S);
  }
  function renderTextarea(f, S) {
    var maxAttr = f.validation.maxLength ? ' maxlength="' + (+f.validation.maxLength) + '"' : '';
    return fieldShell(f,
      '<textarea class="textarea"' + maxAttr + (f.rows ? ' rows="' + (+f.rows) + '"' : '') +
      ' x-model="values.' + f.k + '"' + inputCommon(f) + '></textarea>', S);
  }
  function renderNumber(f, S) {
    var step = f.type === 'currency' ? '0.01' : (f.validation.integer ? '1' : 'any');
    return fieldShell(f,
      '<input class="input" type="number" inputmode="decimal" step="' + step + '"' +
      ' x-model.number="values.' + f.k + '"' + inputCommon(f) + '>', S);
  }
  function renderBoolean(f, S) {
    if (f.control === 'checkbox') {
      // design-system .check: the box's own text is toggleText, or the label
      // when there's no toggleText (then no separate label row)
      var cb = f.toggleText
        ? '<span class="field__label" id="' + esc(f.domId) + '_lbl">' + esc(f.label || f.id) +
          (f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>'
        : '';
      cb += '<label class="check">' +
        '<input type="checkbox" id="' + esc(f.domId) + '"' + (f.toggleText ? ' aria-describedby="' + esc(f.domId) + '_lbl"' : '') +
        ' x-model="values.' + f.k + '" @change="check(' + esc(jstr(f.k)) + ')"' +
        (f.lockWhen ? ' :disabled="locked(' + esc(jstr(f.k)) + ')"' : '') + '>' +
        ' <span>' + esc(f.toggleText || f.label || f.id) +
        (!f.toggleText && f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span></label>';
      return fieldShell(f, cb, S);
    }
    var inner =
      '<span class="field__label" id="' + esc(f.domId) + '_lbl">' + esc(f.label || f.id) +
      (f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>' +
      '<label class="switch">' +
      '<input type="checkbox" id="' + esc(f.domId) + '" aria-labelledby="' + esc(f.domId) + '_lbl"' +
      ' x-model="values.' + f.k + '" @change="check(' + esc(jstr(f.k)) + ')"' +
      (f.lockWhen ? ' :disabled="locked(' + esc(jstr(f.k)) + ')"' : '') + '>' +
      '<span class="switch__track"></span>' +
      (f.toggleText ? ' <span>' + esc(f.toggleText) + '</span>'
        // values: the switch reads out the word it will save
        : f.values ? ' <span x-text="values.' + f.k + ' ? ' + esc(jstr(f.values.on)) + ' : ' + esc(jstr(f.values.off)) + '"></span>' : '') +
      '</label>';
    if (f.lockWhen && f.lockNote) {
      inner += '<p class="bspf-field__lock" x-show="locked(' + esc(jstr(f.k)) + ')" x-cloak>' +
        icon('ic-fluent-info-24-regular', 16) + '<span>' + prose(f.lockNote) + '</span></p>';
    }
    return fieldShell(f, inner, S);
  }
  function renderDate(f, S) {
    return fieldShell(f,
      '<input class="input" type="' + (f.includeTime ? 'datetime-local' : 'date') + '"' +
      ' x-model="values.' + f.k + '" @change="dateChanged(' + esc(jstr(f.k)) + ')"' + inputCommon(f) + '>', S);
  }
  function renderLink(f, S) {
    var h = '<input class="input" type="url" x-model.trim="values.' + f.k + '.url"' + inputCommon(f).replace('placeholder="', 'data-x-ph="');
    h += (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : ' placeholder="' + esc(S.linkUrlPlaceholder) + '"') + '>';
    if (f.withDescription) {
      h += '<input class="input" type="text" aria-label="' + esc(S.linkDescPlaceholder) + '" placeholder="' + esc(S.linkDescPlaceholder) + '"' +
        ' x-model.trim="values.' + f.k + '.desc">';
    }
    return fieldShell(f, h, S);
  }

  function pillHtml(color, contentHtml) {
    return '<span class="bspf-pill bspf-pill--' + esc(color) + '"><span>' + contentHtml + '</span></span>';
  }

  function renderChoice(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="bspf-combo" @click.outside="ui.' + K + '=false" @keydown.escape.stop="ui.' + K + '=false">';
    h += '<div class="bspf-combo__control" id="' + esc(f.domId) + '" role="combobox" tabindex="0"' +
      ' aria-haspopup="listbox" :aria-expanded="ui.' + K + ' ? \'true\' : \'false\'"' +
      ' :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="ui.' + K + '=!ui.' + K + '"' +
      ' @keydown.enter.prevent="ui.' + K + '=!ui.' + K + '" @keydown.space.prevent="ui.' + K + '=!ui.' + K + '">';
    h += '<span class="bspf-combo__value">';
    h += '<span class="bspf-combo__placeholder" x-show="!values.' + K + '">' + esc(f.placeholder || S.comboPlaceholder) + '</span>';
    f.choices.forEach(function (c) {
      h += '<span class="bspf-pill bspf-pill--' + esc(c.color) + '" x-show="values.' + K + '===' + esc(jstr(c.value)) + '"><span>' + esc(c.value) + '</span></span>';
    });
    if (f.fillIn) {
      h += '<span class="bspf-pill bspf-pill--gray" x-show="isCustom(' + kq + ')" x-cloak><span x-text="values.' + K + '"></span></span>';
    }
    h += '</span>' + icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="bspf-combo__chevron icon') + '</div>';
    h += '<div class="bspf-combo__menu" x-show="ui.' + K + '" x-cloak role="listbox">';
    f.choices.forEach(function (c) {
      var vq = esc(jstr(c.value));
      h += '<button type="button" class="bspf-combo__option" role="option"' +
        ' :aria-selected="values.' + K + '===' + vq + ' ? \'true\' : \'false\'"' +
        ' @click="pickChoice(' + kq + ',' + vq + ')">' +
        pillHtml(c.color, esc(c.value)) +
        '<span class="bspf-combo__check" x-show="values.' + K + '===' + vq + '" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span>' +
        '</button>';
    });
    if (f.fillIn) {
      h += '<div class="bspf-combo__fillin" @click.stop>' +
        '<input class="input" type="text" placeholder="' + esc(S.fillInPlaceholder) + '" x-model.trim="fill.' + K + '"' +
        ' @keydown.enter.prevent="pickFill(' + kq + ')">' +
        '<button type="button" class="btn btn--sm" @click="pickFill(' + kq + ')">' + esc(S.fillInAdd) + '</button></div>';
    }
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderMultichoice(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="bspf-combo" @click.outside="ui.' + K + '=false" @keydown.escape.stop="ui.' + K + '=false">';
    h += '<div class="bspf-combo__control" id="' + esc(f.domId) + '" role="combobox" tabindex="0"' +
      ' aria-haspopup="listbox" :aria-expanded="ui.' + K + ' ? \'true\' : \'false\'"' +
      ' :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="ui.' + K + '=!ui.' + K + '"' +
      ' @keydown.enter.prevent="ui.' + K + '=!ui.' + K + '" @keydown.space.prevent="ui.' + K + '=!ui.' + K + '">';
    h += '<span class="bspf-combo__value">';
    h += '<span class="bspf-combo__placeholder" x-show="!values.' + K + '.length">' + esc(f.placeholder || S.comboPlaceholderMulti) + '</span>';
    f.choices.forEach(function (c) {
      var vq = esc(jstr(c.value));
      h += '<span class="bspf-pill bspf-pill--' + esc(c.color) + '" x-show="values.' + K + '.indexOf(' + vq + ')>-1"><span>' + esc(c.value) + '</span>' +
        '<button type="button" class="bspf-pill__remove" aria-label="' + esc(S.attachRemove) + '" @click.stop="toggleMulti(' + kq + ',' + vq + ')">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
        '</span>';
    });
    if (f.fillIn) {
      h += '<template x-for="cv in customSel(' + kq + ')" :key="cv">' +
        '<span class="bspf-pill bspf-pill--gray"><span x-text="cv"></span>' +
        '<button type="button" class="bspf-pill__remove" aria-label="' + esc(S.attachRemove) + '" @click.stop="toggleMulti(' + kq + ', cv)">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
        '</span></template>';
    }
    h += '</span>' + icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="bspf-combo__chevron icon') + '</div>';
    h += '<div class="bspf-combo__menu" x-show="ui.' + K + '" x-cloak role="listbox" aria-multiselectable="true">';
    f.choices.forEach(function (c) {
      var vq = esc(jstr(c.value));
      h += '<button type="button" class="bspf-combo__option" role="option"' +
        ' :aria-selected="values.' + K + '.indexOf(' + vq + ')>-1 ? \'true\' : \'false\'"' +
        ' @click="toggleMulti(' + kq + ',' + vq + ')">' +
        pillHtml(c.color, esc(c.value)) +
        '<span class="bspf-combo__check" x-show="values.' + K + '.indexOf(' + vq + ')>-1" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span>' +
        '</button>';
    });
    if (f.fillIn) {
      h += '<div class="bspf-combo__fillin" @click.stop>' +
        '<input class="input" type="text" placeholder="' + esc(S.fillInPlaceholder) + '" x-model.trim="fill.' + K + '"' +
        ' @keydown.enter.prevent="pickFillMulti(' + kq + ')">' +
        '<button type="button" class="btn btn--sm" @click="pickFillMulti(' + kq + ')">' + esc(S.fillInAdd) + '</button></div>';
    }
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderLookup(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="bspf-combo" @click.outside="ui.' + K + '=false" @keydown.escape.stop="ui.' + K + '=false">';
    h += '<div class="bspf-combo__control" id="' + esc(f.domId) + '" role="combobox" tabindex="0"' +
      ' aria-haspopup="listbox" :aria-expanded="ui.' + K + ' ? \'true\' : \'false\'"' +
      ' :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="openLookup(' + kq + ')"' +
      ' @keydown.enter.prevent="openLookup(' + kq + ')" @keydown.space.prevent="openLookup(' + kq + ')">';
    h += '<span class="bspf-combo__value">';
    h += '<span class="bspf-combo__placeholder" x-show="!values.' + K + '">' + esc(f.placeholder || S.comboPlaceholder) + '</span>';
    h += '<span class="bspf-pill bspf-pill--' + esc(f.color) + '" x-show="values.' + K + '" x-cloak><span x-text="values.' + K + ' && values.' + K + '.text"></span></span>';
    h += '</span>' + icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="bspf-combo__chevron icon') + '</div>';
    h += '<div class="bspf-combo__menu" x-show="ui.' + K + '" x-cloak role="listbox">';
    h += '<div class="spinner-row" x-show="lkBusy.' + K + '"><span class="spinner spinner--16" role="progressbar" aria-label="' + esc(S.lookupLoading) + '"></span> ' + esc(S.lookupLoading) + '</div>';
    h += '<div class="bspf-people__note" x-show="lkErr.' + K + '" x-text="lkErr.' + K + '" x-cloak></div>';
    h += '<template x-for="opt in lkOpts.' + K + '" :key="opt.id">' +
      '<button type="button" class="bspf-combo__option" role="option"' +
      ' :aria-selected="values.' + K + ' && values.' + K + '.id===opt.id ? \'true\' : \'false\'"' +
      ' @click="pickLookup(' + kq + ', opt)">' +
      '<span class="bspf-pill bspf-pill--' + esc(f.color) + '"><span x-text="opt.text"></span></span>' +
      '<span class="bspf-combo__check" x-show="values.' + K + ' && values.' + K + '.id===opt.id" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span>' +
      '</button></template>';
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderPerson(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="bspf-people" @click.outside="pOpen.' + K + '=false">';
    h += '<div class="bspf-people__control" :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="focusPeople(' + kq + ')">';
    h += '<template x-for="(p, i) in values.' + K + '" :key="p.key">' +
      '<span class="tag bspf-people__tag">' +
      '<img class="bspf-people__photo" :src="photoUrl(p)" alt="" x-show="!photoFail[p.key]" @error="photoFail[p.key]=true">' +
      '<span class="avatar avatar--20" x-show="photoFail[p.key]" x-text="initials(p.text)" x-cloak></span>' +
      '<span x-text="p.text"></span>' +
      '<button type="button" class="tag__remove" :aria-label="\'' + esc(S.attachRemove) + ' \' + p.text" @click.stop="removePerson(' + kq + ', i)">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
      '</span></template>';
    h += '<input class="bspf-people__input" id="' + esc(f.domId) + '" type="text" autocomplete="off"' +
      ' x-show="canAddPerson(' + kq + ')" x-model="pq.' + K + '"' +
      ' placeholder="' + esc(f.placeholder || S.personPlaceholder) + '"' +
      ' @focus="pOpen.' + K + '=true"' +
      ' @input.debounce.300ms="searchPeople(' + kq + ')"' +
      ' @keydown.down.prevent="pMove(' + kq + ', 1)"' +
      ' @keydown.up.prevent="pMove(' + kq + ', -1)"' +
      ' @keydown.enter.prevent="pickActive(' + kq + ')"' +
      ' @keydown.backspace="maybePopPerson(' + kq + ', $event)"' +
      ' @blur="touch(' + kq + ')">';
    h += '</div>';
    h += '<div class="bspf-people__menu" x-show="pOpen.' + K + ' && (pBusy.' + K + ' || pq.' + K + '.length>1)" x-cloak role="listbox">';
    h += '<div class="spinner-row" x-show="pBusy.' + K + '"><span class="spinner spinner--16" role="progressbar" aria-label="' + esc(S.personSearching) + '"></span> ' + esc(S.personSearching) + '</div>';
    h += '<template x-for="(s, i) in pRes.' + K + '" :key="s.key">' +
      '<button type="button" class="bspf-people__option" :class="{ \'is-active\': i===pIdx.' + K + ' }" role="option"' +
      ' :aria-selected="i===pIdx.' + K + ' ? \'true\' : \'false\'" @click="addPerson(' + kq + ', s)">' +
      '<img class="bspf-people__photo--lg" :src="photoUrl(s)" alt="" x-show="!photoFail[s.key]" @error="photoFail[s.key]=true">' +
      '<span class="avatar avatar--28" x-show="photoFail[s.key]" x-text="initials(s.text)" x-cloak></span>' +
      '<span class="bspf-people__name" x-text="s.text"></span>' +
      '<span class="bspf-people__mail" x-text="s.email"></span>' +
      '</button></template>';
    h += '<div class="bspf-people__note" x-show="!pBusy.' + K + ' && pq.' + K + '.length>1 && !pRes.' + K + '.length" x-cloak>' + esc(S.personNoResults) + '</div>';
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderHeading(f) {
    // one wrapper owns title + description so visibility hides both
    var h = '<div class="bspf-heading"';
    if (f.visibleWhen) h += ' x-show="vis(' + esc(jstr(f.k)) + ')" x-cloak';
    h += '>';
    h += '<div class="bspf-section__title" role="heading" aria-level="4">' + esc(f.text || f.label || '') + '</div>';
    if (f.description) h += '<p class="bspf-section__desc">' + prose(f.description) + '</p>';
    return h + '</div>';
  }
  function renderNote(f) {
    var style = f.style || 'info';
    var vis = f.visibleWhen ? ' x-show="vis(' + esc(jstr(f.k)) + ')" x-cloak' : '';
    if (style === 'plain') {
      return '<p class="field__hint"' + vis + '>' + prose(f.text || '') + '</p>';
    }
    return '<div class="msgbar msgbar--' + esc(style) + '" role="status"' + vis + '>' +
      icon(ICONS[style] || ICONS.info, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body">' + prose(f.text || '') + '</div></div>';
  }

  function renderAttachments(cfg, S, uid) {
    var a = cfg.attachments;
    var labelId = uid + '-att-label'; // per-instance: DOM ids are document-global
    var acceptAttr = a.accept && a.accept.length ? ' accept="' + esc(a.accept.join(',')) + '"' : '';
    var hint = a.hint || fmtStr(S.attachHint, {}) ||
      (a.maxFiles + ' files max · ' + a.maxFileSizeMb + ' MB each' + (a.accept && a.accept.length ? ' · ' + a.accept.join(', ') : ''));
    var h = '<div class="field bspf-attach bspf-field--full" data-bspf-field="_attachments">';
    h += '<span class="field__label" id="' + esc(labelId) + '">' + esc(a.label) +
      (a.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>';
    h += '<div class="dropzone bspf-attach__drop" tabindex="0" role="button" aria-labelledby="' + esc(labelId) + '"' +
      ' :class="{ \'is-drag\': dragging }"' +
      ' @click="$refs.fileinp.click()" @keydown.enter.prevent="$refs.fileinp.click()"' +
      ' @dragover.prevent="dragging=true" @dragleave="dragging=false" @drop.prevent="dropFiles($event)">' +
      icon('ic-fluent-attach-24-regular', 24) +
      '<div>' + esc(S.attachDrop) + '</div>' +
      '<p class="dropzone__hint">' + esc(hint) + '</p></div>';
    h += '<input type="file" multiple hidden x-ref="fileinp"' + acceptAttr + ' @change="pickFiles($event)">';
    h += '<div class="bspf-attach__list" x-show="filesMeta.length" x-cloak>';
    h += '<template x-for="(fm, i) in filesMeta" :key="fm.uid">' +
      '<div class="bspf-attach__item" :class="{ \'is-failed\': fm.status===\'failed\', \'is-done\': fm.status===\'done\' }">' +
      icon('ic-fluent-document-24-regular', 20) +
      '<span class="bspf-attach__name" x-text="fm.name"></span>' +
      '<span class="bspf-attach__size" x-text="fm.status===\'done\' ? ' + esc(jstr(S.attachDone)) + ' : fm.sizeLabel"></span>' +
      '<button type="button" class="icon-btn" aria-label="' + esc(S.attachRemove) + '" x-show="fm.status!==\'done\'" @click="removeFile(i)">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
      '</div></template>';
    h += '</div>';
    h += '<p class="field__error" role="alert" x-show="errors._attachments" x-text="errors._attachments" x-cloak></p>';
    h += '</div>';
    return h;
  }

  function renderField(f, S) {
    switch (f.type) {
      case 'text': case 'email': case 'phone': return renderText(f, S);
      case 'textarea': return renderTextarea(f, S);
      case 'number': case 'currency': return renderNumber(f, S);
      case 'boolean': return renderBoolean(f, S);
      case 'date': return renderDate(f, S);
      case 'link': return renderLink(f, S);
      case 'choice': return renderChoice(f, S);
      case 'multichoice': return renderMultichoice(f, S);
      case 'lookup': return renderLookup(f, S);
      case 'person': return renderPerson(f, S);
      case 'heading': return renderHeading(f);
      case 'note': return renderNote(f);
      case 'hidden': return ''; // carried in state + submitted, never rendered
      default: return '';
    }
  }

  function renderForm(uid, cfg) {
    var S = cfg.strings;
    var ap = cfg.form.appearance;
    var card = ap.frame !== 'plain';
    var pages = cfg.pages;
    var last = pages.length - 1;
    var h = '<div class="bspf' + (card ? ' bspf--card' : '') + '" x-data="BSPForms.instance(' + esc(jstr(uid)) + ')" data-bspf-uid="' + esc(uid) + '">';

    // Header — shown on every view so the form keeps its identity through
    // the confirmation screen.
    if ((cfg.form.title && cfg.form.showTitle !== false) || cfg.form.intro || ap.icon) {
      var headCls = 'bspf__head' + (ap.header === 'band' ? ' bspf__head--band bspf__head--' + esc(ap.tint || 'sky') : '');
      h += '<header class="' + headCls + '">';
      h += '<div class="bspf__head-copy">';
      if (cfg.form.title && cfg.form.showTitle !== false) h += '<h2 class="bspf__title">' + esc(cfg.form.title) + '</h2>';
      if (cfg.form.intro) h += '<p class="bspf__intro">' + prose(cfg.form.intro) + '</p>';
      h += '</div>';
      if (ap.icon) h += '<img class="bspf__head-icon" src="' + esc(resolveAsset(ap.icon)) + '" alt="">';
      h += '</header>';
    }

    // Body
    h += '<form class="bspf__body" x-show="view===\'form\'" novalidate @submit.prevent="nextOrSubmit()">';
    h += '<div class="bspf__content">';

    // Stepper
    if (pages.length > 1) {
      h += '<ol class="stepper bspf__stepper" aria-label="' + esc(fmtStr(S.stepOf, { n: '', total: pages.length })) + '">';
      pages.forEach(function (pg, i) {
        h += '<li class="stepper__step" :class="{ \'is-current\': page===' + i + ', \'is-done\': page>' + i + ', \'is-error\': pageHasError(' + i + ') }"' +
          ' @click="goTo(' + i + ')">' +
          '<span class="stepper__dot">' +
          '<span x-show="page>' + i + '" x-cloak>' + icon('ic-fluent-checkmark-24-regular', 12) + '</span>' +
          '<span x-show="page<=' + i + '">' + (i + 1) + '</span>' +
          '</span>' +
          '<span class="stepper__label">' + esc(pg.title || ('Step ' + (i + 1))) + '</span></li>';
      });
      h += '</ol>';
    }

    pages.forEach(function (pg, i) {
      h += '<div class="bspf-page" x-show="page===' + i + '"' + (i > 0 ? ' x-cloak' : '') + '>';
      if (pages.length > 1 && pg.title) h += '<h3 class="bspf-page__title">' + esc(pg.title) + '</h3>';
      if (pg.description) h += '<p class="bspf-page__desc">' + prose(pg.description) + '</p>';
      pg.sections.forEach(function (sec) {
        h += '<section class="bspf-section"';
        if (sec.visibleWhen) h += ' x-show="secVis(' + esc(jstr(sec.id)) + ')" x-cloak';
        h += '>';
        if (sec.icon && (sec.title || sec.description)) {
          // section head with a Fluent icon tile (sprite name, e.g. "person")
          h += '<div class="bspf-section__head">' +
            '<span class="bspf-section__tile">' + icon('ic-fluent-' + esc(sec.icon) + '-24-regular', 20) + '</span>' +
            '<div class="bspf-section__copy">';
          if (sec.title) h += '<h4 class="bspf-section__title">' + esc(sec.title) + '</h4>';
          if (sec.description) h += '<p class="bspf-section__desc">' + prose(sec.description) + '</p>';
          h += '</div></div>';
        } else {
          if (sec.title) h += '<h4 class="bspf-section__title">' + esc(sec.title) + '</h4>';
          if (sec.description) h += '<p class="bspf-section__desc">' + prose(sec.description) + '</p>';
        }
        h += '<div class="bspf-fields' + (sec.columns === 2 ? ' bspf-fields--2' : '') + '">';
        sec.fields.forEach(function (f) { h += renderField(f, S); });
        if (cfg.attachments.enabled && cfg.attachments.section === sec.id) h += renderAttachments(cfg, S, uid);
        h += '</div></section>';
      });
      if (cfg.attachments.enabled && cfg.attachments.section == null && cfg.attachments.page === i) {
        h += '<section class="bspf-section">' + renderAttachments(cfg, S, uid) + '</section>';
      }
      h += '</div>';
    });

    h += '<div class="msgbar msgbar--danger bspf__pageerror" role="alert" x-show="pageError" x-cloak>' +
      icon(ICONS.danger, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body" x-text="pageError"></div></div>';

    h += '</div>'; // .bspf__content

    h += '<div class="bspf-nav' + (card ? ' bspf-nav--foot' : '') + '">';
    h += '<button type="button" class="btn" x-show="page>0" x-cloak @click="prev()">' + esc(S.back) + '</button>';
    h += '<span class="bspf-nav__spacer"></span>';
    if (last > 0) h += '<button type="button" class="btn btn--primary" x-show="page<' + last + '" @click="next()">' + esc(S.next) + '</button>';
    h += '<button type="submit" class="btn btn--primary" x-show="page===' + last + '"' + (last > 0 ? ' x-cloak' : '') + ' :disabled="busy">' +
      '<span class="spinner spinner--16 spinner--on-accent" x-show="busy" x-cloak aria-hidden="true"></span>' +
      '<span x-text="busy ? ' + esc(jstr(S.submitting)) + ' : ' + esc(jstr(S.submit)) + '"></span></button>';
    h += '</div></form>';

    // Attachment-retry view (item saved, some uploads failed)
    h += '<div class="bspf__content" x-show="view===\'attachRetry\'" x-cloak><div class="bspf-page">' +
      '<div class="msgbar msgbar--warning" role="alert">' +
      icon(ICONS.warning, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body"><strong>' + esc(S.attachPartialTitle) + '</strong><br>' +
      '<span x-text="attachPartialMsg()"></span></div></div>' +
      '<div class="bspf-attach__list">' +
      '<template x-for="(fm, i) in filesMeta" :key="fm.uid">' +
      '<div class="bspf-attach__item" :class="{ \'is-failed\': fm.status===\'failed\', \'is-done\': fm.status===\'done\' }">' +
      icon('ic-fluent-document-24-regular', 20) +
      '<span class="bspf-attach__name" x-text="fm.name"></span>' +
      '<span class="bspf-attach__size" x-text="fm.status===\'done\' ? ' + esc(jstr(S.attachDone)) + ' : fm.sizeLabel"></span>' +
      '</div></template></div>' +
      '<div class="bspf-nav"><span class="bspf-nav__spacer"></span>' +
      '<button type="button" class="btn" @click="skipAttachments()">' + esc(S.attachSkip) + '</button>' +
      '<button type="button" class="btn btn--primary" :disabled="busy" @click="retryAttachments()">' +
      '<span class="spinner spinner--16 spinner--on-accent" x-show="busy" x-cloak aria-hidden="true"></span> ' + esc(S.attachRetry) + '</button>' +
      '</div></div></div>';

    // Prompt dialog (date-field prompts) — the design system's .scrim + .dialog
    if (cfg._ordered.some(function (f) { return f.prompt; })) {
      var dlgId = uid + '-dlg';
      h += '<div class="scrim bspf-dialog" x-show="dlg.open" x-cloak @keydown="dlgKey($event)">' +
        '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="' + esc(dlgId) + '-t"' +
        ' aria-describedby="' + esc(dlgId) + '-m" @click.stop>' +
        '<div class="dialog__head"><h2 class="dialog__title" id="' + esc(dlgId) + '-t" x-text="dlg.title"></h2></div>' +
        '<div class="dialog__body"><p class="bspf-dialog__msg" id="' + esc(dlgId) + '-m" x-html="dlg.html"></p></div>' +
        '<div class="dialog__foot">' +
        '<button type="button" class="btn bspf-dialog__alt" x-show="dlg.alt" @click="dlgAlt()" x-text="dlg.alt"></button>' +
        '<button type="button" class="btn btn--primary bspf-dialog__ok" @click="dlgConfirm()" x-text="dlg.ok"></button>' +
        '</div></div></div>';
    }

    // Result view (afterSubmit found/notFound, queryError). Everything dynamic
    // is x-text / :href; result.html is prose() output (escaped first).
    if (cfg.afterSubmit || cfg.queryError) {
      h += '<div class="bspf-done bspf-result" x-show="view===\'result\'" x-cloak aria-live="polite">';
      h += '<h2 class="bspf-done__title" x-show="result.title" x-text="result.title"></h2>';
      h += '<p class="bspf-done__msg" x-show="result.html" x-html="result.html"></p>';
      h += '<a class="bspf-result__link" x-show="result.href" :href="result.href">' +
        '<span x-text="result.linkText"></span>' + icon('ic-fluent-arrow-right-24-regular', 20) + '</a>';
      h += '<div class="bspf-result__copy" x-show="result.copyFailed" x-cloak>' +
        '<p class="bspf-done__msg">' + esc(S.copyBlocked) + '</p>' +
        '<div class="bspf-result__copyrow"><input class="input" readonly :value="result.copyText" aria-label="' + esc(S.copyLabel) + '" @focus="$event.target.select()">' +
        '<button type="button" class="btn btn--primary" @click="copyAgain()">' + esc(S.copyButton) + '</button></div></div>';
      h += '<p class="bspf-result__count" x-show="redir.url" x-cloak>' +
        '<span x-text="countdownText()"></span> <a :href="redir.url">' + esc(S.redirectNow) + '</a></p>';
      h += '</div>';
    }

    // Confirmation view
    h += '<div class="bspf-done" x-show="view===\'done\'" x-cloak>';
    if (cfg.confirmation.illustration) {
      h += '<img class="bspf-done__art" src="' + esc(resolveAsset(cfg.confirmation.illustration)) + '" alt="">';
    } else {
      h += '<svg class="icon icon--48 bspf-done__icon" aria-hidden="true"><use href="#ic-fluent-checkmark-circle-24-filled"/></svg>';
    }
    h += '<h2 class="bspf-done__title">' + esc(cfg.confirmation.title || S.confirmTitle) + '</h2>';
    var cMsg = cfg.confirmation.message || S.confirmMessage;
    if (cMsg) h += '<p class="bspf-done__msg">' + prose(cMsg) + '</p>';
    if (cfg.confirmation.allowAnother !== false) {
      h += '<button type="button" class="btn btn--secondary" @click="resetForm()">' + esc(cfg.confirmation.anotherLabel || S.confirmAnother) + '</button>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  /* ------------------------------------------------------------------
     Instance state factory — Alpine evaluates
     x-data="BSPForms.instance('<uid>')" on the generated root.
     ------------------------------------------------------------------ */
  NS.instance = function (uid) {
    var def = NS._defs[uid];
    if (!def) return {};
    var cfg = def.cfg, S = cfg.strings, adapter = def.adapter, store = def.store;

    function defaultValue(f) {
      if (f.query) {
        // URL value wins; "Submit another" resets back to it (defaultsSnapshot)
        var q = readQuery(f.query);
        if (q !== null) return normalizeVal(q, f.normalize);
      }
      switch (f.type) {
        case 'multichoice': return Array.isArray(f.default) ? f.default.slice() : [];
        case 'person': return [];
        case 'boolean': return !!f.default;
        case 'link': return { url: (f.default && f.default.url) || '', desc: (f.default && f.default.desc) || '' };
        case 'lookup': return null;
        case 'number': case 'currency': return (f.default != null ? f.default : '');
        default: return (f.default != null ? String(f.default) : '');
      }
    }

    var values = {}, errors = {}, warnings = {}, touched = {}, ui = {}, fill = {};
    var pq = {}, pRes = {}, pBusy = {}, pOpen = {}, pIdx = {};
    var lkOpts = {}, lkBusy = {}, lkErr = {};
    cfg._ordered.forEach(function (f) {
      if (f.type === 'heading' || f.type === 'note') return;
      values[f.k] = defaultValue(f);
      errors[f.k] = ''; warnings[f.k] = ''; touched[f.k] = false;
      if (f.type === 'choice' || f.type === 'multichoice' || f.type === 'lookup') { ui[f.k] = false; fill[f.k] = ''; }
      if (f.type === 'person') { pq[f.k] = ''; pRes[f.k] = []; pBusy[f.k] = false; pOpen[f.k] = false; pIdx[f.k] = -1; }
      if (f.type === 'lookup') { lkOpts[f.k] = []; lkBusy[f.k] = false; lkErr[f.k] = ''; }
    });
    errors._attachments = '';
    var defaultsSnapshot = JSON.parse(JSON.stringify(values));

    return {
      view: 'form', page: 0, busy: false,
      values: values, errors: errors, warnings: warnings, touched: touched,
      ui: ui, fill: fill,
      pq: pq, pRes: pRes, pBusy: pBusy, pOpen: pOpen, pIdx: pIdx,
      lkOpts: lkOpts, lkBusy: lkBusy, lkErr: lkErr,
      photoFail: {},
      filesMeta: [], dragging: false,
      pageError: '',
      // date prompt dialog; promptAck[k] = the value the user already answered for
      dlg: { open: false, k: null, title: '', html: '', ok: '', alt: '' },
      promptAck: {},
      // result screen (afterSubmit / queryError) + its optional countdown redirect
      result: { title: '', html: '', href: '', linkText: '', lookup: '', copyText: '', copyFailed: false, copied: false },
      redir: { url: '', left: 0, paused: false },

      init: function () {
        store.state = this;
        // begin loading pnp + resolving the page web in the background so
        // submit/search are warm
        if (!adapter.isMock) adapter.ready().catch(function () { /* surfaced on use */ });
        // a required/invalid URL value (field.query) can't be fixed by the
        // user: show queryError instead of the form
        var self = this;
        if (cfg.queryError && cfg._ordered.some(function (f) { return f.query && !self.check(f.k); })) {
          this.view = 'result';
          this.showResult(cfg.queryError);
        }
      },

      /* ---- result screens: afterSubmit found/notFound, queryError ---- */
      showResult: function (spec, href) {
        var self = this;
        this.result.title = this.renderTemplate(spec.title || '');
        this.result.html = prose(this.renderTemplate(spec.message || ''));
        this.result.href = href || '';
        this.result.linkText = href ? (this.renderTemplate((spec.link && spec.link.text) || '') || href) : '';
        this.result.copyText = spec.copy ? this.renderTemplate(spec.copy) : '';
        this.result.copyFailed = false; this.result.copied = false;
        var go = spec.redirect ? safeHref(this.renderTemplate(spec.redirect.url)) : '';
        if (spec.redirect && !go) console.warn('[BSP Forms] redirect skipped: not an http(s) or server-relative URL');
        var secs = spec.redirect ? Math.max(0, Math.min(60, Math.round(+this.renderTemplate(String(spec.redirect.seconds == null ? 5 : spec.redirect.seconds))) || 0)) : 0;
        var copied = this.result.copyText ? this.copyText(this.result.copyText) : Promise.resolve(true);
        return copied.then(function (ok) {
          self.result.copied = ok && !!self.result.copyText;
          // a blocked copy pauses the countdown until the user copies by hand
          self.result.copyFailed = !ok;
          if (go) self.startRedirect(go, secs, !ok);
        });
      },
      copyText: function (text) {
        function legacy() {
          try {
            var ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', '');
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            var ok = document.execCommand('copy');
            ta.remove();
            return ok;
          } catch (e) { return false; }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
        }
        return Promise.resolve(legacy());
      },
      copyAgain: function () {
        // runs inside a click, so the browser allows it
        var self = this;
        this.copyText(this.result.copyText).then(function (ok) {
          self.result.copied = ok;
          if (ok) { self.result.copyFailed = false; self.redir.paused = false; }
        });
      },
      startRedirect: function (url, secs, paused) {
        var self = this;
        this.redir.url = url; this.redir.left = secs; this.redir.paused = !!paused;
        if (store.redirTimer) clearInterval(store.redirTimer);
        store.redirTimer = setInterval(function () {
          if (self.redir.paused) return;
          if (self.redir.left > 0) { self.redir.left--; return; }
          clearInterval(store.redirTimer); store.redirTimer = null;
          window.location.assign(self.redir.url);
        }, 1000);
      },
      countdownText: function () {
        return this.redir.paused ? S.redirectPaused : fmtStr(S.redirectCountdown, { n: this.redir.left });
      },
      runAfterSubmit: function () {
        var self = this, as = cfg.afterSubmit, lk = as.lookup;
        var v = lk ? String(this._get(lk.matchField) == null ? '' : this._get(lk.matchField)).trim() : '';
        var found = (lk && v)
          ? adapter.lookupValue({ siteUrl: lk.siteUrl, listUrl: lk.listUrl, listTitle: lk.listTitle,
            matchColumn: lk.matchColumn, returnColumn: lk.returnColumn, value: v })
            .catch(function (e) { console.warn('[BSP Forms] lookup failed:', e); return null; })
          : Promise.resolve(null);
        return found.then(function (url) {
          var href = safeHref(url);
          self.result.lookup = href;
          self.view = 'result';
          self.scrollTop();
          return href && as.found ? self.showResult(as.found, href) : self.showResult(as.notFound || {});
        });
      },

      /* ---- visibility ---- */
      _get: function (fieldId) {
        var k = cfg._keyOfId[fieldId];
        return k ? this.values[k] : undefined;
      },
      vis: function (k) {
        var f = cfg._byKey[k];
        if (!f || !f.visibleWhen) return true;
        var self = this;
        return evalRule(f.visibleWhen, function (id) { return self._get(id); }, cfg._bh);
      },
      secVis: function (secId) {
        var sec = cfg._sectionsById[secId];
        if (!sec || !sec.visibleWhen) return true;
        var self = this;
        return evalRule(sec.visibleWhen, function (id) { return self._get(id); }, cfg._bh);
      },
      fieldActive: function (f) {
        // a field counts (validation + submit) only when it and its section are visible
        if (!this.vis(f.k)) return false;
        return this.secVis(f.section);
      },

      /* ---- locks (lockWhen) + date prompts ---- */
      locked: function (k) {
        var f = cfg._byKey[k];
        if (!f || !f.lockWhen) return false;
        var self = this;
        return evalRule(f.lockWhen, function (id) { return self._get(id); }, cfg._bh);
      },
      applyLocks: function () {
        var self = this;
        cfg._ordered.forEach(function (f) {
          if (f.lockWhen && self.locked(f.k) && self.values[f.k] !== f.lockValue) self.values[f.k] = f.lockValue;
        });
      },
      dateChanged: function (k) {
        this.touched[k] = true;
        this.check(k);
        // an open prompt decides first (OK applies the locks, Change moves
        // the date out of the window); only otherwise enforce locks now
        if (!this.maybePrompt(k)) this.applyLocks();
      },
      promptDue: function (k) {
        var f = cfg._byKey[k];
        if (!f || !f.prompt || !cfg._bh || !this.fieldActive(f)) return false;
        var v = this.values[k];
        // only real, not-past dates: typing a year digit by digit passes
        // through dates like 0202-10-07, which must never open the dialog
        if (!v || String(v).slice(0, 10) < bizToday(cfg._bh, nowMs())) return false;
        if (this.promptAck[k] === v) return false;
        return bizWithin(cfg._bh, v, +f.prompt.withinBusinessDays, nowMs());
      },
      maybePrompt: function (k) {
        if (!this.promptDue(k)) return false;
        var pr = cfg._byKey[k].prompt;
        this.dlg.k = k;
        this.dlg.title = pr.title || S.promptTitle;
        this.dlg.html = prose(pr.message);
        this.dlg.ok = (pr.confirm && pr.confirm.label) || S.promptOk;
        this.dlg.alt = (pr.alternative && pr.alternative.label) || '';
        this.dlg.open = true;
        var root = this.$root;
        // after x-show has revealed the sheet (a hidden button can't take focus)
        this.$nextTick(function () {
          requestAnimationFrame(function () {
            var ok = root.querySelector('.bspf-dialog__ok');
            if (ok) ok.focus();
          });
        });
        return true;
      },
      dlgClose: function () {
        var k = this.dlg.k;
        this.dlg.open = false; this.dlg.k = null;
        var f = cfg._byKey[k];
        var inp = f && document.getElementById(f.domId);
        if (inp) this.$nextTick(function () { inp.focus(); });
      },
      dlgConfirm: function () {
        // keep the date; apply confirm.set (e.g. mark the request urgent)
        var self = this, k = this.dlg.k, pr = cfg._byKey[k].prompt;
        this.promptAck[k] = this.values[k];
        var set = (pr.confirm && pr.confirm.set) || {};
        Object.keys(set).forEach(function (id) {
          var tk = cfg._keyOfId[id];
          if (tk) { self.values[tk] = set[id]; self.check(tk); }
        });
        this.applyLocks();
        this.dlgClose();
      },
      dlgAlt: function () {
        // move the date to the first one at least N business days out
        var k = this.dlg.k, f = cfg._byKey[k];
        var d = bizDateAfter(cfg._bh, +f.prompt.alternative.moveToBusinessDays, nowMs());
        if (d) {
          if (f.includeTime) {
            var m = cfg._bh.dateAt === 'start' ? cfg._bh._start : cfg._bh._end;
            d += 'T' + ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
          }
          this.values[k] = d;
          this.promptAck[k] = d;
          this.check(k);
          this.applyLocks();
        }
        this.dlgClose();
      },
      dlgKey: function (e) {
        if (e.key === 'Escape') { e.preventDefault(); this.dlgConfirm(); return; }
        if (e.key !== 'Tab') return;
        // keep focus inside the dialog (two buttons)
        var btns = Array.prototype.filter.call(this.$root.querySelectorAll('.bspf-dialog .btn'),
          function (b) { return b.offsetParent !== null; });
        if (!btns.length) return;
        var i = btns.indexOf(document.activeElement);
        var n = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i === btns.length - 1 ? 0 : i + 1);
        e.preventDefault();
        btns[n].focus();
      },
      // a prompt not yet answered on page i (or anywhere when i is null)
      pendingPrompt: function (i) {
        var self = this;
        var f = cfg._ordered.filter(function (x) { return x.prompt && (i == null || x.page === i) && self.promptDue(x.k); })[0];
        return f ? f.k : null;
      },

      /* ---- interaction helpers ---- */
      touch: function (k) { this.touched[k] = true; this.check(k); },
      reval: function (k) {
        // live re-validation once a field already shows an error, so the
        // message clears while typing instead of collapsing layout at blur
        var self = this;
        this.$nextTick(function () { if (self.errors[k]) self.check(k); });
      },
      isCustom: function (k) {
        var f = cfg._byKey[k];
        var v = this.values[k];
        return !!v && !(f.choices || []).some(function (c) { return c.value === v; });
      },
      customSel: function (k) {
        var f = cfg._byKey[k];
        return (this.values[k] || []).filter(function (v) {
          return !(f.choices || []).some(function (c) { return c.value === v; });
        });
      },
      pickChoice: function (k, v) {
        this.values[k] = (this.values[k] === v) ? '' : v;
        this.ui[k] = false; this.touched[k] = true; this.check(k);
      },
      pickFill: function (k) {
        var v = (this.fill[k] || '').trim();
        if (!v) return;
        this.values[k] = v; this.fill[k] = ''; this.ui[k] = false;
        this.touched[k] = true; this.check(k);
      },
      toggleMulti: function (k, v) {
        var arr = this.values[k];
        var i = arr.indexOf(v);
        if (i > -1) arr.splice(i, 1); else arr.push(v);
        this.touched[k] = true; this.check(k);
      },
      pickFillMulti: function (k) {
        var v = (this.fill[k] || '').trim();
        if (!v) return;
        if (this.values[k].indexOf(v) < 0) this.values[k].push(v);
        this.fill[k] = '';
        this.touched[k] = true; this.check(k);
      },

      /* ---- lookup ---- */
      openLookup: function (k) {
        this.ui[k] = !this.ui[k];
        if (!this.ui[k] || this.lkOpts[k].length || this.lkBusy[k]) return;
        var f = cfg._byKey[k], self = this;
        self.lkBusy[k] = true; self.lkErr[k] = '';
        adapter.getLookupItems(f.lookup).then(function (opts) {
          self.lkOpts[k] = opts;
        }).catch(function (e) {
          console.warn('[BSP Forms] lookup load failed:', e);
          self.lkErr[k] = S.lookupError;
        }).finally(function () { self.lkBusy[k] = false; });
      },
      pickLookup: function (k, opt) {
        var cur = this.values[k];
        this.values[k] = (cur && cur.id === opt.id) ? null : { id: opt.id, text: opt.text };
        this.ui[k] = false; this.touched[k] = true; this.check(k);
      },

      /* ---- people ---- */
      canAddPerson: function (k) {
        var f = cfg._byKey[k];
        var n = this.values[k].length;
        if (!f.multiple) return n < 1;
        var max = f.validation.maxPeople;
        return !max || n < max;
      },
      focusPeople: function (k) {
        var inp = document.getElementById(cfg._byKey[k].domId);
        if (inp) inp.focus();
        this.pOpen[k] = true;
      },
      searchPeople: function (k) {
        var self = this;
        var q = (this.pq[k] || '').trim();
        if (q.length < 2) { this.pRes[k] = []; this.pBusy[k] = false; return; }
        var seq = (store.pSeq[k] = (store.pSeq[k] || 0) + 1);
        this.pBusy[k] = true; this.pOpen[k] = true;
        adapter.searchPeople(q, 8).then(function (res) {
          if (store.pSeq[k] !== seq) return; // stale
          var chosen = self.values[k].map(function (p) { return p.key; });
          self.pRes[k] = res.filter(function (r) { return chosen.indexOf(r.key) < 0; });
          self.pIdx[k] = self.pRes[k].length ? 0 : -1;
        }).catch(function (e) {
          if (store.pSeq[k] !== seq) return;
          console.warn('[BSP Forms] people search failed:', e);
          self.pRes[k] = [];
        }).finally(function () {
          if (store.pSeq[k] === seq) self.pBusy[k] = false;
        });
      },
      addPerson: function (k, s) {
        if (!this.canAddPerson(k)) return;
        this.values[k].push({ key: s.key, text: s.text, email: s.email, id: s.id || null });
        this.pq[k] = ''; this.pRes[k] = []; this.pIdx[k] = -1; this.pOpen[k] = false;
        this.touched[k] = true; this.check(k);
        // resolve the user id in the background so submit is fast + early-fails
        var self = this;
        adapter.ensureUser(s.key).then(function (id) {
          self.values[k].forEach(function (p) { if (p.key === s.key) p.id = id; });
        }).catch(function (e) { console.warn('[BSP Forms] ensureUser deferred to submit:', e); });
      },
      removePerson: function (k, i) {
        this.values[k].splice(i, 1);
        this.touched[k] = true; this.check(k);
      },
      maybePopPerson: function (k, ev) {
        if ((this.pq[k] || '').length === 0 && this.values[k].length) {
          ev.preventDefault();
          this.values[k].pop();
          this.check(k);
        }
      },
      pMove: function (k, d) {
        var n = this.pRes[k].length;
        if (!n) return;
        this.pIdx[k] = ((this.pIdx[k] + d) % n + n) % n;
      },
      pickActive: function (k) {
        var i = this.pIdx[k];
        if (i > -1 && this.pRes[k][i]) this.addPerson(k, this.pRes[k][i]);
      },
      photoUrl: function (p) {
        if (adapter.photoUrl) return adapter.photoUrl(p);
        var base = adapter.webUrl && adapter.webUrl();
        var origin = base || location.origin;
        return origin + '/_layouts/15/userphoto.aspx?size=S&accountname=' + encodeURIComponent(p.email || p.key);
      },
      initials: function (name) {
        var parts = String(name || '').trim().split(/\s+/);
        var a = parts[0] ? parts[0][0] : '', b = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (a + b).toUpperCase() || '?';
      },

      /* ---- attachments ---- */
      pickFiles: function (ev) { this.addFiles(ev.target.files); ev.target.value = ''; },
      dropFiles: function (ev) { this.dragging = false; this.addFiles(ev.dataTransfer && ev.dataTransfer.files); },
      addFiles: function (fileList) {
        if (!fileList || !fileList.length) return;
        var a = cfg.attachments, self = this;
        var err = '';
        Array.prototype.forEach.call(fileList, function (file) {
          if (err) return;
          if (self.filesMeta.length >= a.maxFiles) { err = fmtStr(S.attachTooMany, { max: a.maxFiles }); return; }
          if (file.size > a.maxFileSizeMb * 1048576) { err = fmtStr(S.attachTooLarge, { name: file.name, max: a.maxFileSizeMb }); return; }
          if (a.accept && a.accept.length) {
            var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
            var ok = a.accept.some(function (x) { return x.toLowerCase() === ext; });
            if (!ok) { err = fmtStr(S.attachBadType, { name: file.name, types: a.accept.join(', ') }); return; }
          }
          var name = sanitizeFileName(file.name, self.filesMeta.map(function (m) { return m.name; }));
          var fuid = 'af' + (++store.fileSeq);
          store.files[fuid] = file;
          self.filesMeta.push({ uid: fuid, name: name, size: file.size, sizeLabel: fmtSize(file.size), status: 'pending' });
        });
        this.errors._attachments = err;
        if (!err && a.required && this.filesMeta.length) this.errors._attachments = '';
      },
      removeFile: function (i) {
        var fm = this.filesMeta[i];
        if (!fm) return;
        delete store.files[fm.uid];
        this.filesMeta.splice(i, 1);
        if (this.errors._attachments) this.errors._attachments = '';
      },

      /* ---- validation ---- */
      check: function (k) {
        var f = cfg._byKey[k];
        if (!f) return true;
        if (!this.fieldActive(f)) { this.errors[k] = ''; this.warnings[k] = ''; return true; }
        var v = this.values[k];
        var msg = '', warn = '';
        var val = f.validation || {};

        var empty = isEmptyVal(v) || (f.type === 'link' && !v.url) || (f.type === 'boolean' && !v);
        if (f.required && empty) {
          msg = (f.type === 'choice' || f.type === 'multichoice' || f.type === 'lookup') ? S.choiceRequired
            : (f.type === 'person') ? S.personRequired
              : S.requiredField;
        } else if (!empty) {
          switch (f.type) {
            case 'email':
              if (!EMAIL_RE.test(v)) msg = S.invalidEmail; break;
            case 'phone':
              if (!validPhone(v)) msg = S.invalidPhone; break;
            case 'text': case 'textarea': case 'hidden':
              if (val.minLength && v.length < val.minLength) msg = fmtStr(S.textMinLength, { min: val.minLength });
              else if (val.maxLength && v.length > val.maxLength) msg = fmtStr(S.textMaxLength, { max: val.maxLength });
              else if (val.url && !validUrl(v)) msg = S.invalidUrl;
              else if (f._pattern && !f._pattern.test(v)) {
                msg = val.patternMessage || S.patternMismatch;
              }
              break;
            case 'number': case 'currency':
              if (typeof v !== 'number' || isNaN(v)) msg = S.invalidNumber;
              else if (val.integer && v % 1 !== 0) msg = S.numberInteger;
              else if (val.min != null && v < val.min) msg = fmtStr(S.numberMin, { min: val.min });
              else if (val.max != null && v > val.max) msg = fmtStr(S.numberMax, { max: val.max });
              break;
            case 'multichoice':
              if (val.minChoices && v.length < val.minChoices) msg = fmtStr(S.multiMin, { min: val.minChoices });
              else if (val.maxChoices && v.length > val.maxChoices) msg = fmtStr(S.multiMax, { max: val.maxChoices });
              break;
            case 'person':
              if (val.maxPeople && v.length > val.maxPeople) msg = fmtStr(S.personMax, { max: val.maxPeople });
              break;
            case 'link':
              if (!validUrl(v.url)) msg = S.invalidUrl;
              break;
            case 'date': {
              var self = this;
              (f.rules || []).forEach(function (r) {
                if (msg) return;
                var mine = parseDateVal(v);
                var base = r.compareTo === '@today' ? today0() : parseDateVal(self._get(r.compareTo));
                var ok = evalDateOp(r.op, mine, base, r.days);
                if (ok === null || ok) return;
                var otherLabel = r.compareTo === '@today'
                  ? S.todayLabel + (r.days ? ' + ' + r.days + 'd' : '')
                  : ((cfg._byKey[cfg._keyOfId[r.compareTo]] || {}).label || r.compareTo) + (r.days ? ' + ' + r.days + 'd' : '');
                var dflt = r.op === 'after' ? S.dateAfter : r.op === 'onOrAfter' ? S.dateOnOrAfter
                  : r.op === 'before' ? S.dateBefore : S.dateOnOrBefore;
                var text = r.message || fmtStr(dflt, { other: otherLabel, days: r.days || 0 });
                if ((r.mode || 'block') === 'warn') { if (!warn) warn = text; }
                else msg = text;
              });
              break;
            }
          }
        }
        this.errors[k] = msg;
        this.warnings[k] = warn;
        return !msg;
      },
      pageFieldKeys: function (i) {
        var self = this, keys = [];
        cfg._ordered.forEach(function (f) {
          if (f.page !== i || f.type === 'heading' || f.type === 'note') return;
          if (!self.fieldActive(f)) return;
          keys.push(f.k);
        });
        return keys;
      },
      validatePage: function (i) {
        var self = this, ok = true;
        this.pageFieldKeys(i).forEach(function (k) {
          self.touched[k] = true;
          if (!self.check(k)) ok = false;
        });
        if (cfg.attachments.enabled && cfg.attachments.page === i) {
          if (cfg.attachments.required && !this.filesMeta.length) {
            this.errors._attachments = S.attachRequired; ok = false;
          }
        }
        return ok;
      },
      pageHasError: function (i) {
        var self = this;
        var bad = this.pageFieldKeys(i).some(function (k) { return !!self.errors[k]; });
        if (!bad && cfg.attachments.enabled && cfg.attachments.page === i) bad = !!this.errors._attachments;
        return bad;
      },

      /* ---- navigation ---- */
      next: function () {
        var pk = this.pendingPrompt(this.page);
        if (pk) { this.maybePrompt(pk); return; }
        if (!this.validatePage(this.page)) { this.pageError = S.pageError; this.focusFirstError(); return; }
        this.pageError = '';
        this.page++;
        this.scrollTop();
      },
      prev: function () { this.pageError = ''; this.page--; this.scrollTop(); },
      goTo: function (i) { if (i < this.page) { this.pageError = ''; this.page = i; this.scrollTop(); } },
      nextOrSubmit: function () {
        if (this.page < cfg.pages.length - 1) this.next(); else this.submitForm();
      },
      scrollTop: function () {
        var root = def.mount;
        if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
      },
      focusFirstError: function () {
        var self = this;
        var k = this.pageFieldKeys(this.page).filter(function (x) { return self.errors[x]; })[0];
        if (!k) return;
        var elx = document.getElementById(cfg._byKey[k].domId);
        if (elx && elx.focus) elx.focus();
      },

      /* ---- submit pipeline ---- */
      attachPartialMsg: function () {
        var n = this.filesMeta.filter(function (m) { return m.status !== 'done'; }).length;
        return fmtStr(S.attachPartial, { n: n });
      },
      buildPayload: function () {
        var self = this;
        var payload = {};
        var titleMapped = false;
        // dev aid: a shared column should have at most one visible field
        cfg._sharedColumns.forEach(function (col) {
          var visIds = (cfg._colFields[col] || []).filter(function (id) {
            var f = cfg._byKey[cfg._keyOfId[id]];
            return f && self.fieldActive(f);
          });
          if (visIds.length > 1) {
            console.warn('[BSP Forms] shared column "' + col + '": ' + visIds.length +
              ' fields visible at once (' + visIds.join(', ') + ') — the later field wins.');
          }
        });
        return Promise.all(cfg._ordered.map(function (f) {
          if (!f.column || !self.fieldActive(f)) return null;
          if (f.type === 'person') {
            // resolve any unresolved ids now
            return Promise.all(self.values[f.k].map(function (p) {
              if (p.id) return p.id;
              return adapter.ensureUser(p.key).then(function (id) { p.id = id; return id; })
                .catch(function () { throw new Error(fmtStr(S.personResolveFailed, { name: p.text })); });
            }));
          }
          return null;
        })).then(function () {
          cfg._ordered.forEach(function (f) {
            if (!f.column || !self.fieldActive(f)) return;
            var v = self.values[f.k];
            var out;
            switch (f.type) {
              case 'text': case 'email': case 'phone': case 'choice': case 'hidden':
                if (v === '') return; out = v; break;
              case 'textarea':
                if (v === '') return; out = f.richText ? toRichText(v) : v; break;
              case 'number': case 'currency':
                if (v === '' || v == null || (typeof v === 'number' && isNaN(v))) return; out = Number(v); break;
              case 'boolean': out = f.values ? (v ? f.values.on : f.values.off) : !!v; break;
              case 'multichoice':
                if (!v.length) return; out = { results: v.slice() }; break;
              case 'date': {
                var d = parseDateVal(v);
                if (!d) return;
                if (f.includeTime) {
                  var t = new Date(v);
                  out = isNaN(t.getTime()) ? null : t.toISOString();
                } else {
                  out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();
                }
                if (!out) return;
                break;
              }
              case 'person': {
                var ids = v.map(function (p) { return p.id; }).filter(Boolean);
                if (!ids.length) return;
                if (f.multiple) payload[f.column + 'Id'] = { results: ids };
                else payload[f.column + 'Id'] = ids[0];
                if (f.column === 'Title') titleMapped = true;
                return;
              }
              case 'lookup':
                if (!v || !v.id) return;
                payload[f.column + 'Id'] = v.id;
                return;
              case 'link':
                if (!v.url) return;
                out = { Url: v.url, Description: v.desc || v.url };
                break;
              default: return;
            }
            payload[f.column] = out;   // duplicate column mappings: later fields win
            if (f.column === 'Title') titleMapped = true;
          });
          if (!titleMapped && cfg.target.titleTemplate) {
            payload.Title = self.renderTemplate(cfg.target.titleTemplate);
          }
          return payload;
        });
      },
      renderTemplate: function (tpl) {
        var self = this;
        var u = adapter.userInfo ? adapter.userInfo() : {};
        var now = new Date();
        return String(tpl).replace(/\{(form:title|user:name|user:email|date|time|lookup|field:[^}]+|var:[^}]+)\}/g, function (m, tok) {
          if (tok === 'form:title') return cfg.form.title || '';
          if (tok === 'lookup') return self.result.lookup || '';
          if (tok.indexOf('var:') === 0) {
            var vars = cfg.form.vars || {};
            return Object.prototype.hasOwnProperty.call(vars, tok.slice(4)) && vars[tok.slice(4)] != null ? String(vars[tok.slice(4)]) : '';
          }
          if (tok === 'user:name') return u.name || '';
          if (tok === 'user:email') return u.email || '';
          if (tok === 'date') return now.toLocaleDateString();
          if (tok === 'time') return now.toLocaleTimeString();
          if (tok.indexOf('field:') === 0) {
            var v = self._get(tok.slice(6));
            if (Array.isArray(v)) return v.map(function (p) { return p && p.text ? p.text : p; }).join(', ');
            if (v && typeof v === 'object') return v.text || v.url || '';
            return v == null ? '' : String(v);
          }
          return m;
        });
      },
      validateAll: function () {
        for (var i = 0; i < cfg.pages.length; i++) {
          if (!this.validatePage(i)) { this.page = i; this.pageError = S.pageError; this.focusFirstError(); return false; }
        }
        this.pageError = '';
        return true;
      },
      submitForm: function () {
        var self = this;
        if (this.busy) return;
        // an unanswered date prompt (e.g. the form sat open overnight) is
        // asked first; the user then submits again
        var pk = this.pendingPrompt(null);
        if (pk) { this.maybePrompt(pk); return; }
        this.applyLocks();
        if (!this.validateAll()) return;
        this.busy = true; this.pageError = '';
        adapter.ready().then(function () {
          if (store.itemId) return null; // already created — only attachments remain
          return self.buildPayload().then(function (payload) {
            return adapter.addItem(payload).then(function (r) {
              store.itemId = r.id; store.itemRef = r.item;
            });
          });
        }).then(function () {
          return self.uploadAttachments();
        }).then(function (allOk) {
          if (cfg.afterSubmit && allOk) return self.runAfterSubmit();
          self.view = allOk ? 'done' : 'attachRetry';
          self.scrollTop();
        }).catch(function (e) {
          if (cfg.afterSubmit && cfg.afterSubmit.continueOnSaveError) {
            // the save is a by-product here; the user still gets their result
            console.warn('[BSP Forms] save failed, continuing (afterSubmit.continueOnSaveError):', e);
            return self.runAfterSubmit();
          }
          console.error('[BSP Forms] submit failed:', e);
          self.pageError = (e && e.message === 'no-context')
            ? S.noContext
            : S.submitFailed + (e && e.message ? ' ' + fmtStr(S.submitFailedDetail, { detail: trimErr(e.message) }) : '');
        }).finally(function () { self.busy = false; });
      },
      uploadAttachments: function () {
        var self = this;
        var pending = this.filesMeta.filter(function (m) { return m.status !== 'done'; });
        if (!pending.length) return Promise.resolve(true);
        var chain = Promise.resolve();
        pending.forEach(function (fm) {
          chain = chain.then(function () {
            var file = store.files[fm.uid];
            if (!file) { fm.status = 'done'; return; }
            return adapter.addAttachment(store.itemRef, fm.name, file)
              .then(function () { fm.status = 'done'; })
              .catch(function (e) { console.warn('[BSP Forms] attachment failed:', fm.name, e); fm.status = 'failed'; });
          });
        });
        return chain.then(function () {
          return self.filesMeta.every(function (m) { return m.status === 'done'; });
        });
      },
      retryAttachments: function () {
        var self = this;
        if (this.busy) return;
        this.busy = true;
        this.uploadAttachments().then(function (allOk) {
          if (allOk) {
            if (cfg.afterSubmit) return self.runAfterSubmit();
            self.view = 'done'; self.scrollTop();
          }
        }).finally(function () { self.busy = false; });
      },
      skipAttachments: function () {
        if (cfg.afterSubmit) { this.runAfterSubmit(); return; }
        this.view = 'done'; this.scrollTop();
      },
      resetForm: function () {
        var self = this;
        Object.keys(defaultsSnapshot).forEach(function (k) {
          self.values[k] = JSON.parse(JSON.stringify(defaultsSnapshot[k]));
        });
        Object.keys(this.errors).forEach(function (k) { self.errors[k] = ''; });
        Object.keys(this.warnings).forEach(function (k) { self.warnings[k] = ''; });
        Object.keys(this.touched).forEach(function (k) { self.touched[k] = false; });
        this.filesMeta = [];
        store.files = {}; store.itemId = null; store.itemRef = null;
        this.promptAck = {}; this.dlg.open = false; this.dlg.k = null;
        this.page = 0; this.pageError = ''; this.view = 'form';
        this.scrollTop();
      }
    };
  };

  function trimErr(msg) {
    var s = String(msg || '').replace(/\s+/g, ' ').trim();
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  }
  function sanitizeFileName(name, taken) {
    var n = String(name || 'file')
      .replace(/[~"#%&*:<>?/\\{|}]/g, '-')
      .replace(/^[\s.]+|[\s.]+$/g, '');
    if (!n) n = 'file';
    if (taken.indexOf(n) < 0) return n;
    var dot = n.lastIndexOf('.');
    var stem = dot > 0 ? n.slice(0, dot) : n;
    var ext = dot > 0 ? n.slice(dot) : '';
    var i = 2;
    while (taken.indexOf(stem + ' (' + i + ')' + ext) > -1) i++;
    return stem + ' (' + i + ')' + ext;
  }

  /* ------------------------------------------------------------------
     Doctor — config-vs-list validation report (opt-in per mount via the
     data-validate attribute, or BSPForms.validate(mountEl) from devtools).
     ------------------------------------------------------------------ */
  var TYPE_COMPAT = {
    text: { ok: ['Text'], warn: ['Note'] },
    email: { ok: ['Text'], warn: ['Note'] },
    phone: { ok: ['Text'], warn: ['Note'] },
    textarea: { ok: ['Note'], warn: ['Text'] },
    number: { ok: ['Number'], warn: ['Currency', 'Text'] },
    currency: { ok: ['Currency'], warn: ['Number'] },
    choice: { ok: ['Choice'], warn: ['Text'] },
    multichoice: { ok: ['MultiChoice'], warn: [] },
    boolean: { ok: ['Boolean'], warn: [] },
    date: { ok: ['DateTime'], warn: [] },
    link: { ok: ['URL'], warn: [] },
    lookup: { ok: ['Lookup'], warn: [] },
    hidden: { ok: ['Text', 'Choice', 'Note'], warn: ['URL'] },
    person: null // handled specially: User vs UserMulti
  };

  function runDoctor(def) {
    var cfg = def.cfg, S = cfg.strings;
    return def.adapter.ready().then(function () {
      return def.adapter.getListFields();
    }).then(function (fields) {
      var byName = {};
      (fields || []).forEach(function (fd) { byName[fd.InternalName] = fd; });
      var rows = [];
      cfg._ordered.forEach(function (f) {
        if (!f.column) return;
        var fd = byName[f.column];
        if (!fd) { rows.push({ field: f.id, column: f.column, expected: expectedLabel(f), actual: '— (missing)', level: 'error' }); return; }
        var actual = fd.TypeAsString;
        var level;
        if (f.type === 'person') {
          level = f.multiple
            ? (actual === 'UserMulti' ? 'ok' : 'error')
            : (actual === 'User' ? 'ok' : (actual === 'UserMulti' ? 'warn' : 'error'));
        } else {
          var c = TYPE_COMPAT[compatType(f)];
          level = c && c.ok.indexOf(actual) > -1 ? 'ok' : (c && c.warn.indexOf(actual) > -1 ? 'warn' : 'error');
        }
        if (fd.ReadOnlyField) level = 'error';
        // RichText is only returned for Note columns
        if (f.type === 'textarea' && actual === 'Note' && level === 'ok' && !!fd.RichText !== !!f.richText) {
          level = 'warn';
          actual += fd.RichText ? ' (rich text: set "richText": true or line breaks collapse)'
            : ' (plain text: remove "richText" or the HTML tags show)';
        }
        rows.push({
          field: f.id,
          column: f.column + (cfg._sharedColumns.indexOf(f.column) > -1 ? ' · shared' : ''),
          expected: expectedLabel(f),
          actual: actual + (fd.ReadOnlyField ? ' (read-only)' : ''), level: level
        });
      });
      // list-required columns nothing maps to
      (fields || []).forEach(function (fd) {
        if (!fd.Required || fd.ReadOnlyField) return;
        var mapped = cfg._ordered.some(function (f) { return f.column === fd.InternalName; });
        var viaTemplate = fd.InternalName === 'Title' && cfg.target.titleTemplate;
        if (!mapped && !viaTemplate) {
          rows.push({ field: '—', column: fd.InternalName, expected: '(required by the list)', actual: fd.TypeAsString, level: 'warn' });
        }
      });
      // the afterSubmit lookup list: readable, and has both columns
      var lk = cfg.afterSubmit && cfg.afterSubmit.lookup;
      if (!lk) return renderDoctor(def, rows, null, S);
      var where = 'lookup ' + (lk.listUrl || lk.listTitle);
      return def.adapter.getListFields(lk).then(function (lfs) {
        var ln = {};
        (lfs || []).forEach(function (fd) { ln[fd.InternalName] = fd; });
        [[lk.matchColumn, ['Text'], 'Text'], [lk.returnColumn, ['URL', 'Text', 'Note'], 'URL / Text']].forEach(function (c) {
          var fd = ln[c[0]];
          rows.push({ field: where, column: c[0], expected: c[2],
            actual: fd ? fd.TypeAsString : '— (missing)', level: fd ? (c[1].indexOf(fd.TypeAsString) > -1 ? 'ok' : 'warn') : 'error' });
        });
      }, function (e) {
        rows.push({ field: where, column: '—', expected: 'a list this user can read', actual: trimErr(e.message), level: 'error' });
      }).then(function () { renderDoctor(def, rows, null, S); });
    }).catch(function (e) {
      renderDoctor(def, [], e, cfg.strings);
    });
  }
  // a switch with word values writes text, so it maps like a choice
  function compatType(f) { return f.type === 'boolean' && f.values ? 'choice' : f.type; }
  function expectedLabel(f) {
    if (f.type === 'person') return f.multiple ? 'UserMulti' : 'User';
    var c = TYPE_COMPAT[compatType(f)];
    return c ? c.ok.join(' / ') : f.type;
  }
  function renderDoctor(def, rows, err, S) {
    var box = el('div', 'bspf-doctor');
    var t = def.cfg.target;
    box.appendChild(el('h4', 'bspf-section__title', S.doctorTitle + ' — ' + (t.listId || t.listUrl || t.listTitle)));
    if (err) {
      var bar = el('div', 'msgbar msgbar--danger');
      bar.appendChild(el('div', 'msgbar__body', 'Doctor failed: ' + trimErr(err.message)));
      box.appendChild(bar);
    } else {
      var table = el('table', 'grid');
      table.innerHTML = '<thead><tr><th>Form field</th><th>List column</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>';
      var tb = document.createElement('tbody');
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        var badge = r.level === 'ok' ? '<span class="badge badge--success">' + esc(S.doctorOk) + '</span>'
          : r.level === 'warn' ? '<span class="badge badge--warning">' + esc(S.doctorWarn) + '</span>'
            : '<span class="badge badge--danger">' + esc(S.doctorError) + '</span>';
        tr.innerHTML = '<td>' + esc(r.field) + '</td><td class="mono">' + esc(r.column) + '</td><td>' + esc(r.expected) + '</td><td>' + esc(r.actual) + '</td><td>' + badge + '</td>';
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      box.appendChild(table);
    }
    var mount = def.mount;
    var existing = mount.querySelector('.bspf-doctor');
    if (existing) existing.remove();
    mount.insertBefore(box, mount.firstChild);
  }
  NS.validate = function (mountEl) {
    var uid = mountEl && mountEl.querySelector('[data-bspf-uid]') && mountEl.querySelector('[data-bspf-uid]').getAttribute('data-bspf-uid');
    if (uid && NS._defs[uid]) runDoctor(NS._defs[uid]);
  };

  /* ------------------------------------------------------------------
     Edit mode + boot
     ------------------------------------------------------------------ */
  function inEditMode() {
    return /[?&]Mode=Edit\b/i.test(location.search) || location.pathname.indexOf('/_layouts/') > -1;
  }
  function editNote(configUrl, S) {
    var note = el('div', 'bspf-editnote');
    note.innerHTML = icon('ic-fluent-info-24-regular', 20) + '<span>' + esc(S.editModeNote) + ' <code>' + esc(configUrl || 'inline') + '</code></span>';
    return note;
  }

  var navWatcherInstalled = false;
  function installNavWatcher() {
    if (navWatcherInstalled) return;
    navWatcherInstalled = true;
    function onNav() { setTimeout(applyEditState, 50); }
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () { var r = orig.apply(this, arguments); onNav(); return r; };
    });
    window.addEventListener('popstate', onNav);
  }
  function applyEditState() {
    var edit = inEditMode();
    document.querySelectorAll('[data-bsp-form]').forEach(function (m) {
      if (m.__bspfDeferred) {
        // still deferred: keep the placeholder up until edit mode ends
        if (!edit) { m.__bspfDeferred = false; initMount(m); }
        return;
      }
      m.classList.toggle('is-suspended', edit);
    });
  }

  function fatalCard(mount, S, detail) {
    // engine-owned failure UI: tagged so retries can clear it cleanly
    mount.querySelectorAll('[data-bspf-fatal]').forEach(function (n) { n.remove(); });
    var bar = el('div', 'msgbar msgbar--danger');
    bar.setAttribute('data-bspf-fatal', '');
    bar.setAttribute('role', 'alert');
    bar.innerHTML = icon(ICONS.danger, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body">' + esc(S.configLoadError) +
      (detail ? '<br><small>' + esc(fmtStr(S.configLoadDetail, { detail: trimErr(detail) })) + '</small>' : '') + '</div>';
    mount.appendChild(bar);
  }

  function readInlineConfig(mount) {
    var s = mount.querySelector('script[type="application/json"][data-bspf-config]');
    if (!s) return null;
    try { return JSON.parse(s.textContent); } catch (e) { throw new Error('inline config is not valid JSON: ' + e.message); }
  }

  function loadConfig(mount) {
    var url = mount.getAttribute('data-config');
    if (url) {
      return fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error('config HTTP ' + r.status + ' — ' + url);
          return r.json();
        });
    }
    var inline = readInlineConfig(mount);
    if (inline) return Promise.resolve(inline);
    return Promise.reject(new Error('no data-config url and no inline config'));
  }

  function activateAlpine(rootEl) {
    if (window.Alpine) {
      if (!rootEl._x_dataStack) window.Alpine.initTree(rootEl);
      return Promise.resolve();
    }
    return whenAlpine().then(function () {
      // Alpine auto-starts and walks the whole document on load; only roots
      // inserted after that need an explicit init.
      if (window.Alpine && !rootEl._x_dataStack) window.Alpine.initTree(rootEl);
    });
  }

  function initMount(mount) {
    ensureStyles();
    installNavWatcher();
    var configUrl = mount.getAttribute('data-config') || '';

    if (inEditMode()) {
      // Defer real init and show the inert placeholder. The note is only
      // visible WHILE .is-suspended is present, so the class must stay on
      // for the whole edit session (see bsp-forms.css).
      mount.__bspfDeferred = true;
      mount.classList.add('is-suspended', 'is-edit-deferred');
      if (!mount.querySelector('.bspf-editnote')) mount.appendChild(editNote(configUrl, DEFAULT_STRINGS));
      return;
    }
    mount.classList.remove('is-suspended', 'is-edit-deferred');
    mount.querySelectorAll('[data-bspf-fatal]').forEach(function (n) { n.remove(); });

    mount.setAttribute('data-bspf-state', 'initializing');
    var spriteReady = ensureSprite();

    loadConfig(mount).then(function (raw) {
      var norm = normalizeConfig(raw);
      if (norm.errors.length) {
        console.error('[BSP Forms] config errors:', norm.errors);
        throw new Error(norm.errors.join('; '));
      }
      var cfg = norm.cfg;
      var uid = nextUid();
      cfg._ordered.forEach(function (f) { f.domId = uid + '-' + f.k; });

      var adapter = makeAdapter(cfg);
      var def = NS._defs[uid] = {
        uid: uid, cfg: cfg, mount: mount, adapter: adapter,
        store: { files: {}, fileSeq: 0, itemId: null, itemRef: null, pSeq: {}, state: null }
      };

      return spriteReady.then(function () {
        // edit note first (hidden in view mode by CSS), then the app root
        if (!mount.querySelector('.bspf-editnote')) mount.appendChild(editNote(configUrl, cfg.strings));
        var host = document.createElement('div');
        host.innerHTML = renderForm(uid, cfg);
        var root = host.firstChild;
        mount.appendChild(root);
        return activateAlpine(root).then(function () {
          mount.setAttribute('data-bspf-state', 'ready');
          if (mount.hasAttribute('data-validate')) runDoctor(def);
        });
      });
    }).catch(function (e) {
      console.error('[BSP Forms] init failed:', e);
      // config fetches and library loads can fail transiently — leave the
      // mount retryable by the next scan / script re-evaluation
      mount.__bspfInit = false;
      mount.setAttribute('data-bspf-state', 'error');
      fatalCard(mount, DEFAULT_STRINGS, e && e.message);
    });
  }

  NS.scan = function () {
    document.querySelectorAll('[data-bsp-form]').forEach(function (m) {
      if (m.__bspfInit) return;
      m.__bspfInit = true;
      try { initMount(m); }
      catch (e) {
        console.error('[BSP Forms] init threw:', e);
        m.__bspfInit = false;
        m.setAttribute('data-bspf-state', 'error');
        fatalCard(m, DEFAULT_STRINGS, e && e.message);
      }
    });
  };

  // Explicit retry for a mount that failed to initialize (devtools aid; the
  // next NS.scan() would also pick it up since failure clears __bspfInit).
  NS.retry = function (mount) {
    if (!mount || mount.getAttribute('data-bspf-state') !== 'error') return;
    mount.querySelectorAll('[data-bspf-fatal]').forEach(function (n) { n.remove(); });
    mount.__bspfInit = false;
    NS.scan();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { NS.scan(); });
  } else {
    NS.scan();
  }
})();
