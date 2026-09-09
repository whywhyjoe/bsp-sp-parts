/* classic-referrer-redirects — second-hop redirect for a classic→modern
 * SharePoint site migration. See README.md.
 *
 * SharePoint bulk-redirects every old-site URL to one landing page on the
 * new site, but keeps the original page in document.referrer. This script
 * sits in a script editor web part on that landing page, matches the
 * referrer against a JSON config of old-path → new-URL mappings, and
 * forwards the visitor to the right page, tagging the destination URL so
 * a script there can tell the visitor what happened.
 *
 * No dependencies, ES5-safe. Config comes from a
 * <script type="application/json" id="classic-redirect-config"> block on
 * the page (see webpart-snippet.html), or window.CLASSIC_REDIRECT_CONFIG.
 */
(function (root) {
  'use strict';

  // ---------- pure matching logic (unit-tested in test.js) ----------

  // "https://host/sites/X/page.aspx?a=1#b" -> "/sites/X/page.aspx"
  function pathOf(url) {
    var s = String(url || '');
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i, ''); // scheme + host
    s = s.replace(/[?#].*$/, '');                          // query + hash
    try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
    return s;
  }

  function trimSlashes(s) {
    return String(s).replace(/^\/+/, '').replace(/\/+$/, '');
  }

  // Part of the referrer path after oldSiteFragment ("" for the fragment
  // itself), or null if the fragment isn't in the referrer.
  function remainderAfterFragment(referrerPath, fragment) {
    var frag = '/' + trimSlashes(fragment).toLowerCase();
    var i = referrerPath.toLowerCase().indexOf(frag);
    if (i === -1) return null;
    var after = referrerPath.slice(i + frag.length);
    // "/FCU" must not match "/FCU-other"
    if (after && after.charAt(0) !== '/') return null;
    return trimSlashes(after);
  }

  // Case- and slash-insensitive key lookup. Returns the mapped value, or
  // null when the key isn't in the table.
  function lookup(redirects, remainder) {
    var want = remainder.toLowerCase();
    for (var key in redirects) {
      if (Object.prototype.hasOwnProperty.call(redirects, key) &&
          trimSlashes(key).toLowerCase() === want) {
        return redirects[key];
      }
    }
    return null;
  }

  // Absolute URLs pass through; everything else is relative to newSiteBase.
  function resolveDestination(config, dest) {
    if (/^https?:\/\//i.test(dest)) return dest;
    return String(config.newSiteBase || '').replace(/\/+$/, '') +
      '/' + trimSlashes(dest);
  }

  // "https://host/x" -> "https://host"; relative URLs -> "".
  function originOf(url) {
    var m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)/i.exec(String(url || ''));
    return m ? (m[1] + '://' + m[2]).toLowerCase() : '';
  }

  // Same page = same path, and same origin when both sides carry one — an
  // absolute destination on another host may legitimately share our path.
  function isSamePage(target, currentUrl) {
    var targetOrigin = originOf(target);
    var currentOrigin = originOf(currentUrl);
    if (targetOrigin && currentOrigin && targetOrigin !== currentOrigin) {
      return false;
    }
    return pathOf(target).toLowerCase() === pathOf(currentUrl).toLowerCase();
  }

  // Tag the destination so its page can detect the redirect:
  //   ?classicRedirect=1&classicRedirectFrom=<old server-relative path>
  function addSignal(url, config, fromPath) {
    var param = config.signalParam || 'classicRedirect';
    var hash = '';
    var hashAt = url.indexOf('#');
    if (hashAt !== -1) { hash = url.slice(hashAt); url = url.slice(0, hashAt); }
    url += (url.indexOf('?') === -1 ? '?' : '&') + param + '=1';
    if (fromPath) {
      url += '&' + param + 'From=' + encodeURIComponent(fromPath);
    }
    return url + hash;
  }

  // Returns null when the config is usable, otherwise a message describing
  // the first problem found. A bad config aborts the redirect entirely
  // rather than guessing — silent misroutes look like unmapped referrers.
  function validateConfig(config) {
    if (!config || typeof config !== 'object') {
      return 'config must be an object';
    }
    if (typeof config.oldSiteFragment !== 'string' ||
        !trimSlashes(config.oldSiteFragment)) {
      return 'oldSiteFragment must be a non-empty string';
    }
    if (config.newSiteBase !== undefined &&
        typeof config.newSiteBase !== 'string') {
      return 'newSiteBase must be a string';
    }
    if (config.fallback !== undefined && typeof config.fallback !== 'string') {
      return 'fallback must be a string';
    }
    if (config.signalParam !== undefined &&
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(config.signalParam)) {
      return 'signalParam must be letters/digits/_/- starting with a letter';
    }
    if (config.redirects !== undefined) {
      if (!config.redirects || typeof config.redirects !== 'object' ||
          Array.isArray(config.redirects)) {
        return 'redirects must be an object of oldPath -> destination';
      }
      var seen = Object.create(null);
      for (var key in config.redirects) {
        if (!Object.prototype.hasOwnProperty.call(config.redirects, key)) {
          continue;
        }
        if (typeof config.redirects[key] !== 'string') {
          return 'redirect destination for "' + key + '" must be a string';
        }
        // Lookup is case-/slash-insensitive, so these would collide with
        // whichever the for-in loop happens to visit first winning.
        var norm = trimSlashes(key).toLowerCase();
        if (seen[norm]) {
          return 'redirect keys "' + seen[norm] + '" and "' + key +
            '" collide after normalization';
        }
        seen[norm] = key;
      }
    }
    return null;
  }

  // Full URL to redirect to, or null to stay on the current page.
  // currentUrl should be the full href so absolute destinations on another
  // origin aren't mistaken for the current page.
  function resolveRedirect(config, referrer, currentUrl) {
    if (!config || !config.oldSiteFragment || !referrer) return null;

    var refPath = pathOf(referrer);
    var remainder = remainderAfterFragment(refPath, config.oldSiteFragment);
    if (remainder === null) return null; // not old-site traffic

    var dest = lookup(config.redirects || {}, remainder);
    // A classic welcome page ("NWWSH/default.aspx") counts as its folder.
    if (dest === null && /(^|\/)default\.aspx$/i.test(remainder)) {
      dest = lookup(config.redirects || {},
        trimSlashes(remainder.replace(/default\.aspx$/i, '')));
    }
    if (dest === null && config.fallback) dest = config.fallback;
    if (dest === null || dest === undefined) return null;

    var url = resolveDestination(config, dest);
    // Never redirect the landing page to itself.
    if (currentUrl && isSamePage(url, currentUrl)) {
      return null;
    }
    return addSignal(url, config, refPath);
  }

  // ---------- browser wiring ----------

  function readConfig(doc) {
    var el = doc.getElementById('classic-redirect-config');
    if (el) {
      try {
        return JSON.parse(el.textContent || el.innerText);
      } catch (e) {
        if (root.console) {
          root.console.error('classic-redirect: config JSON is invalid', e);
        }
        return null;
      }
    }
    return root.CLASSIC_REDIRECT_CONFIG || null;
  }

  function run() {
    var config = readConfig(root.document);
    if (!config) return;
    var problem = validateConfig(config);
    if (problem) {
      if (root.console) {
        root.console.error('classic-redirect: bad config — ' + problem);
      }
      return;
    }
    var target = resolveRedirect(
      config, root.document.referrer, root.location.href);
    // replace() keeps the landing page out of Back-button history.
    if (target) root.location.replace(target);
  }

  var api = {
    resolveRedirect: resolveRedirect,
    validateConfig: validateConfig,
    pathOf: pathOf,
    run: run
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // node, for test.js
  } else {
    root.classicRedirect = api;
    run();
  }
})(typeof window !== 'undefined' ? window : this);
