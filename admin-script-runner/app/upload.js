// Push-mode uploader op — runs in the harness. Renders a file picker + Note
// field, uploads the chosen files into the scripts library, and stamps the
// deploy metadata columns (BuildId, GitSha, DeployedBy, Note) on each file,
// creating the columns on the library if missing. On dev, Playwright drives
// it (tools/sp/push-deploy.js); on prod, a human picks files from the cloned
// repo. Plain script, no ES modules.
(function () {
  'use strict';
  window.__spEnvOp = {
    name: 'upload',
    run: function (ctx) {
      var sp = ctx.sp, env = ctx.env;
      return new Promise(function (resolve) {
        var host = document.getElementById('sp-env-harness') || document.body;
        var ui = document.createElement('div');
        ui.innerHTML = '<h4>push uploader</h4>' +
          '<input type="file" id="sp-env-upload-input" multiple> ' +
          '<input type="text" id="sp-env-upload-note" placeholder="Note" size="40"> ' +
          '<button id="sp-env-upload-go">Upload</button>' +
          '<div id="sp-env-upload-status"></div>';
        host.appendChild(ui);
        var statusEl = document.getElementById('sp-env-upload-status');

        document.getElementById('sp-env-upload-go').onclick = function () {
          var files = document.getElementById('sp-env-upload-input').files;
          var note = document.getElementById('sp-env-upload-note').value || '';
          if (!files.length) { statusEl.textContent = 'pick files first'; return; }
          var folderRel = new URL(env.libraries.scripts.url).pathname;
          var buildId = (env.gitSha || 'nogit') + '-' + new Date().toISOString().replace(/[:.]/g, '-');
          var results = { buildId: buildId, note: note, uploaded: [], errors: [] };
          var listId = null, user = 'unknown', fieldsEnsured = false;

          function ensureFields(id) {
            if (fieldsEnsured) { return Promise.resolve(); }
            var list = sp.web.lists.getById(id);
            var chain = Promise.resolve();
            ['BuildId', 'GitSha', 'DeployedBy', 'Note'].forEach(function (fn) {
              chain = chain.then(function () {
                return list.fields.getByInternalNameOrTitle(fn)().catch(function () {
                  return list.fields.addText(fn).catch(function (e) {
                    results.errors.push('field ' + fn + ': ' + (e && e.message ? e.message : e));
                  });
                });
              });
            });
            return chain.then(function () { fieldsEnsured = true; });
          }

          // DeployedBy is required metadata — an unresolvable user fails the run.
          var chain = sp.web.currentUser().then(function (u) { user = u.Title || u.LoginName; }).catch(function (e) {
            results.errors.push('cannot resolve current user for DeployedBy: ' + (e && e.message ? e.message : e));
          });
          Array.prototype.forEach.call(files, function (f) {
            chain = chain.then(function () {
              statusEl.textContent = 'uploading ' + f.name + '…';
              return f.arrayBuffer().then(function (buf) {
                return sp.web.getFolderByServerRelativePath(folderRel).files.addUsingPath(f.name, buf, { Overwrite: true });
              }).then(function () {
                return sp.web.getFileByServerRelativePath(folderRel + '/' + f.name)
                  .listItemAllFields.select('Id', 'ParentList/Id').expand('ParentList')();
              }).then(function (it) {
                listId = it.ParentList.Id;
                return ensureFields(listId).then(function () {
                  return sp.web.lists.getById(listId).items.getById(it.Id).update({
                    BuildId: buildId, GitSha: env.gitSha || '', DeployedBy: user, Note: note
                  });
                });
              }).then(function () { results.uploaded.push(f.name); })
                .catch(function (e) { results.errors.push(f.name + ': ' + (e && e.message ? e.message : e)); });
            });
          });
          chain.then(function () {
            statusEl.textContent = 'done: ' + results.uploaded.length + ' uploaded, ' + results.errors.length + ' errors';
            resolve({ passed: results.errors.length === 0 && results.uploaded.length > 0, results: results });
          });
        };
      });
    }
  };
})();
