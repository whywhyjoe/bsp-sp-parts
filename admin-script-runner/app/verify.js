// Verify op — drift report vs env.json. passed === true means ZERO drift.
// Checks EXISTENCE AND SHAPE: field types (TypeAsString) and Choice values,
// page canvases pointing at the expected script URL, and the deployed files
// each page depends on — existence alone is not verification.
(function () {
  'use strict';
  var TYPE_MAP = { Text: 'Text', Choice: 'Choice', Boolean: 'Boolean', Note: 'Note', Number: 'Number', User: 'User', DateTime: 'DateTime' };

  window.__spEnvOp = {
    name: 'verify',
    run: function (ctx) {
      var sp = ctx.sp, env = ctx.env;
      var drift = [], checked = [];
      function serverRel(url) { return new URL(url).pathname; }
      function choicesOf(f) {
        var c = f.Choices;
        if (c && c.results) { c = c.results; }
        return Array.isArray(c) ? c : [];
      }

      function checkList(def) {
        var list = sp.web.lists.getByTitle(def.title);
        return list.select('Title')().then(function () {
          checked.push('list: ' + def.title);
          var chain = Promise.resolve();
          (def.columns || []).forEach(function (col) {
            chain = chain.then(function () {
              return list.fields.getByInternalNameOrTitle(col.name).select('TypeAsString', 'Choices')().then(function (f) {
                var expected = TYPE_MAP[col.type] || col.type;
                if (f.TypeAsString !== expected && !(expected === 'User' && f.TypeAsString === 'UserMulti')) {
                  drift.push('field type mismatch: ' + def.title + '.' + col.name + ' is ' + f.TypeAsString + ', manifest says ' + expected);
                  return;
                }
                if (col.type === 'Choice') {
                  var actual = choicesOf(f);
                  var missing = (col.choices || []).filter(function (c) { return actual.indexOf(c) < 0; });
                  if (missing.length) {
                    drift.push('choice values missing: ' + def.title + '.' + col.name + ' lacks [' + missing.join(', ') + '] (has [' + actual.join(', ') + '])');
                    return;
                  }
                }
                checked.push('field: ' + def.title + '.' + col.name + ' (' + f.TypeAsString + ')');
              }).catch(function () { drift.push('missing field: ' + def.title + '.' + col.name); });
            });
          });
          return chain;
        }).catch(function () { drift.push('missing list: ' + def.title); });
      }

      // Pages must exist AND their canvas must point at the expected script.
      function checkPage(name, page) {
        var rel = serverRel(page.url);
        var expectedSrc = null;
        if (name === 'harness') { expectedSrc = env.libraries.scripts.url + '/harness.js'; }
        else if (name !== 'template' && page.loader) { expectedSrc = env.libraries.scripts.url + '/' + page.loader; }
        return sp.web.getFileByServerRelativePath(rel).getItem().then(function (item) {
          return item.select('CanvasContent1')().then(function (it) {
            // SharePoint HTML-encodes stored canvases (':' becomes '&#58;'),
            // so decode numeric entities before any literal URL match — the
            // raw string check was a false-drift generator, found live.
            var canvas = String(it.CanvasContent1 || '').replace(/&#(\d+);/g, function (m, n) {
              return String.fromCharCode(Number(n));
            });
            if (name === 'template') {
              if (canvas.indexOf('__SP_ENV_SCRIPT__') < 0) { drift.push('template page lost its __SP_ENV_SCRIPT__ token'); }
              else { checked.push('page: ' + page.path + ' (token intact)'); }
            } else if (expectedSrc && canvas.indexOf(expectedSrc) < 0) {
              drift.push('page ' + page.path + ' canvas does not reference ' + expectedSrc);
            } else {
              checked.push('page: ' + page.path + (expectedSrc ? ' -> ' + expectedSrc.split('/').pop() : ''));
            }
          });
        }).catch(function () { drift.push('missing page: ' + page.path); });
      }

      // The deployed files the pages depend on must actually be in the library.
      function checkDeployedFiles() {
        var folderRel = serverRel(env.libraries.scripts.url);
        var required = ['harness.js', 'resolved-env.json'];
        Object.keys(env.pages || {}).forEach(function (k) {
          var l = env.pages[k].loader;
          if (l && required.indexOf(l) < 0) { required.push(l); }
        });
        return sp.web.getFolderByServerRelativePath(folderRel).files.select('Name')().then(function (files) {
          var names = files.map(function (f) { return f.Name; });
          required.forEach(function (r) {
            if (names.indexOf(r) < 0) { drift.push('deployed file missing from scripts library: ' + r); }
            else { checked.push('deployed: ' + r); }
          });
        }).catch(function () { drift.push('missing scripts folder: ' + folderRel); });
      }

      var chain = Promise.resolve();
      Object.keys(env.lists || {}).forEach(function (k) {
        chain = chain.then(function () { return checkList(env.lists[k]); });
      });
      Object.keys(env.pages || {}).forEach(function (k) {
        chain = chain.then(function () { return checkPage(k, env.pages[k]); });
      });
      chain = chain.then(checkDeployedFiles);

      return chain.then(function () {
        return { passed: drift.length === 0, results: { drift: drift, checked: checked.length } };
      });
    }
  };
})();
