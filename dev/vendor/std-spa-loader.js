/* ═══════════════════════════════════════════════════════════════════════════
   VENDORED DEV-ONLY COPY — NEVER DEPLOYED

   ┌─────────────────────────────────────────────────────────────────────────┐
   │  SOURCE (update this URL if the prod location moves):                   │
   │                                                                         │
   │      /sites/FCUPortal/Code/std-spa-loader.js                            │
   │                                                                         │
   │  Prod copy last captured: 2026-08-24                                    │
   └─────────────────────────────────────────────────────────────────────────┘

   Supplies dcsOnSpaNavigation (SharePoint SPA navigation bus) and
   dcsRegisterAlpineComponent. Vendored so the dev harness exercises the REAL
   pushState/replaceState/popstate patching rather than a stand-in. Keep VERBATIM
   when refreshing — see ./fcu-standard.js for the full rationale.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    const BUS_KEY = "__dcsSpaLoader";
    const LOG_PREFIX = "[DCS SPA Loader]";

    if (window[BUS_KEY] && window[BUS_KEY].installed) {
        console.log(`${LOG_PREFIX} Already installed.`);
        return;
    }

    const spaLoader = window[BUS_KEY] || {
        installed: false,
        lastUrl: window.location.href,
        subscribers: [],
        originalPushState: null,
        originalReplaceState: null
    };

    window[BUS_KEY] = spaLoader;

    function log() {
        if (spaLoader.debug === true) { console.log.apply(console, arguments); }
    }

    function notifySubscribers(reason, previousUrl, currentUrl) {
        if (!spaLoader.subscribers.length) {
            log(`${LOG_PREFIX} URL changed, but no subscribers registered.`);
            return;
        }

        spaLoader.subscribers.forEach(function (subscriber) {
            const delay = typeof subscriber.delay === "number" ? subscriber.delay : 300;

            setTimeout(function () {
                try {
                    console.log(`${LOG_PREFIX} Running subscriber: ${subscriber.id}`, {
                        reason: reason, previousUrl: previousUrl, currentUrl: currentUrl
                    });

                    subscriber.callback({
                        id: subscriber.id, reason: reason,
                        previousUrl: previousUrl, currentUrl: currentUrl, url: currentUrl
                    });
                } catch (error) {
                    console.error(`${LOG_PREFIX} Subscriber failed: ${subscriber.id}`, error);
                }
            }, delay);
        });
    }

    function handlePossibleNavigation(reason) {
        const currentUrl = window.location.href;
        const previousUrl = spaLoader.lastUrl;

        if (currentUrl === previousUrl) {
            log(`${LOG_PREFIX} Ignored ${reason}; URL did not change.`);
            return;
        }

        spaLoader.lastUrl = currentUrl;

        console.log(`${LOG_PREFIX} Navigation detected`, {
            reason: reason, previousUrl: previousUrl, currentUrl: currentUrl
        });

        notifySubscribers(reason, previousUrl, currentUrl);
    }

    function installHistoryListeners() {
        if (spaLoader.installed) return;

        spaLoader.installed = true;
        spaLoader.lastUrl = window.location.href;

        spaLoader.originalPushState = history.pushState;
        spaLoader.originalReplaceState = history.replaceState;

        history.pushState = function () {
            const result = spaLoader.originalPushState.apply(this, arguments);
            setTimeout(function () { handlePossibleNavigation("pushState"); }, 100);
            return result;
        };

        history.replaceState = function () {
            const result = spaLoader.originalReplaceState.apply(this, arguments);
            setTimeout(function () { handlePossibleNavigation("replaceState"); }, 100);
            return result;
        };

        window.addEventListener("popstate", function () {
            setTimeout(function () { handlePossibleNavigation("popstate"); }, 100);
        });

        console.log(`${LOG_PREFIX} Installed.`);
    }

    window.dcsOnSpaNavigation = function (id, callback, options) {
        options = options || {};

        if (!id || typeof id !== "string") {
            console.warn("[dcsOnSpaNavigation] Missing required string id.");
            return;
        }

        if (typeof callback !== "function") {
            console.warn(`[dcsOnSpaNavigation:${id}] Missing required callback function.`);
            return;
        }

        const existing = spaLoader.subscribers.some(function (subscriber) {
            return subscriber.id === id;
        });

        if (existing) {
            console.log(`[dcsOnSpaNavigation:${id}] Already registered.`);
            return;
        }

        spaLoader.subscribers.push({
            id: id, callback: callback,
            delay: typeof options.delay === "number" ? options.delay : 300
        });

        console.log(`[dcsOnSpaNavigation:${id}] Registered.`);

        if (options.runOnRegister === true) {
            const delay = typeof options.delay === "number" ? options.delay : 300;
            setTimeout(function () {
                try {
                    callback({
                        id: id, reason: "register", previousUrl: null,
                        currentUrl: window.location.href, url: window.location.href
                    });
                } catch (error) {
                    console.error(`[dcsOnSpaNavigation:${id}] Initial callback failed.`, error);
                }
            }, delay);
        }
    };

    window.dcsRemoveSpaNavigation = function (id) {
        if (!id || typeof id !== "string") {
            console.warn("[dcsRemoveSpaNavigation] Missing required string id.");
            return;
        }

        const beforeCount = spaLoader.subscribers.length;
        spaLoader.subscribers = spaLoader.subscribers.filter(function (subscriber) {
            return subscriber.id !== id;
        });
        const afterCount = spaLoader.subscribers.length;

        if (beforeCount === afterCount) {
            console.log(`[dcsRemoveSpaNavigation:${id}] No subscriber found.`);
        } else {
            console.log(`[dcsRemoveSpaNavigation:${id}] Removed.`);
        }
    };

    window.dcsListSpaNavigationSubscribers = function () {
        console.table(spaLoader.subscribers.map(function (subscriber) {
            return { id: subscriber.id, delay: subscriber.delay };
        }));
        return spaLoader.subscribers.slice();
    };

    window.dcsSetSpaNavigationDebug = function (enabled) {
        spaLoader.debug = enabled === true;
        console.log(`${LOG_PREFIX} Debug mode: ${spaLoader.debug ? "on" : "off"}`);
    };

    installHistoryListeners();

})();


/**
 * Utility: dcsRegisterAlpineComponent
 * Registers an Alpine component safely in SharePoint modern pages.
 */
