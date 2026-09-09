// node test.js — stdlib-only tests: pure matching logic, config validation,
// snippet/config drift, and the browser wiring run in a vm sandbox.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var cr = require('./classic-redirect.js');

function readHere(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

var config = {
  oldSiteFragment: '/sites/TandO-Classic/FCU',
  newSiteBase: '/sites/TandO-FCU',
  redirects: {
    '': 'SitePages/Home.aspx',
    'NWWSH': 'SitePages/NWWSH.aspx',
    'NWWSH/blah.aspx': 'SitePages/NWWSH-Blah.aspx',
    'Training': 'https://contoso.sharepoint.com/sites/Other/Training.aspx'
  }
};
var OLD = 'https://contoso.sharepoint.com/sites/TandO-Classic/FCU';
var HERE = 'https://contoso.sharepoint.com/sites/TandO-FCU/SitePages/Landing.aspx';

function resolves(referrer, expected, cfg) {
  assert.strictEqual(cr.resolveRedirect(cfg || config, referrer, HERE), expected,
    'referrer: ' + referrer);
}

// No referrer / referrer outside the old site -> stay put.
resolves('', null);
resolves('https://contoso.sharepoint.com/sites/SomethingElse/page.aspx', null);
// Fragment must match a whole path segment, not a prefix.
resolves('https://contoso.sharepoint.com/sites/TandO-Classic/FCU-other/x.aspx', null);

// Section (no page name) vs specific page, per the NWWSH example.
resolves(OLD + '/NWWSH',
  '/sites/TandO-FCU/SitePages/NWWSH.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH'));
resolves(OLD + '/NWWSH/blah.aspx',
  '/sites/TandO-FCU/SitePages/NWWSH-Blah.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH/blah.aspx'));

// Trailing slash, query strings, and case differences don't matter.
resolves(OLD + '/NWWSH/',
  '/sites/TandO-FCU/SitePages/NWWSH.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH/'));
resolves(OLD.toLowerCase() + '/nwwsh/BLAH.ASPX?tab=2#frag',
  '/sites/TandO-FCU/SitePages/NWWSH-Blah.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/tando-classic/fcu/nwwsh/BLAH.ASPX'));

// The classic welcome page counts as its folder.
resolves(OLD + '/NWWSH/default.aspx',
  '/sites/TandO-FCU/SitePages/NWWSH.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH/default.aspx'));

// The old site root itself maps via the "" key.
resolves(OLD,
  '/sites/TandO-FCU/SitePages/Home.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU'));

// Absolute destinations pass through untouched (aside from the signal).
resolves(OLD + '/Training',
  'https://contoso.sharepoint.com/sites/Other/Training.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/Training'));

// Unmapped old page: null without a fallback, fallback when configured.
resolves(OLD + '/no-such-page.aspx', null);
var withFallback = JSON.parse(JSON.stringify(config));
withFallback.fallback = 'SitePages/Migration-Info.aspx?src=old';
resolves(OLD + '/no-such-page.aspx',
  '/sites/TandO-FCU/SitePages/Migration-Info.aspx?src=old&classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/no-such-page.aspx'),
  withFallback);

// A custom signalParam is used for both query params.
var renamed = JSON.parse(JSON.stringify(config));
renamed.signalParam = 'wasClassic';
resolves(OLD + '/NWWSH',
  '/sites/TandO-FCU/SitePages/NWWSH.aspx?wasClassic=1&wasClassicFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH'),
  renamed);

// Never redirect the landing page to itself — relative or same-origin
// absolute self-maps are suppressed, but an absolute destination on a
// DIFFERENT origin that happens to share our path is a real redirect.
var selfMap = JSON.parse(JSON.stringify(config));
selfMap.redirects['NWWSH'] = 'SitePages/Landing.aspx';
resolves(OLD + '/NWWSH', null, selfMap);
selfMap.redirects['NWWSH'] = HERE;
resolves(OLD + '/NWWSH', null, selfMap);
selfMap.redirects['NWWSH'] =
  'https://other.example/sites/TandO-FCU/SitePages/Landing.aspx';
resolves(OLD + '/NWWSH',
  'https://other.example/sites/TandO-FCU/SitePages/Landing.aspx' +
  '?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH'),
  selfMap);

// ---- validateConfig ----

function invalid(mutate, expected) {
  var bad = JSON.parse(JSON.stringify(config));
  mutate(bad);
  var problem = cr.validateConfig(bad);
  assert.ok(problem && problem.indexOf(expected) !== -1,
    'expected "' + expected + '", got: ' + problem);
}

