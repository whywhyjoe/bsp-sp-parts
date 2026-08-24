/* ═══════════════════════════════════════════════════════════════════════════
   VENDORED DEV-ONLY COPY — NEVER DEPLOYED

   ┌─────────────────────────────────────────────────────────────────────────┐
   │  SOURCE (update this URL if the prod location moves):                   │
   │                                                                         │
   │      /sites/FCUPortal/Code/fcu-standard.js                              │
   │                                                                         │
   │  Prod copy last captured: 2026-08-24 (its own banner reads              │
   │  "Last modified: 2026/08/24 12:04:25")                                  │
   └─────────────────────────────────────────────────────────────────────────┘

   WHY THIS FILE EXISTS
   On a real page fcu-standard.js is included at the top of every page and supplies
   waitForElement, waitForPnP2, __dcsIsEditMode and friends. The dev harness has no
   such include, so without this copy the harness would only ever exercise the
   stand-ins in _shared/dcs-part-boot.js — i.e. it would test the fallback path and
   never the one that actually runs in production. Loading this makes the harness
   mirror prod.

   HOW TO REFRESH
   Copy the prod file over this one, then re-add this header block. Keep it VERBATIM:
   do not fix bugs here. A faithful copy is the whole point — if the harness runs
   different code than prod, it stops being evidence. Proposed fixes/improvements live
   in ./fcu-standard-additions.js, which is likewise not deployed from this repo.

   KNOWN ISSUES IN THIS COPY (reproduced on purpose, see fcu-standard-additions.js)
   · waitForPnP2 / waitForElement report a timeout only to the console — the callback
     never fires, so a caller cannot tell "still waiting" from "never coming".
   · initLocalizer() guards on `maxAttempts` but declares `MAX_ATTEMPTS` → ReferenceError
     on the first retry. Dormant: initLocalizer() is never called.
   ═══════════════════════════════════════════════════════════════════════════ */

console.group("========== [ INCLUDE:  fcu-standard.js ] ==========");
console.log("Loaded");
console.log(`Last modified: 2026/08/24 12:04:25
	`);
console.groupEnd();

/**
 * Robust edit-mode detection (URL param can disappear due to SP/SPA navigation).
 * - Trust explicit ?mode=Edit when present
 * - Persist intent per-path in sessionStorage so later re-inits don't flip to viewmode
 * - Fallback to DOM heuristics for modern authoring canvas
 */
const __dcsEditKey = `dcs:mode=edit:intent:${location.pathname}`;
function __dcsHasModeEditParam() {
 return new URLSearchParams(window.location.search).get('mode')?.toLowerCase() === 'edit';
}
function __dcsLooksLikeSpEditModeDom() {
 // Heuristics: these tend to exist only while authoring/editing
 return Boolean(
  document.querySelector('[data-automation-id="authoringCanvas"]') ||
  document.querySelector('[data-automation-id="pageCommandBarSaveButton"]') ||
  document.querySelector('[data-automation-id="pageCommandBarPublishButton"]') ||
  document.querySelector('button[data-automation-id="pageCommandBarSaveButton"]') ||
  document.querySelector('button[data-automation-id="pageCommandBarPublishButton"]')
 );
}
function __dcsIsEditMode() {
 try {
  // 1) Explicit query param (most reliable signal when present)
  if (__dcsHasModeEditParam()) {
   sessionStorage.setItem(__dcsEditKey, '1');
   return true;
  }
  // 2) If SP cleaned the URL after load, keep the previously requested intent (per page path)
  if (sessionStorage.getItem(__dcsEditKey) === '1') return true;
  // 3) DOM fallback (covers cases where scripts now run after SP authoring initializes)
  return __dcsLooksLikeSpEditModeDom();
 } catch {
  // If sessionStorage is blocked, fall back to URL+DOM only
  return __dcsHasModeEditParam() || __dcsLooksLikeSpEditModeDom();
 }
}
function __dcsApplyPageModeClasses() {
 const isEditMode = __dcsIsEditMode();

 document.body.classList.remove('editmode', 'viewmode');
 document.body.classList.add(isEditMode ? 'editmode' : 'viewmode');
 if (isEditMode) document.body.classList.add('dcs-suspended');

 if (isEditMode) {
  const cmd = document.getElementById("spCommandBar");
  const hdr = document.getElementById("spSiteHeader");
  if (cmd) cmd.style.opacity = "1";
  if (hdr) hdr.style.opacity = "1";
  console.log("************* EDITMODE ****************");
 } else {
  console.log("************* VIEWMODE ****************");
 }
}