function dcsRegisterAlpineComponent(options) {
    if (!options || typeof options !== "object") {
        console.warn("[dcsRegisterAlpineComponent] Missing options object.");
        return;
    }

    const name = options.name;
    const factory = options.factory;
    const mountSelector = options.mountSelector || null;
    const removeXIgnore = options.removeXIgnore !== false;
    const initTree = options.initTree !== false;

    if (!name || typeof name !== "string") {
        console.warn("[dcsRegisterAlpineComponent] Missing required component name.");
        return;
    }

    if (typeof factory !== "function") {
        console.warn(`[dcsRegisterAlpineComponent:${name}] Missing required factory function.`);
        return;
    }

    function register() {
        if (!window.Alpine || typeof window.Alpine.data !== "function") { return; }

        try {
            window.Alpine.data(name, factory);
            console.log(`[dcsRegisterAlpineComponent:${name}] Component registered.`);
        } catch (error) {
            console.error(`[dcsRegisterAlpineComponent:${name}] Component registration failed.`, error);
            return;
        }

        if (!mountSelector) { return; }

        const mount = document.querySelector(mountSelector);

        if (!mount) {
            console.warn(`[dcsRegisterAlpineComponent:${name}] Mount not found: ${mountSelector}`);
            return;
        }

        if (removeXIgnore) { mount.removeAttribute("x-ignore"); }

        if (initTree && typeof window.Alpine.initTree === "function") {
            try {
                window.Alpine.initTree(mount);
                console.log(`[dcsRegisterAlpineComponent:${name}] Alpine.initTree() invoked.`);
            } catch (error) {
                console.error(`[dcsRegisterAlpineComponent:${name}] Alpine.initTree() failed.`, error);
            }
        }
    }

    document.addEventListener("alpine:init", register);

    if (window.Alpine && typeof window.Alpine.data === "function") { register(); }
}
