const LOG_PREFIX = "[intl]";
const VERSION = "1.11";

console.log(`${LOG_PREFIX} ${VERSION} Loaded`);
console.log(`${LOG_PREFIX} Last modified: 2026/09/18 12:30:14
  `);

/**
 * @fileoverview intl — bilingual EN/FR string swapper for SharePoint pages.
 * @version = 1.1
 *
 * One dictionary holds both languages side by side (see strings.js). HTML
 * is marked up with data-intl attributes; script code calls intl.t(). No
 * dependencies, no build step — safe to paste into a Script Editor /
 * Content Editor web part. Exposes a single global: window.intl.
 *
 * Features:
 * - Keyed dictionary tier (data-intl / data-intl-html / data-intl-attr) backed by strings.js
 * - Quick inline tier (data-fr / data-fr-*, intl.t(en, fr)) for widgets with no dictionary
 * - Dual-DOM tier (lang="en"/"fr" blocks, see lang-blocks.css) for whole translated sections
 * - Optional Alpine.js integration ($t magic + intl store), auto-wired when Alpine is present
 * - Locale-bound Intl.NumberFormat / Intl.DateTimeFormat bridges
 * - JSON vendor round-trip via intl.load() and intl.addMessages()
 *
 * @author jzapert; FCU Portal Team; TBD
 * @created Created: 2026/08/01 00:00:00
 * @lastmodified Last modified: 2026/09/18 00:00:00
 *
 * @example
 * // Keyed tier
 * <h1 data-intl="app.title">Client Onboarding</h1>
 * intl.setLang('fr');
 *
 * @example
 * // Quick inline tier, no dictionary
 * intl.t('Save', 'Enregistrer');
 *
 * @notes
 * - Markup contract — keyed tier (bigger apps, strings live in strings.js):
 *     data-intl="key"                          -> element textContent
 *     data-intl-html="key"                     -> element innerHTML (trusted strings only)
 *     data-intl-attr="placeholder:key;title:key2" -> named attributes
 * - Quick tier (little widgets — no dictionary, no keys):
 *     <button data-fr="Rechercher">Search</button>   inline FR beside the EN
 *     data-fr-placeholder / -title / -alt / -value / -aria-label   for attributes
 *     intl.t('Save', 'Enregistrer')                   inline pair in script
 *     <span data-intl>Search</span>                   valueless: the EN text IS the
 *         dictionary key (gettext style, flat entries: { 'Search': 'Rechercher' })
 * - Dual-DOM tier (whole blocks per language — see lang-blocks.css):
 *     <section lang="en">…</section><section lang="fr">…</section>
 *     CSS hides the block not matching <html lang>; apply() only steps in
 *     to keep form controls in the hidden block from submitting.
 * - Alpine.js (optional, auto-wired when Alpine is present):
 *     anywhere Alpine owns the text, use $t instead of data-intl —
 *     <span x-text="$t('Save', 'Enregistrer')"></span> — it re-evaluates
 *     on language flip, including x-if / x-for template content.
 *     Load this file above the Alpine <script> tag.
 */

