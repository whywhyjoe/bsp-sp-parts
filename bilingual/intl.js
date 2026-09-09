/*
 * intl — bilingual EN/FR string swapper for SharePoint pages.
 *
 * One dictionary holds both languages side by side (see strings.js).
 * HTML is marked up with data-intl attributes; script code calls intl.t().
 * No dependencies, no build step — safe to paste into a Script Editor /
 * Content Editor web part. Exposes a single global: window.intl.
 *
 * Markup contract — keyed tier (bigger apps, strings live in strings.js):
 *   data-intl="key"                          -> element textContent
 *   data-intl-html="key"                     -> element innerHTML (trusted strings only)
 *   data-intl-attr="placeholder:key;title:key2" -> named attributes
 *
 * Quick tier (little widgets — no dictionary, no keys):
 *   <button data-fr="Rechercher">Search</button>   inline FR beside the EN
 *   data-fr-placeholder / -title / -alt / -value / -aria-label   for attributes
 *   intl.t('Save', 'Enregistrer')                   inline pair in script
 *   <span data-intl>Search</span>                   valueless: the EN text IS the
 *       dictionary key (gettext style, flat entries: { 'Search': 'Rechercher' })
 *
 * Dual-DOM tier (whole blocks per language — see lang-blocks.css):
 *   <section lang="en">…</section><section lang="fr">…</section>
 *   CSS hides the block not matching <html lang>; apply() only steps in
 *   to keep form controls in the hidden block from submitting.
 *
 * Alpine.js (optional, auto-wired when Alpine is present):
 *   anywhere Alpine owns the text, use $t instead of data-intl —
 *   <span x-text="$t('Save', 'Enregistrer')"></span> — it re-evaluates
 *   on language flip, including x-if / x-for template content.
 *   Load this file above the Alpine <script> tag.
 */