// DETECT EDIT MODE (resilient to URL cleanup)
__dcsApplyPageModeClasses();
// Re-check shortly after load in case authoring DOM appears after initial script execution
setTimeout(__dcsApplyPageModeClasses, 500);
document.addEventListener('DOMContentLoaded', () => setTimeout(__dcsApplyPageModeClasses, 0));


// STYLE FUNCTIONS:

/* Style for page subtitle bar. Include <data class="PageSubtitle"></data> to apply */
document.querySelectorAll('.CanvasZoneSectionContainer').forEach(container => {
    const zones = container.querySelectorAll('.ControlZone');
    if (zones.length >= 2 && zones[1].querySelector('.PageSubtitle')) {
        zones[0].style.marginTop = '10px'; zones[0].style.marginBottom = '10px'; // Apply your styles
    }

    const zone0 = zones[0];
    const anchorH3 = zone0 ? zone0.querySelector('.anchor-h3') : null;
    if (anchorH3) {
        anchorH3.style.paddingLeft = '0px';
    }

});

/**
 * Utility: ensureWebViewEnvIfOptedIn
 * If the page opts into "webview" via <data pageoptions="...webview..."> (case-insensitive),
 * ensure the URL has ?env=WebView. If missing or different, reload with it added.
 */
function ensureWebViewEnvIfOptedIn() {
    try {
        const isEditMode = __dcsIsEditMode();
        if (isEditMode) {
            console.log('[fcu-standard-js ensureWebViewEnvIfOptedIn] Skipping: page is in edit mode.');
            return;
        }

        const hasOptInNow = Array.from(document.querySelectorAll('data[pageoptions]'))
            .some(el => (el.getAttribute('pageoptions') || '').toLowerCase().includes('webview'));

        const ensureEnv = () => {
            const url = new URL(window.location.href);
            const current = url.searchParams.get('env');
            if (current && current.toLowerCase() === 'webview') {
                console.log('[ensureWebViewEnvIfOptedIn] env=WebView already present.');
                return;
            }
            url.searchParams.set('env', 'WebView');
            console.log('[fcu-standard-js ensureWebViewEnvIfOptedIn] Reloading with env=WebView.');
            window.location.replace(url.href);
        };

        if (hasOptInNow) {
            ensureEnv();
            return;
        }

        if (typeof waitForElement === 'function') {
            waitForElement('data[pageoptions]', function (el) {
                if (__dcsIsEditMode()) {
                    console.log('[fcu-standard-js ensureWebViewEnvIfOptedIn] Skipping after wait: edit mode detected.');
                    return;
                }
                const val = (el.getAttribute('pageoptions') || '').toLowerCase();
                if (val.includes('webview')) {
                    ensureEnv();
                }
            }, 3000, 50);
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                if (__dcsIsEditMode()) {
                    console.log('[fcu-standard-js ensureWebViewEnvIfOptedIn] Skipping on DOMContentLoaded: edit mode detected.');
                    return;
                }
                const found = Array.from(document.querySelectorAll('data[pageoptions]'))
                    .some(el => (el.getAttribute('pageoptions') || '').toLowerCase().includes('webview'));
                if (found) {
                    ensureEnv();
                }
            });
        }
    } catch (e) {
        console.error('[fcu-standard-js ensureWebViewEnvIfOptedIn] Error:', e);
    }
}
ensureWebViewEnvIfOptedIn();


/**
 * Utility: injectIntoElement
 * Waits for one or more elements matching a selector, then injects HTML content.
 */
