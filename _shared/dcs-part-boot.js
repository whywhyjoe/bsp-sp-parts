/*! dcs-part-boot v0.1.0 — bsp-sp-parts
 *  The saved boot pattern for custom-script web part tools.
 *
 *  WHY THIS EXISTS
 *  SharePoint renders web part zones on its own schedule, navigates without a page
 *  reload (SPA), and lets authors edit the page live. Every tool needs the same
 *  four things: wait for the host element, mount idempotently (possibly several
 *  instances), stay out of the way in edit mode, and re-mount after SPA navigation.
 *  Writing that per tool guarantees drift. Write it once here; tools call dcsMountPart().
 *
 *  RELATIONSHIP TO fcu-standard.js
 *  This file does NOT replace the standard include. It uses the house helpers when
 *  they are present (waitForElement, waitForPnP2, dcsOnSpaNavigation,
 *  dcsRegisterAlpineComponent, __dcsIsEditMode) and defines minimal stand-ins ONLY
 *  when they are absent — so tools also run standalone (dev harness, disk, a page
 *  without the standard include). Nothing here overwrites an existing global.
 *
 *  TWO MOUNT STYLES
 *   - injected mount (most tools): pass `render(host) -> htmlString`. Alpine v3's
 *     document observer initializes injected trees automatically, so re-mount after
 *     SPA navigation simply means re-injecting.
 *   - static mount (an app whose markup is already in the page, e.g. #dcs-app with
 *     x-ignore): pass `initTree: true`. Re-mount removes x-ignore and calls
 *     Alpine.initTree(host), because Alpine already owns that tree.
 */
