// Demo-page loader (dev verification only — real pages paste the generated
// admin-script-runner.webpart.html instead). Injects that generated stub into
// the page, points its data-config at a config built from resolved-env.json,
// then runs the stub's <script> tags in order. Innerhtml'd script tags never
// execute, which is why they are re-created here. Plain script, no ES modules.
(function () {
  'use strict';
  var base = (function () {
    var src = document.currentScript && document.currentScript.src;
    return src ? src.slice(0, src.lastIndexOf('/')) : null;
  })();
  if (!base) { return; }

  // AMD trap: a UMD bundle injected late registers as an anonymous AMD module
  // and never sets window.pnp2. Hide define.amd during the load; restore always.
  function loadScript(url) {
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
  function json(url) {
    // Without an explicit Accept, _api answers in XML.
    return fetch(url, { credentials: 'include', cache: 'no-cache', headers: { Accept: 'application/json;odata=nometadata' } }).then(function (r) {
      if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
      return r.json();
    });
  }

  var env;
  json(base + '/resolved-env.json').then(function (e) {
    env = e;
    var lib = encodeURIComponent(env.lists.outputLibrary.title).replace(/'/g, "''");
    return json(env.siteUrl + "/_api/web/lists/getByTitle('" + lib + "')/RootFolder?$select=ServerRelativeUrl");
  }).then(function (folder) {
    var sitePath = new URL(env.siteUrl).pathname.replace(/\/+$/, '');
    var config = {
      id: 'demo-intake',
      title: 'Intake requests (demo page)',
      list: { site: sitePath, title: env.lists.sourceList.title },
      fields: ['Status', 'TaskType', 'DueDate', 'StartDate', 'Description', 'RefLink'],
      group: 'AssignedTo',
      maxItems: 50,
      timeZone: 'America/New_York',
      output: { site: sitePath, folder: folder.ServerRelativeUrl || folder.value, file: 'asr-demo.md' }
    };
    var configUrl = URL.createObjectURL(new Blob([JSON.stringify(config)], { type: 'application/json' }));
    return fetch(base + '/admin-script-runner.webpart.html', { credentials: 'include', cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('stub HTTP ' + r.status); return r.text(); })
      .then(function (html) {
        var root = document.getElementById('sp-env-app-root') || document.body.appendChild(document.createElement('div'));
        var holder = document.createElement('div');
        holder.innerHTML = html;
        var scripts = Array.prototype.slice.call(holder.querySelectorAll('script')).map(function (s) {
          s.parentNode.removeChild(s);
          return s.getAttribute('src');
        });
        var host = holder.querySelector('[data-admin-task]');
        host.setAttribute('data-config', configUrl);
        host.setAttribute('data-id', config.id);   // blob URLs change per load; the key must not
        while (holder.firstChild) root.appendChild(holder.firstChild);
        return scripts.reduce(function (p, src) {
          return p.then(function () { return loadScript(src); });
        }, Promise.resolve());
      });
  }).catch(function (e) {
    var d = document.createElement('div');
    d.id = 'sp-env-app-error';
    d.textContent = 'demo loader failed: ' + String(e && e.message ? e.message : e);
    document.body.appendChild(d);
  });
})();