function injectIntoElement(selector, htmlContent, injectAll = false, timeout = 10000, interval = 100, mode = 'appendEnd') {
  const markerAttr = 'data-injection-marker';
  const start = Date.now();

  const createFragment = () => {
    const template = document.createElement('template');
    template.innerHTML = htmlContent.trim();
    Array.from(template.content.children).forEach((element) => {
      element.setAttribute(markerAttr, 'true');
    });
    return template.content.cloneNode(true);
  };

  const inject = (targetElement) => {
    if (targetElement.querySelector(`[${markerAttr}]`)) {
      console.log('[injectIntoElement] Marker found, skipping injection.');
      return false;
    }
    const content = createFragment();
    switch (mode) {
      case 'appendStart': targetElement.prepend(content); break;
      case 'replace':     targetElement.replaceChildren(content); break;
      case 'appendEnd':
      default:            targetElement.append(content); break;
    }
    return true;
  };

  const check = () => {
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length > 0) {
      if (injectAll) {
        let injectedCount = 0;
        elements.forEach((element) => { if (inject(element)) { injectedCount++; } });
        console.log(`[injectIntoElement] Injected into ${injectedCount} of ${elements.length} element(s) using mode "${mode}".`);
      } else {
        inject(elements[0]);
        console.log(`[injectIntoElement] Injected into first matching element using mode "${mode}".`);
      }
      return;
    }
    if (Date.now() - start < timeout) { setTimeout(check, interval); }
    else { console.warn(`[injectIntoElement] Timeout: Element "${selector}" not found.`); }
  };

  console.log(`[injectIntoElement] Waiting for selector: ${selector}`);
  check();
}


/* Simple Localizer — defined but not invoked by this file. */
function initLocalizer() {
  console.log("[FCU Page Localizer] Initializing...");

  const FRENCH_URL_PREFIX = '/sites/tando-fcu/sitepages/fr/home.aspx';
  const MAX_ATTEMPTS = 6;
  const RETRY_DELAY_MS = 1000;

  const isFrenchPage = () =>
      new URLSearchParams(location.search).get('lang')?.toLowerCase().startsWith('fr') ||
      document.querySelector('#LanguageToggle button')?.textContent?.trim().toUpperCase() === 'FR' ||
      document.documentElement.lang?.toLowerCase().startsWith('fr') ||
      location.pathname.toLowerCase().startsWith(FRENCH_URL_PREFIX);

  const localizeFrenchLinks = () => {
      console.log("[FCU Page Localizer] French detected. Localizing hrefs...");
      document.documentElement.classList.add('lang-fr');
      document.querySelectorAll('a[data-fr-href]').forEach((anchorElement) => {
          anchorElement.href = anchorElement.getAttribute('data-fr-href');
      });
  };

  const tryLocalize = (attempt = 1) => {
    const frenchPage = isFrenchPage();
    const localizableLinks = document.querySelectorAll('a[data-fr-href]');

    if (frenchPage && localizableLinks.length > 0) { localizeFrenchLinks(); return; }

    // NOTE (vendored copy): `maxAttempts` is undefined here — MAX_ATTEMPTS is the
    // declared constant. Reproduced verbatim; see fcu-standard-additions.js §4.
    if (attempt >= maxAttempts) {
      console.log(`[FCU Page Localizer] Stopped after ${attempt} attempt(s). French page: ${frenchPage}. Localizable links found: ${localizableLinks.length}.`);
      return;
    }

    console.log(`[FCU Page Localizer] Retry ${attempt}/${MAX_ATTEMPTS - 1}. French page: ${frenchPage}. Localizable links found: ${localizableLinks.length}.`);
    setTimeout(() => tryLocalize(attempt + 1), RETRY_DELAY_MS);
  };

  tryLocalize();
};


/**
 * Utility: Repeat function with delays.
 */
function runWithDelays(fn, count, n, w) {
	setTimeout(() => {
	  let i = 0;
	  const intervalId = setInterval(() => {
		fn(i);
		i++;
		if (i >= count) { clearInterval(intervalId); }
	  }, n);
	}, w);
  }

/**
 * Utility: waitForPnP2
 * Waits for the global pnp2 rollup AND the sp.web surface to be ready.
 */