(function (global) {
  'use strict';

  var DEFAULT_LANG = 'en';
  var SUPPORTED = ['en', 'fr'];

  /**
   * Detects the current page language using available SharePoint and page signals.
   *
   * Detection order:
   * 1. Explicit ?lang= query-string parameter
   * 2. SharePoint current UI culture
   * 3. French Site Pages URL path
   * 4. Document language
   * 5. Language-toggle state
   * 6. Default language
   *
   * @returns {'en'|'fr'} The detected supported language.
   */

  
  function detectLang() {
    console.log(`${LOG_PREFIX} ${VERSION} detectLang() starting`);

    var queryLanguage = new URLSearchParams(global.location.search)
      .get('lang')
      ?.trim()
      .toLowerCase()
      .slice(0, 2);

    console.log(
      `${LOG_PREFIX} ${VERSION} Query string lang = ${
      queryLanguage || '(none)'
    }`
    );

    if (SUPPORTED.indexOf(queryLanguage) !== -1) {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language detected from query string: ${queryLanguage}`
      );
      return queryLanguage;
    }

    console.log(
      `${LOG_PREFIX} ${VERSION} Query string language not supported or missing`
    );

    var sharePointLanguage =
      global._spPageContextInfo &&
      global._spPageContextInfo.currentUICultureName ?
      String(global._spPageContextInfo.currentUICultureName)
      .trim()
      .toLowerCase()
      .slice(0, 2) :
      null;

    var toggleButton = global.document.querySelector(
      '#LanguageToggle button'
    );

    if (!toggleButton) {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language toggle button not found. Running late detection loop`
      );
      waitForLanguageToggle(0);
    }

    console.log(
      `${LOG_PREFIX} ${VERSION} Language toggle button found = ${!!toggleButton}`
    );

    var toggleLanguage = toggleButton?.textContent
      ?.trim()
      .toLowerCase();

    console.log(
      `${LOG_PREFIX} ${VERSION} Language toggle text = ${
      toggleLanguage || '(not available)'
    }`
    );

    if (toggleLanguage === 'fr') {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language detected from toggle button: fr`
      );
      return 'fr';
    }

    if (toggleLanguage === 'en') {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language detected from toggle button: en`
      );
      return 'en';
    }


    var pathname = global.location.pathname.toLowerCase();

    console.log(
      `${LOG_PREFIX} ${VERSION} Pathname = ${pathname}`
    );

    if (pathname.indexOf('/sites/tando-fcu/sitepages/fr/') === 0) {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language detected from French Site Pages path`
      );
      return 'fr';
    }

    console.log(
      `${LOG_PREFIX} ${VERSION} French Site Pages path not detected`
    );

    console.log(
      `${LOG_PREFIX} ${VERSION} SharePoint currentUICultureName = ${
      sharePointLanguage || '(not available)'
    }`
    );

    if (SUPPORTED.indexOf(sharePointLanguage) !== -1) {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language detected from SharePoint culture: ${sharePointLanguage}`
      );
      return sharePointLanguage;
    }

    console.log(
      `${LOG_PREFIX} ${VERSION} SharePoint culture not supported or unavailable`
    );

    var documentLanguage = global.document.documentElement.lang
      ?.trim()
      .toLowerCase()
      .slice(0, 2);

    console.log(
      `${LOG_PREFIX} ${VERSION} Document html lang = ${
      documentLanguage || '(not set)'
    }`
    );

    if (SUPPORTED.indexOf(documentLanguage) !== -1) {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language detected from html lang attribute: ${documentLanguage}`
      );
      return documentLanguage;
    }

    console.log(
      `${LOG_PREFIX} ${VERSION} Document language not supported or missing`
    );

    console.log(
      `${LOG_PREFIX} ${VERSION} No language signals matched. Falling back to default language: ${DEFAULT_LANG}`
    );

    return DEFAULT_LANG;
  }

  var current = detectLang();

  console.log(
    `${LOG_PREFIX} ${VERSION} Final detected language: ${current}`
  );

  var current = detectLang();
  console.log(LOG_PREFIX + " Detected language: " + current);
  var messages = {};
  var missing = {};
  var listeners = [];

  /**
   * Merges a dictionary of translated strings into the in-memory message
   * table, resolving any pending "missing translation" records it fills in.
   *
   * addMessages(dict)         entries: { 'key': { en: '…', fr: '…' } }
   *                           or flat gettext: { 'English': 'Français' }
   * addMessages(dict, 'fr')   per-language file: { 'key': 'Français' } —
   *                           merged into existing entries, so a vendor's
   *                           fr.json completes keys authored EN-first.
   *
   * @param {Object<string, (string|Object)>} dict - Dictionary of strings/entries to merge
   * @param {'en'|'fr'} [lang] - Target language when dict is a flat per-language file
   * @returns {void}
   */
  function addMessages(dict, lang) {
    for (var key in dict) {
      if (!Object.prototype.hasOwnProperty.call(dict, key)) continue;
      if (lang) {
        var entry = messages[key];
        if (typeof entry === 'string') entry = {
          en: key,
          fr: entry
        };
        if (!entry) entry = {};
        entry[lang] = dict[key];
        messages[key] = entry;
      } else {
        messages[key] = dict[key];
      }
      // A translation arriving late (vendor JSON) resolves its pending-
      // translation record, so report() reflects what's still missing NOW.
      var resolved = messages[key];
      if (typeof resolved === 'string') resolved = {
        en: key,
        fr: resolved
      };
      for (var i = 0; i < SUPPORTED.length; i++) {
        if (resolved[SUPPORTED[i]] != null && resolved[SUPPORTED[i]] !== '') {
          delete missing[key + '|' + SUPPORTED[i]];
        }
      }
    }
    console.log(LOG_PREFIX + " addMessages: merged " + Object.keys(dict).length + " key(s)" + (lang ? " for lang=" + lang : ""));
  }

  /**
   * Fetches a JSON dictionary (e.g. straight from the translation vendor),
   * merges it, and re-swaps the page. Same-origin URL, e.g. Site Assets.
   *
   *   intl.load('strings.json', done)          full { key: {en, fr} } file
   *   intl.load('strings.fr.json', 'fr', done) per-language { key: 'fr' } file
   *
   * done(err) is optional. Strings arriving after first paint re-apply
   * automatically and onChange listeners fire so script-rendered text
   * refreshes too.
   *
   * @param {string} url - Same-origin URL of the JSON dictionary to fetch
   * @param {('en'|'fr'|Function)} [lang] - Target language for a per-language file, or the done callback
   * @param {Function} [done] - Optional callback invoked as done(err)
   * @returns {void}
   */
  function load(url, lang, done) {
    if (typeof lang === 'function') {
      done = lang;
      lang = undefined;
    }
    var xhr = new global.XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var ok = (xhr.status >= 200 && xhr.status < 300) ||
        (xhr.status === 0 && xhr.responseText); // file://
      var err = null;
      if (ok) {
        try {
          addMessages(JSON.parse(xhr.responseText), lang);
          apply();
          for (var i = 0; i < listeners.length; i++) listeners[i](current);
          console.log(LOG_PREFIX + " load: merged " + url + " successfully");
        } catch (e) {
          err = e;
        }
      } else {
        err = new Error('intl.load: ' + url + ' -> HTTP ' + xhr.status);
      }
      if (done) done(err);
      else if (err) console.error(LOG_PREFIX + " load failed: " + err.message);
    };
    xhr.send();
  }

  /**
   * Records a key/language pair as pending translation for report().
   *
   * @param {string} key - Dictionary key (or EN text, in gettext-style usage)
   * @param {'en'|'fr'} lang - Language that is missing a translation
   * @returns {void}
   */
  function noteMissing(key, lang) {
    missing[key + '|' + lang] = {
      key: key,
      lang: lang
    };
  }

  /**
   * Resolves a dictionary key to its string for the given language, falling
   * back to English (and recording the gap via noteMissing) when the
   * translation is absent.
   *
   * @param {string} key - Dictionary key to resolve
   * @param {'en'|'fr'} lang - Language to resolve the string for
   * @returns {?string} The resolved string, or null if no entry exists at all
   */
  function lookup(key, lang) {
    var entry = messages[key];
    if (entry == null) {
      // Absent entry is only "missing" in FR: in gettext-style usage the
      // EN text is the key, so EN never needs an entry at all.
      if (lang !== DEFAULT_LANG) noteMissing(key, lang);
      return null;
    }
    if (typeof entry === 'string') {
      // Flat gettext-style entry: key is the English, value is the French.
      entry = {
        en: key,
        fr: entry
      };
    }
    if (entry[lang] == null || entry[lang] === '') {
      noteMissing(key, lang);
      // English-first workflow: an untranslated key falls back to EN
      // instead of rendering blank.
      return entry[DEFAULT_LANG] != null ? entry[DEFAULT_LANG] : null;
    }
    return entry[lang];
  }

  /**
   * Interpolates {token} placeholders in a resolved string with values from
   * params.
   *
   * @param {string} str - String containing {token} placeholders
   * @param {Object<string, *>} params - Values keyed by token name
   * @returns {string} The interpolated string
   */
  function format(str, params) {
    return str.replace(/\{(\w+)\}/g, function (token, name) {
      return params[name] != null ? params[name] : token;
    });
  }

  /**
   * Resolves and (optionally) interpolates a translated string. Signatures:
   *
   *   t('dict.key')                       keyed lookup
   *   t('dict.key', {n: 3})               keyed lookup + interpolation
   *   t('Save', 'Enregistrer')            inline EN/FR pair, no dictionary
   *   t('{n} items', '{n} éléments', {n}) inline pair + interpolation
   *
   * @param {string} key - Dictionary key, or the inline EN string
   * @param {(string|Object<string, *>)} [a] - Inline FR string, or interpolation params for a keyed lookup
   * @param {Object<string, *>} [b] - Interpolation params when using the inline EN/FR form
   * @returns {string} The resolved (and interpolated) string for the active language
   */
  function t(key, a, b) {
    var params = a;
    var str;
    if (typeof a === 'string') {
      str = (current === 'fr' && a) ? a : key;
      params = b;
    } else {
      str = lookup(key, current);
      if (str == null) {
        str = key; // last resort: show the key/English, never a blank
      }
    }
    return params ? format(str, params) : str;
  }

  /* -----------------------------------------------------------
     Locale-bound Intl bridges
  ----------------------------------------------------------- */

  /*
   * Locale-bound bridges to the built-in Intl (capital I) formatters:
   * intl.NumberFormat(opts) / intl.DateTimeFormat(opts) return native
   * formatters pinned to the active language's locale, so page code
   * never computes a locale string. Works with or without `new`.
   * Reach for capital-I Intl directly only to format in a locale other
   * than the active one.
   */

  /**
   * Returns the BCP-47 locale string for the active language.
   *
   * @returns {('en-CA'|'fr-CA')} The active locale
   */
  function locale() {
    return current === 'fr' ? 'fr-CA' : 'en-CA';
  }

  /**
   * Native Intl.NumberFormat pinned to the active language's locale.
   *
   * @param {Object} [opts] - Options passed through to Intl.NumberFormat
   * @returns {Intl.NumberFormat} A locale-aware number formatter
   */
  function NumberFormat(opts) {
    return new global.Intl.NumberFormat(locale(), opts);
  }

  /**
   * Native Intl.DateTimeFormat pinned to the active language's locale.
   *
   * @param {Object} [opts] - Options passed through to Intl.DateTimeFormat
   * @returns {Intl.DateTimeFormat} A locale-aware date/time formatter
   */
  function DateTimeFormat(opts) {
    return new global.Intl.DateTimeFormat(locale(), opts);
  }

  function each(nodeList, fn) {
    for (var i = 0; i < nodeList.length; i++) fn(nodeList[i]);
  }

  /**
   * Walks the DOM (or a given subtree) and swaps in the active language's
   * strings for every data-intl / data-fr / data-intl-html / data-intl-attr
   * node, plus the dual-DOM [lang] blocks. Called by setLang(), load(), and
   * by the page itself on first paint after strings.js is loaded.
   *
   * @param {(Document|Element)} [root] - Subtree to re-apply; defaults to the whole document
   * @returns {void}
   */
  function apply(root) {
    var doc = global.document;
    var scope = root || doc;
    console.log(LOG_PREFIX + " apply: swapping strings for " + (root ? "subtree" : "document") + " (lang=" + current + ")");

    each(scope.querySelectorAll('[data-intl]'), function (el) {
      // Valueless data-intl: the element's own English text is the key.
      // Captured once so re-applying after a swap still finds it.
      var key = el.getAttribute('data-intl') || el.__intlKey ||
        (el.__intlKey = el.textContent.trim());
      el.textContent = t(key);
    });

    each(scope.querySelectorAll('[data-fr]'), function (el) {
      if (!el.hasAttribute('data-en')) {
        el.setAttribute('data-en', el.textContent);
      }
      el.textContent = el.getAttribute(current === 'fr' ? 'data-fr' : 'data-en');
    });

    each(scope.querySelectorAll(
      '[data-fr-placeholder],[data-fr-title],[data-fr-alt],[data-fr-value],[data-fr-aria-label]'
    ), function (el) {
      var names = [];
      for (var i = 0; i < el.attributes.length; i++) {
        var m = /^data-fr-(.+)$/.exec(el.attributes[i].name);
        if (m) names.push(m[1]);
      }
      for (var j = 0; j < names.length; j++) {
        var name = names[j];
        if (!el.hasAttribute('data-en-' + name)) {
          el.setAttribute('data-en-' + name, el.getAttribute(name) || '');
        }
        el.setAttribute(name,
          el.getAttribute((current === 'fr' ? 'data-fr-' : 'data-en-') + name));
      }
    });

    each(scope.querySelectorAll('[data-fr-html]'), function (el) {
      if (!el.hasAttribute('data-en-html')) {
        el.setAttribute('data-en-html', el.innerHTML);
      }

      el.innerHTML = el.getAttribute(
        current === 'fr' ? 'data-fr-html' : 'data-en-html'
      );
    });

    each(scope.querySelectorAll('[data-intl-html]'), function (el) {
      el.innerHTML = t(el.getAttribute('data-intl-html'));
    });

    each(scope.querySelectorAll('[data-intl-attr]'), function (el) {
      var pairs = el.getAttribute('data-intl-attr').split(';');
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split(':');
        if (pair.length === 2) {
          el.setAttribute(pair[0].trim(), t(pair[1].trim()));
        }
      }
    });

    // Dual-DOM blocks (lang-blocks.css hides the inactive one): keep form
    // controls inside the hidden block from submitting or catching focus.
    each(scope.querySelectorAll('[lang="en"], [lang="fr"]'), function (block) {
      if (block === doc.documentElement) return;
      if (/(^|\s)lang-keep(\s|$)/.test(block.getAttribute('class') || '')) return;
      var inactive = block.getAttribute('lang') !== current;
      each(block.querySelectorAll('input, select, textarea, button'), function (c) {
        if (inactive) {
          if (!c.disabled) {
            c.disabled = true;
            c.__intlDisabled = true; // only re-enable what we disabled
          }
        } else if (c.__intlDisabled) {
          c.disabled = false;
          c.__intlDisabled = false;
        }
      });
    });

    if (!root) {
      // Screen readers key pronunciation off this; keep it truthful.
      doc.documentElement.lang = current;
    }
  }

function waitForLanguageToggle(attempt) {

    var button = global.document.querySelector('#LanguageToggle button');

    if (button) {
      var detected = detectLang();

      if (detected !== current) {
        console.log(
          `${LOG_PREFIX} ${VERSION} Late language detection: ${current} -> ${detected}`
        );

        current = detected;
        apply();
      }

      return;
    }

    if (attempt >= 20) {
      console.log(
        `${LOG_PREFIX} ${VERSION} Language toggle never appeared`
      );
      return;
    }

    setTimeout(function () {
      waitForLanguageToggle(attempt + 1);
    }, 250);

  }

  /**
   * Switches the active language, re-applies the DOM, syncs the ?lang= URL
   * param (so a reload stays on the chosen language), and notifies onChange
   * listeners. No-op if lang is unsupported or already active.
   *
   * @param {'en'|'fr'} lang - Language to switch to
   * @returns {void}
   */
  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current) return;
    console.log(LOG_PREFIX + " setLang: " + current + " -> " + lang);
    current = lang;
    apply();
    try {
      // Keep the (placeholder) detection source in sync so a reload
      // stays in the chosen language.
      var url = new global.URL(global.location.href);
      url.searchParams.set('lang', lang);
      global.history.replaceState(null, '', url.toString());
    } catch (e) {
      console.warn(LOG_PREFIX + " setLang: URL API unavailable — reload would fall back to detection");
    }
    for (var i = 0; i < listeners.length; i++) listeners[i](current);
  }

  /**
   * @returns {('en'|'fr')} The currently active language
   */
  function getLang() {
    return current;
  }

  /**
   * Registers a callback fired whenever the active language changes
   * (via setLang), so script-rendered UI can re-render.
   *
   * @param {function(('en'|'fr')): void} cb - Callback invoked with the new language
   * @returns {void}
   */
  function onChange(cb) {
    listeners.push(cb);
  }

  /**
   * Logs (and returns) the pending-translation report for the
   * circle-back-with-French step: every key/language pair requested but
   * never resolved to a real translation.
   *
   * @returns {Array<{key: string, lang: string}>} Rows of missing translations
   */
  function report() {
    var rows = [];
    for (var k in missing) {
      if (Object.prototype.hasOwnProperty.call(missing, k)) rows.push(missing[k]);
    }
    if (rows.length === 0) {
      console.log(LOG_PREFIX + " report: no missing translations encountered.");
    } else if (console.table) {
      console.table(rows);
    } else {
      console.log(LOG_PREFIX + " report: missing translations:", rows);
    }
    return rows;
  }

  /**
   * Alpine.js integration — first-class but fully guarded: with no Alpine
   * on the page this is inert. Registers an 'intl' store plus a $t magic
   * that reads it, so Alpine expressions using $t re-evaluate on language
   * flip (including x-if / x-for template content apply() never sees).
   * Handles either load order: Alpine after us fires alpine:init; Alpine
   * already present gets wired immediately.
   *
   * @param {Object} Alpine - The global Alpine instance, if present
   * @returns {void}
   */
  var alpineWired = false;

  function wireAlpine(Alpine) {
    if (alpineWired || !Alpine || !Alpine.store || !Alpine.magic) return;
    alpineWired = true;
    console.log(LOG_PREFIX + " wireAlpine: Alpine detected, registering intl store and $t magic");
    Alpine.store('intl', {
      lang: current
    });
    onChange(function (lang) {
      Alpine.store('intl').lang = lang;
    });
    Alpine.magic('t', function () {
      return function (key, a, b) {
        void Alpine.store('intl').lang; // reactive dependency on the language
        return t(key, a, b);
      };
    });
  }
  global.document.addEventListener('alpine:init', function () {
    wireAlpine(global.Alpine);
  });
  wireAlpine(global.Alpine);

  global.intl = {
    t: t,
    apply: apply,
    setLang: setLang,
    getLang: getLang,
    locale: locale,
    NumberFormat: NumberFormat,
    DateTimeFormat: DateTimeFormat,
    addMessages: addMessages,
    load: load,
    onChange: onChange,
    report: report
  };
})(window);
