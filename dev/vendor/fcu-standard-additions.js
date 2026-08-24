/*! PROPOSED additions to fcu-standard.js — NOT deployed by this repo.
 *
 *  fcu-standard.js lives with the prod page includes, not here. This file is a
 *  drop-in reference: each function below REPLACES the same-named one in
 *  fcu-standard.js (or is new). Every change is additive — no existing call
 *  signature changes, so current callers keep working untouched.
 *
 *  Why these matter: today waitForPnP2 and waitForElement report a timeout only
 *  to the console. The callback never fires, so the CALLER cannot tell the
 *  difference between "still waiting" and "never coming" — which is how a tool
 *  ends up silently doing nothing on a live page.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   1. waitForPnP2 — adds `onTimeout` + returns a Promise.
      Existing calls: waitForPnP2(cb) / (cb, timeout) / (cb, timeout, interval) — unaffected.
   ───────────────────────────────────────────────────────────────────────────── */
function waitForPnP2(callback, timeout = 15000, interval = 100, onTimeout) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      try {
        if (window.pnp2 && window.pnp2.sp && window.pnp2.sp.web) {
          console.log("[fcu-standard-js waitForPnP2] pnp2 is ready");
          if (typeof callback === 'function') callback(window.pnp2);
          resolve(window.pnp2);
          return;
        }
      } catch (e) {
        // swallow and continue polling
      }

      if (Date.now() - start >= timeout) {
        console.warn("[fcu-standard-js waitForPnP2] Timeout waiting for pnp2");
        if (typeof onTimeout === 'function') onTimeout();
        reject(new Error('waitForPnP2 timeout'));
        return;
      }

      setTimeout(check, interval);
    })();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. waitForElement — adds an options object + returns a Promise.
      options: { onTimeout, all, observe }
        onTimeout  callback when the selector never appears
        all        resolve with ALL matches (querySelectorAll) instead of the first —
                   needed when a page hosts more than one instance of a web part
        observe    attach a MutationObserver as a polling accelerator
      Existing calls pass at most 4 args (e.g. ensureWebViewEnvIfOptedIn) — unaffected.
   ───────────────────────────────────────────────────────────────────────────── */
function waitForElement(selector, callback, timeout = 10000, interval = 100, options = {}) {
  console.log(`[fcu-standard-js waitForElement] Waiting for selector: ${selector}`);
  const { onTimeout, all = false, observe = false } = options;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let timer = null, mo = null, done = false;

    const finish = (ok, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (mo) mo.disconnect();
      if (ok) {
        console.log(`[fcu-standard-js waitForElement] Found element: ${selector}`);
        if (typeof callback === 'function') callback(value);
        resolve(value);
      } else {
        console.warn(`[fcu-standard-js waitForElement] Timeout: Element "${selector}" not found.`);
        if (typeof onTimeout === 'function') onTimeout();
        reject(new Error(`waitForElement timeout: ${selector}`));
      }
    };

    const check = () => {
      if (done) return;
      const found = all
        ? document.querySelectorAll(selector)
        : document.querySelector(selector);
      if (all ? found.length > 0 : found) { finish(true, found); return; }
      if (Date.now() - start < timeout) { timer = setTimeout(check, interval); }
      else { finish(false); }
    };

    if (observe && window.MutationObserver && document.documentElement) {
      mo = new MutationObserver(check);
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
    check();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. waitForAlpine — NEW. Symmetric with waitForPnP2; no back-compat risk.
   ───────────────────────────────────────────────────────────────────────────── */
function waitForAlpine(callback, timeout = 15000, interval = 100, onTimeout) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      if (window.Alpine) {
        if (typeof callback === 'function') callback(window.Alpine);
        resolve(window.Alpine);
        return;
      }
      if (Date.now() - start >= timeout) {
        console.warn("[fcu-standard-js waitForAlpine] Timeout waiting for Alpine");
        if (typeof onTimeout === 'function') onTimeout();
        reject(new Error('waitForAlpine timeout'));
        return;
      }
      setTimeout(check, interval);
    })();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. BUG FIX — initLocalizer references an undefined `maxAttempts`.
      Current code declares `const MAX_ATTEMPTS = 6;` but the guard reads:
          if (attempt >= maxAttempts) {
      `maxAttempts` is never defined, so tryLocalize throws a ReferenceError on the
      first retry. It is dormant only because initLocalizer() is never called today.
      Fix: use the declared constant.

          - if (attempt >= maxAttempts) {
          + if (attempt >= MAX_ATTEMPTS) {
   ───────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────────
   5. BUG FIX — edit-mode query-param casing disagreement.
      fcu-standard.js reads  new URLSearchParams(...).get('mode')
      fj.bootstrap.js reads  new URLSearchParams(...).get('Mode')
      URLSearchParams keys are CASE-SENSITIVE, so exactly one of them matches any
      given URL and the two disagree about whether the page is being edited.
      Fix: have fj.bootstrap.js call the canonical detector, which already combines
      the URL param, the per-path sessionStorage intent, and DOM heuristics:

          if (typeof __dcsIsEditMode === 'function' && __dcsIsEditMode()) {
            console.warn('[FJ Bootstrap] Edit/Design mode detected, skipping initialization.');
            return;
          }

      If a standalone check is still wanted, read both casings:
          const q = new URLSearchParams(window.location.search);
          const mode = (q.get('mode') || q.get('Mode') || '').toLowerCase();
   ───────────────────────────────────────────────────────────────────────────── */