(function () {
  'use strict';

  var LOG = '[dcs-part-boot]';

  /* Registry of mounted parts, keyed by id. Debugging surface in any environment:
     dcsParts['sp-list-ordering'].mountAll() / .remount() / .isEditMode() */
  window.dcsParts = window.dcsParts || {};

  /* ───────── Stand-ins for the house helpers (defined only when missing) ───────── */

  if (typeof window.waitForElement !== 'function') {
    window.waitForElement = function (selector, callback, timeout, interval) {
      timeout = timeout || 10000; interval = interval || 100;
      var start = Date.now();
      (function check() {
        var el = document.querySelector(selector);
        if (el) { callback(el); return; }
        if (Date.now() - start < timeout) { window.setTimeout(check, interval); }
        else { console.warn(LOG + ' waitForElement timeout: ' + selector); }
      })();
    };
  }

  if (typeof window.waitForPnP2 !== 'function') {
    window.waitForPnP2 = function (callback, timeout, interval) {
      timeout = timeout || 15000; interval = interval || 100;
      var start = Date.now();
      (function check() {
        try {
          if (window.pnp2 && window.pnp2.sp && window.pnp2.sp.web) { callback(window.pnp2); return; }
        } catch (e) { /* keep polling */ }
        if (Date.now() - start >= timeout) { console.warn(LOG + ' waitForPnP2 timeout'); return; }
        window.setTimeout(check, interval);
      })();
    };
  }

  /* NOTE ON ALPINE REGISTRATION — tools in this repo do NOT normally use this.
     bsp-design-system ships no Alpine.data() factory layer by design (stated in its
     CLAUDE.md, AGENTS.md, copilot-instructions.md, index.html and TECHNICAL-REFERENCE),
     and its own pages use inline x-data objects or a plain global factory. Tools built
     on that system match it: window.<toolName> = function () {…} with
     x-data="<toolName>()". That is greppable — the markup is visibly a function call.

     This helper stays for the one case where registration genuinely earns its keep: an
     app-shaped tool whose markup is STATIC in the page and therefore needs
     dcsMountPart({ initTree: true }) to remove x-ignore and call Alpine.initTree(), as
     the Fraud Journeys #dcs-app does. Registration by name is required there because
     Alpine already owns the tree. */
  if (typeof window.dcsRegisterAlpineComponent !== 'function') {
    window.dcsRegisterAlpineComponent = function (options) {
      if (!options || !options.name || typeof options.factory !== 'function') {
        console.warn(LOG + ' dcsRegisterAlpineComponent: name and factory are required.');
        return;
      }
      function register() {
        if (!window.Alpine || typeof window.Alpine.data !== 'function') return;
        try { window.Alpine.data(options.name, options.factory); }
        catch (e) { console.error(LOG + ' Alpine.data failed for ' + options.name, e); }
      }
      document.addEventListener('alpine:init', register);
      register();
    };
  }

  /* waitForAlpine — no house equivalent today; additive and safe. */
  if (typeof window.waitForAlpine !== 'function') {
    window.waitForAlpine = function (callback, timeout, interval, onTimeout) {
      timeout = timeout || 15000; interval = interval || 100;
      var start = Date.now();
      (function check() {
        if (window.Alpine) { callback(window.Alpine); return; }
        if (Date.now() - start >= timeout) {
          console.warn(LOG + ' waitForAlpine timeout');
          if (typeof onTimeout === 'function') onTimeout();
          return;
        }
        window.setTimeout(check, interval);
      })();
    };
  }

  /* ───────── Edit mode ─────────
     Prefer the standard include's detector (URL param + sessionStorage intent + DOM
     heuristics). Fall back to the body class, then to the URL — checking BOTH 'mode'
     and 'Mode', since URLSearchParams keys are case-sensitive and the two prod
     scripts disagree on casing. */
  function isEditMode() {
    try {
      if (typeof window.__dcsIsEditMode === 'function') return !!window.__dcsIsEditMode();
    } catch (e) { /* fall through */ }
    if (document.body && document.body.classList.contains('editmode')) return true;
    try {
      var q = new URLSearchParams(window.location.search);
      var m = q.get('mode') || q.get('Mode') || '';
      m = m.toLowerCase();
      return m === 'edit' || m === 'design';
    } catch (e) { return false; }
  }

  function defaultPlaceholder(label) {
    return '<div class="msgbar msgbar--info" role="status">' +
      '<svg class="icon icon--20 msgbar__icon" aria-hidden="true"><use href="#ic-fluent-info-24-regular"></use></svg>' +
      '<div class="msgbar__body"><strong>' + label + '</strong> — paused while you edit this page. ' +
      'Save or exit edit mode to use it.</div></div>';
  }

  /* ───────── dcsMountPart ─────────
   * @param {Object}   o
   * @param {string}   o.id            Unique id: SPA subscriber id + mount guard value.
   * @param {string}   o.selector      CSS selector for the host element(s).
   * @param {Function} [o.render]      (host) => html string. Injected-mount style.
   * @param {boolean}  [o.initTree]    Static-mount style: remove x-ignore + Alpine.initTree(host).
   * @param {Function} [o.onMount]     (host) => void, after each successful mount.
   * @param {string}   [o.editMode]    'placeholder' (default) | 'skip' | 'run'.
   * @param {string}   [o.label]       Friendly name used in the edit-mode placeholder.
   * @param {number}   [o.timeout]     Host wait timeout, default 30000.
   */
  window.dcsMountPart = function (o) {
    if (!o || !o.id || !o.selector) {
      console.warn(LOG + ' dcsMountPart requires { id, selector }.');
      return;
    }
    if (typeof o.render !== 'function' && o.initTree !== true) {
      console.warn(LOG + ' dcsMountPart requires render() or initTree:true. [' + o.id + ']');
      return;
    }

    var GUARD = 'data-dcs-mounted';
    var editPolicy = o.editMode || 'placeholder';
    var label = o.label || o.id;
    var subscribed = false;

    // Guard value encodes the mode, so leaving edit mode re-mounts the live tool.
    function guardValue(editing) { return editing ? o.id + ':edit' : o.id; }

    function mountAll() {
      var editing = editPolicy !== 'run' && isEditMode();
      if (editing && editPolicy === 'skip') return 0;

      var want = guardValue(editing);
      var hosts = document.querySelectorAll(o.selector);
      var mounted = 0;

      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        if (host.getAttribute(GUARD) === want) continue;   // already in the right state

        if (editing) {
          host.innerHTML = defaultPlaceholder(label);
          host.setAttribute(GUARD, want);
          mounted++;
          continue;
        }

        if (o.initTree === true) {
          host.removeAttribute('x-ignore');
          if (window.Alpine && typeof window.Alpine.initTree === 'function') {
            try { window.Alpine.initTree(host); }
            catch (e) { console.error(LOG + ' initTree failed [' + o.id + ']', e); continue; }
          } else {
            continue;   // Alpine not ready; leave unguarded so a later pass retries
          }
        } else {
          host.innerHTML = o.render(host);
        }

        host.setAttribute(GUARD, want);
        mounted++;
        if (typeof o.onMount === 'function') {
          try { o.onMount(host); } catch (e) { console.error(LOG + ' onMount failed [' + o.id + ']', e); }
        }
      }

      if (mounted) console.log(LOG + ' mounted ' + mounted + ' host(s) [' + o.id + ']' + (editing ? ' (edit-mode placeholder)' : ''));
      return mounted;
    }

    function boot() {
      // waitForElement is querySelector-based (first match only) — it is just the
      // "something showed up" trigger. mountAll() then handles EVERY host itself.
      window.waitForElement(o.selector, function () { mountAll(); }, o.timeout || 30000, 150);
    }

    function subscribeOnce() {
      if (subscribed) return;
      subscribed = true;
      if (typeof window.dcsOnSpaNavigation === 'function') {
        window.dcsOnSpaNavigation(o.id, function () { boot(); });
        console.log(LOG + ' SPA re-init registered [' + o.id + ']');
      } else {
        console.log(LOG + ' dcsOnSpaNavigation absent; no SPA re-init [' + o.id + ']');
      }
    }

    boot();
    subscribeOnce();

    // Edit mode can flip without a navigation (author clicks Edit). Re-check briefly.
    window.setTimeout(mountAll, 800);
    window.setTimeout(mountAll, 2500);

    var handle = { id: o.id, remount: boot, mountAll: mountAll, isEditMode: isEditMode };
    window.dcsParts[o.id] = handle;   // debugging surface: dcsParts['sp-list-ordering'].mountAll()
    return handle;
  };

  window.dcsPartBootVersion = '0.1.0';
})();
