// Provision op — SINGLE PnPjs codepath for both tenants, idempotent.
// Ensures lists + columns (+ seed rows when a list is empty), and ensures app
// pages by copying the template page and rewriting the SEWP token to the
// page's loader script. Registers with the harness via window.__spEnvOp.
(function () {
  'use strict';
  window.__spEnvOp = {
    name: 'provision',
    run: function (ctx) {
      var sp = ctx.sp, env = ctx.env;
      var actions = [], errors = [];
      var note = function (m) { actions.push(m); };
      var fail = function (m) { errors.push(m); };

      var TYPE_MAP = { Text: 'Text', Choice: 'Choice', Boolean: 'Boolean', Note: 'Note', Number: 'Number', User: 'User', DateTime: 'DateTime' };
      function ensureField(list, col) {
        return list.fields.getByInternalNameOrTitle(col.name).select('TypeAsString')().then(function (f) {
          var expected = TYPE_MAP[col.type] || col.type;
          if (f.TypeAsString !== expected && !(expected === 'User' && f.TypeAsString === 'UserMulti')) {
            // An existing field of the WRONG type is an error, not "ok" —
            // silently accepting it is how drift becomes a mystery later.
            fail('field ' + col.name + ' exists with type ' + f.TypeAsString + ', manifest says ' + expected + ' — resolve manually (provision will not convert types)');
          } else {
            note('field ok: ' + col.name + ' (' + f.TypeAsString + ')');
          }
        }).catch(function () {
          var f = list.fields;
          var p;
          if (col.type === 'Choice') { p = f.addChoice(col.name, col.choices || []); }
          else if (col.type === 'Boolean') { p = f.addBoolean(col.name); }
          else if (col.type === 'Note') { p = f.addMultilineText(col.name); }
          else if (col.type === 'Number') { p = f.addNumber(col.name); }
          else if (col.type === 'User') { p = f.addUser(col.name, 0); }
          // DisplayFormat 1 = date AND time — the default (0, date-only)
          // silently truncates times to local midnight (found live).
          else if (col.type === 'DateTime') { p = f.addDateTime(col.name, 1); }
          else { p = f.addText(col.name); }
          return p.then(function () {
            note('field created: ' + col.name);
            return list.defaultView.fields.add(col.name).catch(function () { });
          });
        });
      }

      function ensureList(def) {
        return sp.web.lists.ensure(def.title).then(function (r) {
          note((r.created ? 'list created: ' : 'list ok: ') + def.title);
          var chain = Promise.resolve();
          (def.columns || []).forEach(function (col) {
            chain = chain.then(function () { return ensureField(r.list, col); });
          });
          return chain.then(function () {
            if (!def.seed || !def.seed.length) { return; }
            return r.list.items.top(1)().then(function (items) {
              if (items.length) { note('seed skipped (items exist): ' + def.title); return; }
              var seedChain = Promise.resolve();
              def.seed.forEach(function (row) {
                seedChain = seedChain.then(function () { return r.list.items.add(row); });
              });
              return seedChain.then(function () { note('seeded ' + def.seed.length + ' items: ' + def.title); });
            });
          });
        }).catch(function (e) { fail('list ' + def.title + ': ' + (e && e.message ? e.message : e)); });
      }

      function serverRel(url) { return new URL(url).pathname; }

      function ensurePage(name, page) {
        if (name === 'template' || name === 'harness') { return Promise.resolve(); } // harness = bootstrap's job
        var rel = serverRel(page.url), tplRel = serverRel(env.pages.template.url);
        return sp.web.getFileByServerRelativePath(rel).select('Exists')().then(function () {
          note('page ok: ' + page.path);
        }).catch(function () {
          return sp.web.getFileByServerRelativePath(tplRel).copyTo(rel, false).then(function () {
            return sp.web.getFileByServerRelativePath(rel).getItem().then(function (item) {
              return item.select('Id', 'CanvasContent1')().then(function (it) {
                var canvas = it.CanvasContent1 || '';
                if (canvas.indexOf('__SP_ENV_SCRIPT__') < 0) { throw new Error('template canvas lacks __SP_ENV_SCRIPT__ token'); }
                var loaderUrl = env.libraries.scripts.url + '/' + (page.loader || 'loader.js');
                return item.update({ CanvasContent1: canvas.split('__SP_ENV_SCRIPT__').join(loaderUrl) })
                  .then(function () {
                    // The item update lands as a draft on versioned page
                    // libraries — publish so ordinary readers get the rewrite.
                    return sp.web.getFileByServerRelativePath(rel).publish('sp-env provision').catch(function (e) {
                      note('publish skipped for ' + page.path + ' (' + (e && e.message ? e.message : e) + ') — verify readers see the rewrite');
                    });
                  })
                  .then(function () { note('page created from template: ' + page.path + ' -> ' + loaderUrl); });
              });
            });
          }).catch(function (e) { fail('page ' + page.path + ': ' + (e && e.message ? e.message : e)); });
        });
      }

      var chain = Promise.resolve();
      Object.keys(env.lists || {}).forEach(function (k) {
        chain = chain.then(function () { return ensureList(env.lists[k]); });
      });
      Object.keys(env.pages || {}).forEach(function (k) {
        chain = chain.then(function () { return ensurePage(k, env.pages[k]); });
      });
      return chain.then(function () {
        return { passed: errors.length === 0, results: { actions: actions, errors: errors } };
      });
    }
  };
})();