assert.strictEqual(cr.validateConfig(config), null);
assert.ok(cr.validateConfig(null));
invalid(function (c) { delete c.oldSiteFragment; }, 'oldSiteFragment');
invalid(function (c) { c.newSiteBase = 42; }, 'newSiteBase');
invalid(function (c) { c.fallback = {}; }, 'fallback');
invalid(function (c) { c.signalParam = 'has space'; }, 'signalParam');
invalid(function (c) { c.redirects = ['nope']; }, 'redirects must be');
invalid(function (c) { c.redirects.NWWSH = null; }, 'must be a string');
invalid(function (c) { c.redirects['/nwwsh/'] = 'elsewhere.aspx'; }, 'collide');

// ---- webpart-snippet.html must not drift from redirects.config.json ----

var canonical = JSON.parse(readHere('redirects.config.json'));
var snippet = readHere('webpart-snippet.html');
var embeddedMatch =
  /<script type="application\/json" id="classic-redirect-config">([\s\S]*?)<\/script>/
    .exec(snippet);
assert.ok(embeddedMatch, 'snippet must contain the config JSON block');
assert.deepStrictEqual(JSON.parse(embeddedMatch[1]), canonical,
  'webpart-snippet.html config must match redirects.config.json');
assert.strictEqual(cr.validateConfig(canonical), null,
  'redirects.config.json must be a valid config');

// ---- browser wiring: execute the real script in a vm sandbox ----

function browserRun(opts) {
  var replacedWith = null;
  var errors = [];
  var fakeWindow = {
    document: {
      referrer: opts.referrer,
      getElementById: function (id) {
        return id === 'classic-redirect-config'
          ? { textContent: opts.configText }
          : null;
      }
    },
    location: {
      href: HERE,
      replace: function (url) { replacedWith = url; }
    },
    console: { error: function (msg) { errors.push(msg); } }
  };
  vm.runInNewContext(readHere('classic-redirect.js'), { window: fakeWindow });
  return { replacedWith: replacedWith, errors: errors, window: fakeWindow };
}

var live = browserRun({
  referrer: OLD + '/NWWSH/blah.aspx',
  configText: JSON.stringify(config)
});
assert.strictEqual(live.replacedWith,
  '/sites/TandO-FCU/SitePages/NWWSH-Blah.aspx?classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH/blah.aspx'),
  'browser entry point should redirect via location.replace');
assert.ok(live.window.classicRedirect.resolveRedirect,
  'api should be exposed on window');

var badShape = browserRun({
  referrer: OLD + '/NWWSH',
  configText: JSON.stringify({ oldSiteFragment: '/x', redirects: ['nope'] })
});
assert.strictEqual(badShape.replacedWith, null,
  'invalid config shape must not redirect');
assert.ok(badShape.errors.length, 'invalid config shape must log an error');

var badJson = browserRun({ referrer: OLD + '/NWWSH', configText: '{oops' });
assert.strictEqual(badJson.replacedWith, null,
  'malformed config JSON must not redirect');
assert.ok(badJson.errors.length, 'malformed config JSON must log an error');

// ---- destination notice snippet: execute its script in a vm sandbox ----

function noticeRun(search) {
  var noticeHtml = readHere('destination-notice-snippet.html');
  var script = /<script>([\s\S]*?)<\/script>/.exec(noticeHtml)[1];
  var box = { style: { display: 'none' } };
  var code = { textContent: 'the old site' };
  var replacedState = null;
  var fakeWindow = {
    location: {
      search: search,
      pathname: '/sites/TandO-FCU/SitePages/NWWSH-Blah.aspx',
      hash: ''
    },
    history: {
      replaceState: function (a, b, url) { replacedState = url; }
    }
  };
  vm.runInNewContext(script, {
    window: fakeWindow,
    document: {
      getElementById: function (id) {
        if (id === 'classic-redirect-notice') { return box; }
        if (id === 'classic-redirect-from') { return code; }
        return null;
      }
    }
  });
  return { box: box, code: code, replacedState: replacedState };
}

var shown = noticeRun('?tab=2&classicRedirect=1&classicRedirectFrom=' +
  encodeURIComponent('/sites/TandO-Classic/FCU/NWWSH/blah.aspx'));
assert.strictEqual(shown.box.style.display, 'block', 'notice box should show');
assert.strictEqual(shown.code.textContent,
  '/sites/TandO-Classic/FCU/NWWSH/blah.aspx',
  'notice should show the old path');
assert.strictEqual(shown.replacedState,
  '/sites/TandO-FCU/SitePages/NWWSH-Blah.aspx?tab=2',
  'signal params should be stripped, unrelated params kept');

var notShown = noticeRun('?tab=2');
assert.strictEqual(notShown.box.style.display, 'none',
  'notice box should stay hidden without the signal param');
assert.strictEqual(notShown.replacedState, null,
  'URL should be untouched without the signal param');

console.log('classic-referrer-redirects: all tests passed');