function waitForPnP2(callback, timeout = 15000, interval = 100) {
  const start = Date.now();

  (function check() {
    try {
      if (window.pnp2 && window.pnp2.sp && window.pnp2.sp.web) {
        console.log("[fcu-standard-js waitForPnP2] pnp2 is ready");
        callback(window.pnp2);
        return;
      }
    } catch (e) {
      // swallow and continue polling
    }

    if (Date.now() - start >= timeout) {
      console.warn("[fcu-standard-js waitForPnP2] Timeout waiting for pnp2");
      return;
    }

    setTimeout(check, interval);
  })();
}

/**
 * Utility: waitForElement
 * Polls until the selector matches, then runs the callback.
 */
function waitForElement(selector, callback, timeout = 10000, interval = 100) {
	console.log(`[fcu-standard-js waitForElement] Waiting for selector: ${selector}`);
	const start = Date.now();
	const check = () => {
		const element = document.querySelector(selector);
		if (element) {
			console.log(`[fcu-standard-js waitForElement] Found element: ${selector}`);
			callback(element);
		}
		else if (Date.now() - start < timeout) { setTimeout(check, interval); }
		else { console.warn(`[fcu-standard-js waitForElement] Timeout: Element "${selector}" not found.`); }
	};
	check();
}

/**
 * Utility: observeWithLimit
 */
function observeWithLimit(targetNode, onUpdate, options = {}) {
	const {
		maxUpdates = Infinity,
			cooldownMs = 5000,
			debounceMs = 300,
			filterFn = () => true
	} = options;
	let updateCount = 0;
	let lastUpdateTime = 0;
	const safeUpdate = () => {
		const now = Date.now();
		if (updateCount >= maxUpdates) {
			console.warn(`[fcu-standard-js observeWithLimit] Max updates (${maxUpdates}) reached.`);
			return;
		}
		if (now - lastUpdateTime < cooldownMs) {
			console.log(`[fcu-standard-js observeWithLimit] Skipping update — cooldown active.`);
			return;
		}
		lastUpdateTime = now;
		updateCount++;
		console.log(`[fcu-standard-js observeWithLimit] Running update #${updateCount}`);
		onUpdate();
	};
	const debouncedUpdate = debounce(safeUpdate, debounceMs);
	const observer = new MutationObserver((mutationsList) => {
		if (filterFn(mutationsList)) { debouncedUpdate(); }
	});
	observer.observe(targetNode, { childList: true, characterData: true, subtree: true });
	console.log(`[fcu-standard-js observeWithLimit] Observer initialized on`, targetNode);
	safeUpdate();
}

/**
 * Utility: debounce
 */
function debounce(func, wait) {
	let timeout;
	return function (...args) {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			console.log(`[fcu-standard-js debounce] Running debounced function`);
			func.apply(this, args);
		}, wait);
	};
}

/**
 * Utility: iframeSimpleResizer
 */
function iframeSimpleResizer(selector) {
	var iframe = document.querySelector(selector);
	if (!iframe || !iframe.contentWindow) return;
	var doc = iframe.contentWindow.document;
	var body_ = doc.body, html_ = doc.documentElement;
	var height = Math.max(body_.scrollHeight, body_.offsetHeight, html_.clientHeight, html_.scrollHeight, html_.offsetHeight);
	var width = Math.max(body_.scrollWidth, body_.offsetWidth, html_.clientWidth, html_.scrollWidth, html_.offsetWidth);
	iframe.style.height = height + "px";
	iframe.style.width = width + "px";
}

/**
 * Utility: injectCssToIframe
 */
 function injectCssToIframe(selector, cssString) {
	var iframe = document.querySelector(selector);
	if (!iframe) return;
	iframe.addEventListener('load', function () {
		var iframeHead = iframe.contentDocument.head;
		var style = document.createElement("style");
		style.textContent = cssString;
		iframeHead.appendChild(style);
	});
}

console.group("========== [ INCLUDE: fcu-standard.js ] ==========");
console.log("Script block finished");
console.groupEnd();
