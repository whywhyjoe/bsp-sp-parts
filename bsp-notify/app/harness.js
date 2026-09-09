// sp-env harness runner — loaded by the harness page's Script Editor Web Part.
// Loads a named op script (provision.js / verify.js / test-*.js) from its own
// library folder, runs it, ALWAYS posts {Suite, Passed, Results, GitSha} to
// TestRuns (success or failure; a failed post fails the run), renders the
// outcome with a "copy results JSON" button (the prod/JSFiddle bridge), and
// signals completion for Playwright via #sp-env-harness-done. Every run gets a
// unique runId that lands in the TestRuns row Title so drivers can correlate
// their own run instead of trusting the latest rows.
// Plain script, no ES modules. PnPjs via window.pnp2 with the setup() line.
(function () {
  'use strict';
  var baseUrl = (function () {
    var src = document.currentScript && document.currentScript.src;
    return src ? src.slice(0, src.lastIndexOf('/')) : null;
  })();

  var root = document.getElementById('sp-env-harness') || (function () {
    var d = document.createElement('div'); d.id = 'sp-env-harness';
    document.body.appendChild(d); return d;
  })();
  root.innerHTML = '<h3>sp-env harness</h3><div id="sp-env-status">loading…</div>' +
    '<div id="sp-env-buttons"></div><pre id="sp-env-out" style="white-space:pre-wrap"></pre>';
  function status(t) { document.getElementById('sp-env-status').textContent = t; }
  function newRunId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  // Modern SP pages run an AMD loader; a UMD bundle injected LATE registers as
  // an anonymous AMD module and never sets window globals (proven on this
  // tenant). Hide define.amd — not define itself — during the load; restore on
  // both success and failure.
  function loadScriptNoAmd(url) {
    return new Promise(function (res, rej) {
      var amd = null;
      if (typeof window.define === 'function' && window.define.amd) {
        amd = window.define.amd;
        try { delete window.define.amd; } catch (e) { window.define.amd = undefined; }
      }
      function restore() { if (amd) { window.define.amd = amd; amd = null; } }
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { restore(); res(); };
      s.onerror = function () { restore(); rej(new Error('failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  // Publish the result: render, expose window.__spEnvResult, set the done
  // marker. ALWAYS reached — including init failures — so drivers never see a
  // timeout where a recorded failure should be.
  function finish(result) {
    window.__spEnvResult = result;
    document.getElementById('sp-env-out').textContent = JSON.stringify(result, null, 2);
    var btn = document.createElement('button');
    btn.textContent = 'copy results JSON';
    btn.onclick = function () { navigator.clipboard.writeText(JSON.stringify(result, null, 2)); };
    root.appendChild(btn);
    var done = document.createElement('div');
    done.id = 'sp-env-harness-done';
    done.setAttribute('data-passed', String(result.passed === true));
    done.setAttribute('data-run-id', result.runId || '');
    root.appendChild(done);
    status((result.passed ? 'PASSED: ' : 'FAILED: ') + result.suite);
  }

  // Post the row; a failed post FAILS the run (the row is the evidence).
  function postTestRun(env, result) {
    if (!window.pnp2) {
      result.results.testRunsPosted = false;
      result.results.testRunsPostError = 'pnp2 unavailable (init failure)';
      result.passed = false;
      return Promise.resolve();
    }
    return window.pnp2.sp.web.lists.getByTitle('TestRuns').items.add({
      Title: result.suite + ' #' + result.runId,
      Suite: result.suite,
      Passed: result.passed === true,
      Results: JSON.stringify(result.results).slice(0, 60000),
      GitSha: env.gitSha || ''
    }).then(function () {
      result.results.testRunsPosted = true;
    }).catch(function (e) {
      result.results.testRunsPosted = false;
      result.results.testRunsPostError = String(e && e.message ? e.message : e);
      result.passed = false;
    });
  }

  function runOp(env, opFile) {
    window.__spEnvOp = null;
    var runId = newRunId();
    status('running ' + opFile + ' (run ' + runId + ') …');
    // Cache-bust the op load: ops are redeployed constantly and a persistent
    // browser profile happily serves yesterday's script otherwise.
    return loadScript(baseUrl + '/' + opFile + '?_=' + runId).then(function () {
      var op = window.__spEnvOp;
      if (!op || typeof op.run !== 'function') { throw new Error(opFile + ' did not register window.__spEnvOp'); }
      return op.run({ sp: window.pnp2.sp, env: env, base: baseUrl, runId: runId });
    }).then(function (r) {
      return { suite: (window.__spEnvOp && window.__spEnvOp.name) || opFile, runId: runId, passed: r.passed === true, results: r.results || {} };
    }, function (e) {
      // A thrown op is a FAILED run — it still gets its TestRuns row.
      return { suite: opFile, runId: runId, passed: false, results: { error: String(e && e.message ? e.message : e) } };
    }).then(function (result) {
      result.results.runId = runId;
      return postTestRun(env, result).then(function () { finish(result); });
    });
  }

  if (!baseUrl) {
    finish({ suite: 'harness-init', runId: newRunId(), passed: false, results: { error: 'cannot determine own script URL' } });
    return;
  }
  fetch(baseUrl + '/resolved-env.json', { credentials: 'include' })
    .then(function (r) { if (!r.ok) { throw new Error('resolved-env.json HTTP ' + r.status + ' — run deploy first'); } return r.json(); })
    .then(function (env) {
      var pnpUrl = env.libraries.pnp2 && env.libraries.pnp2.url;
      var chain = window.pnp2 ? Promise.resolve() : loadScriptNoAmd(pnpUrl);
      return chain.then(function () {
        if (!window.pnp2) { throw new Error('window.pnp2 missing after loading ' + pnpUrl); }
        // _spPageContextInfo is not reliable on modern pages; resolved-env siteUrl is.
        var siteBase = (window._spPageContextInfo && window._spPageContextInfo.webAbsoluteUrl) || env.siteUrl;
        window.pnp2.sp.setup({ sp: { baseUrl: siteBase } });
        var params = new URLSearchParams(window.location.search);
        var ops = ['provision.js', 'verify.js', 'test-smoke.js', 'upload.js'];
        var buttons = document.getElementById('sp-env-buttons');
        ops.forEach(function (o) {
          var b = document.createElement('button');
          b.textContent = 'run ' + o;
          b.style.marginRight = '6px';
          b.onclick = function () { runOp(env, o); };
          buttons.appendChild(b);
        });
        if (params.get('run')) { return runOp(env, params.get('run')); }
        status('ready — pick an op');
      });
    })
    .catch(function (e) {
      finish({ suite: 'harness-init', runId: newRunId(), passed: false, results: { error: String(e && e.message ? e.message : e) } });
    });
})();