(function (global) {
  'use strict';

  var DEFAULT_LANG = 'en';
  var SUPPORTED = ['en', 'fr'];

  /*
   * TODO(joe): PLACEHOLDER detection — ?lang=fr URL param only.
   * Swap this function's body for the real multi-layer SP detection
   * (URL param -> URL infix -> switcher state, plus
   * _spPageContextInfo.currentUICultureName) — nothing else in the file
   * cares how the language was decided. Porting checklist in README
   * ("Plugging in real language detection"): the dual-DOM head snippet
   * and setLang()'s URL write-back must stay in lockstep with this.
   */
  function detectLang() {
    var m = /[?&]lang=([A-Za-z-]+)/.exec(global.location.search);
    var lang = m ? m[1].toLowerCase().slice(0, 2) : DEFAULT_LANG;
    return SUPPORTED.indexOf(lang) !== -1 ? lang : DEFAULT_LANG;
  }

  var current = detectLang();
  var messages = {};   // key -> { en: '...', fr: '...' }
  var missing = {};    // 'key|lang' -> { key, lang } — pending-translation log
  var listeners = [];

  /*
   * addMessages(dict)         entries: { 'key': { en: '…', fr: '…' } }
   *                           or flat gettext: { 'English': 'Français' }
   * addMessages(dict, 'fr')   per-language file: { 'key': 'Français' } —
   *                           merged into existing entries, so a vendor's
   *                           fr.json completes keys authored EN-first.
   */
  function addMessages(dict, lang) {
    for (var key in dict) {
      if (!Object.prototype.hasOwnProperty.call(dict, key)) continue;
      if (lang) {
        var entry = messages[key];
        if (typeof entry === 'string') entry = { en: key, fr: entry };
        if (!entry) entry = {};
        entry[lang] = dict[key];
        messages[key] = entry;
      } else {
        messages[key] = dict[key];
      }
      // A translation arriving late (vendor JSON) resolves its pending-
      // translation record, so report() reflects what's still missing NOW.
      var resolved = messages[key];
      if (typeof resolved === 'string') resolved = { en: key, fr: resolved };
      for (var i = 0; i < SUPPORTED.length; i++) {
        if (resolved[SUPPORTED[i]] != null && resolved[SUPPORTED[i]] !== '') {
          delete missing[key + '|' + SUPPORTED[i]];
        }
      }
    }
  }

  /*
   * Fetch a JSON dictionary (e.g. straight from the translation vendor),
   * merge it, and re-swap the page. Same-origin URL, e.g. Site Assets.
   *   intl.load('strings.json', done)          full { key: {en, fr} } file
   *   intl.load('strings.fr.json', 'fr', done) per-language { key: 'fr' } file
   * done(err) is optional. Strings arriving after first paint re-apply
   * automatically and onChange listeners fire so script-rendered text
   * refreshes too.
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
        } catch (e) {
          err = e;
        }
      } else {
        err = new Error('intl.load: ' + url + ' -> HTTP ' + xhr.status);
      }
      if (done) done(err);
      else if (err && global.console) global.console.error(err);
    };
    xhr.send();
  }

  function noteMissing(key, lang) {
    missing[key + '|' + lang] = { key: key, lang: lang };
  }

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
      entry = { en: key, fr: entry };
    }
    if (entry[lang] == null || entry[lang] === '') {
      noteMissing(key, lang);
      // English-first workflow: an untranslated key falls back to EN
      // instead of rendering blank.
      return entry[DEFAULT_LANG] != null ? entry[DEFAULT_LANG] : null;
    }
    return entry[lang];
  }

  function format(str, params) {
    return str.replace(/\{(\w+)\}/g, function (token, name) {
      return params[name] != null ? params[name] : token;
    });
  }

  /*
   * t('dict.key')                       keyed lookup
   * t('dict.key', {n: 3})               keyed lookup + interpolation
   * t('Save', 'Enregistrer')            inline EN/FR pair, no dictionary
   * t('{n} items', '{n} éléments', {n}) inline pair + interpolation
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

  /*
   * Locale-bound bridges to the built-in Intl (capital I) formatters:
   * intl.NumberFormat(opts) / intl.DateTimeFormat(opts) return native
   * formatters pinned to the active language's locale, so page code
   * never computes a locale string. Works with or without `new`.
   * Reach for capital-I Intl directly only to format in a locale other
   * than the active one.
   */
  function locale() {
    return current === 'fr' ? 'fr-CA' : 'en-CA';
  }

  function NumberFormat(opts) {
    return new global.Intl.NumberFormat(locale(), opts);
  }

  function DateTimeFormat(opts) {
    return new global.Intl.DateTimeFormat(locale(), opts);
  }

  function each(nodeList, fn) {
    for (var i = 0; i < nodeList.length; i++) fn(nodeList[i]);
  }

  function apply(root) {
    var doc = global.document;
    var scope = root || doc;

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

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current) return;
    current = lang;
    apply();
    try {
      // Keep the (placeholder) detection source in sync so a reload
      // stays in the chosen language.
      var url = new global.URL(global.location.href);
      url.searchParams.set('lang', lang);
      global.history.replaceState(null, '', url.toString());
    } catch (e) { /* URL API unavailable — reload would fall back to detection */ }
    for (var i = 0; i < listeners.length; i++) listeners[i](current);
  }

  function getLang() {
    return current;
  }

  function onChange(cb) {
    listeners.push(cb);
  }

  /* Pending-translation report for the circle-back-with-French step. */
  function report() {
    var rows = [];
    for (var k in missing) {
      if (Object.prototype.hasOwnProperty.call(missing, k)) rows.push(missing[k]);
    }
    if (global.console) {
      if (rows.length === 0) {
        global.console.log('intl: no missing translations encountered.');
      } else if (global.console.table) {
        global.console.table(rows);
      } else {
        global.console.log('intl missing translations:', rows);
      }
    }
    return rows;
  }

  /*
   * Alpine.js integration — first-class but fully guarded: with no Alpine
   * on the page this is inert. Registers an 'intl' store plus a $t magic
   * that reads it, so Alpine expressions using $t re-evaluate on language
   * flip (including x-if / x-for template content apply() never sees).
   * Handles either load order: Alpine after us fires alpine:init; Alpine
   * already present gets wired immediately.
   */
  var alpineWired = false;
  function wireAlpine(Alpine) {
    if (alpineWired || !Alpine || !Alpine.store || !Alpine.magic) return;
    alpineWired = true;
    Alpine.store('intl', { lang: current });
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
