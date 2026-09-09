/*! BSP Notify · v0.1.0 · bsp-notify.js */
/* =====================================================================
   BSP Notify — shared email-notification service for BSP parts.

   Callers queue one item on the site's `Notifications` list; a Power
   Automate flow ("BSP Notify", recurrence-driven) claims and sends it
   from a shared mailbox. Callers never know the transport — see this
   part's README.md for the full contract (schema, flow behavior,
   latency, retry, staleness).

   This is a PAGE LIBRARY: no UI, no boot contract, no Alpine. Plain
   classic script, no modules, no build step, safe to evaluate twice.

   Usage (page must already load the self-hosted pnpjs v2 bundle, or be
   about to — the wrapper waits for `window.pnp2` up to 10 s):

     window.bspNotify({
       subject: 'DCS intake received',          // required → Title
       body:    '<p>HTML allowed</p>',          // required → Body
       to:      'a@x.com' or ['a@x.com', …],    // required → To
       source:  'bsp-forms/intake',             // required → Source
       cc:      …,          // optional, same shapes as `to`
       bcc:     …,          // optional
       from:    'shared@…', // optional; MUST be a shared mailbox when
                            // given — blank lets the flow use its
                            // configured default shared mailbox
       type:    'DCS intake notice'             // optional → Type
     }).then(function (r) { r.id; r.mock; });

   Optional page-level overrides (set BEFORE calling):
     window.BSP_NOTIFY_SETTINGS = {
       listTitle: 'Notifications',  // queue list title
       webUrl:    null,             // web absolute url override
       mock:      false             // dev-only: record, don't write
     };

   Mock mode is OPT-IN ONLY: `file:` protocol or `settings.mock === true`.
   On a live page a missing `pnp2` is a hard, visible error — the wrapper
   never silently substitutes the mock for a real write.
   ===================================================================== */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  if (window.bspNotify && window.bspNotify.__loaded) { return; }

  var EMAIL_RE = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;

  function settings() { return window.BSP_NOTIFY_SETTINGS || {}; }
  function mockMode() {
    return location.protocol === 'file:' || settings().mock === true;
  }

  // Accepts a string ('a@x; b@y') or an array; returns the normalized
  // semicolon-joined string, or throws naming the first bad address.
  function normalizeAddresses(value, field, required) {
    var parts;
    if (Array.isArray(value)) { parts = value.slice(); }
    else if (typeof value === 'string') { parts = value.split(/[;,]/); }
    else if (value == null) { parts = []; }
    else { throw new Error('bspNotify: `' + field + '` must be a string or array of addresses'); }
    parts = parts.map(function (p) { return String(p).trim(); }).filter(Boolean);
    if (required && !parts.length) { throw new Error('bspNotify: `' + field + '` requires at least one address'); }
    parts.forEach(function (p) {
      if (!EMAIL_RE.test(p)) { throw new Error('bspNotify: invalid address in `' + field + '`: "' + p + '"'); }
    });
    return parts.join(';');
  }

  function requireText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('bspNotify: `' + field + '` is required');
    }
    return value;
  }

  // Build the exact list-item payload from validated opts. Shared by the
  // live and mock paths so the mock records what the live path would write.
  function buildItem(opts) {
    var item = {
      Title: requireText(opts.subject, 'subject'),
      Body: requireText(opts.body, 'body'),
      To: normalizeAddresses(opts.to, 'to', true),
      Source: requireText(opts.source, 'source'),
      NotifyStatus: 'Queued',
      StatusTime: new Date().toISOString(),
      Attempts: 0
    };
    var cc = normalizeAddresses(opts.cc, 'cc', false);
    var bcc = normalizeAddresses(opts.bcc, 'bcc', false);
    var from = normalizeAddresses(opts.from, 'from', false);
    if (cc) { item.CC = cc; }
    if (bcc) { item.BCC = bcc; }
    if (from) {
      if (from.indexOf(';') >= 0) { throw new Error('bspNotify: `from` must be a single shared-mailbox address'); }
      item.From = from;
    }
    // "Type" is a reserved SharePoint field name, so the column is NotifyType.
    if (opts.type != null) { item.NotifyType = String(opts.type); }
    return item;
  }

  function waitForPnp2(timeoutMs) {
    if (window.pnp2) { return Promise.resolve(window.pnp2); }
    if (typeof window.waitForPnP2 === 'function') {
      return Promise.resolve(window.waitForPnP2()).then(function () { return window.pnp2; });
    }
    return new Promise(function (resolve, reject) {
      var waited = 0, step = 100;
      var t = setInterval(function () {
        if (window.pnp2) { clearInterval(t); resolve(window.pnp2); return; }
        waited += step;
        if (waited >= timeoutMs) {
          clearInterval(t);
          reject(new Error('bspNotify: window.pnp2 not available after ' + timeoutMs + ' ms — this page must load the self-hosted pnpjs v2 bundle (mock mode is opt-in only, never a fallback)'));
        }
      }, step);
    });
  }

  function bspNotify(opts) {
    var item;
    try { item = buildItem(opts || {}); }
    catch (e) { return Promise.reject(e); }

    var listTitle = settings().listTitle || 'Notifications';

    if (mockMode()) {
      bspNotify.mockQueue.push(item);
      return Promise.resolve({ id: bspNotify.mockQueue.length, mock: true, item: item });
    }

    return waitForPnp2(10000).then(function (pnp2) {
      var webUrl = settings().webUrl ||
        (window._spPageContextInfo && window._spPageContextInfo.webAbsoluteUrl);
      if (webUrl) { pnp2.sp.setup({ sp: { baseUrl: webUrl } }); }
      return pnp2.sp.web.lists.getByTitle(listTitle).items.add(item);
    }).then(function (r) {
      return { id: r.data && r.data.Id, mock: false };
    }).catch(function (e) {
      // Visible failure beats a lost notification: rethrow after logging.
      if (window.console && console.error) { console.error('bspNotify failed:', e); }
      throw e;
    });
  }

  bspNotify.version = VERSION;
  bspNotify.__loaded = true;
  bspNotify.mockQueue = [];
  window.bspNotify = bspNotify;
})();
