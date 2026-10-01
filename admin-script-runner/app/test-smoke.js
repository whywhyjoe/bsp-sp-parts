// Smoke test op — the REAL sp-list-to-markdown live adapter against this tenant.
// Loads the deployed task script, then drives its due()/run() the way the runner
// does (live adapter, not mock): exports the manifest's source list to
// <output library>/asr-smoke.md, reads the file back, and checks that due()
// now says "nothing to do" — once via file freshness, once via the unchanged list. Passed === all checks true. Read-only on the source
// list; the only write is the smoke file in the test output library.
(function () {
  'use strict';
  window.__spEnvOp = {
    name: 'test-smoke',
    run: function (ctx) {
      var sp = ctx.sp, env = ctx.env, base = ctx.base;
      var sitePath = new URL(env.siteUrl).pathname.replace(/\/+$/, '');
      var checks = {};
      var detail = {};

      function loadScript(url) {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = url + '?t=' + Date.now();
          s.onload = function () { res(); };
          s.onerror = function () { rej(new Error('failed to load ' + url)); };
          document.head.appendChild(s);
        });
      }
      function findType() {
        var q = window.adminScriptTasks || [];
        for (var i = 0; i < q.length; i++) { if (q[i] && q[i].type === 'sp-list-to-markdown') return q[i]; }
        return null;
      }
      function taskCtx(config, slotStart) {
        var statuses = [];
        return {
          config: config, mock: false, force: false, slotStart: slotStart, statuses: statuses,
          log: function () { statuses.push(Array.prototype.slice.call(arguments).join(' ')); },
          setStatus: function (t) { statuses.push(t); },
          setProgress: function () {},
          isCancelled: function () { return false; },
          throwIfCancelled: function () {}
        };
      }

      var config, task;
      return loadScript(base + '/sp-list-to-markdown.js').then(function () {
        task = findType();
        if (!task) throw new Error('sp-list-to-markdown.js loaded but did not register on window.adminScriptTasks');
        return sp.web.lists.getByTitle(env.lists.outputLibrary.title).rootFolder.select('ServerRelativeUrl')();
      }).then(function (folder) {
        config = {
          title: 'ASR smoke — ' + env.lists.sourceList.title,
          list: { site: sitePath, title: env.lists.sourceList.title },
          fields: ['Status', 'TaskType', 'DueDate', 'StartDate', 'Description', 'RefLink', 'Submitter'],
          group: 'AssignedTo',
          subgroup: 'Status',
          orderBy: [{ field: 'ID', ascending: true }],
          maxItems: 50,
          timeZone: 'America/New_York',
          output: { site: sitePath, folder: folder.ServerRelativeUrl, file: 'asr-smoke.md' }
        };
        detail.output = folder.ServerRelativeUrl + '/asr-smoke.md';
        return task.run(taskCtx(config, null));
      }).then(function (result) {
        detail.run = result;
        return sp.web.lists.getByTitle(env.lists.sourceList.title).select('ItemCount')();
      }).then(function (list) {
        checks.itemCountMatches = detail.run.items === Math.min(list.ItemCount, 50);
        detail.listItemCount = list.ItemCount;
        return sp.web.getFileByServerRelativePath(detail.output).getText();
      }).then(function (text) {
        detail.chars = text.length;
        detail.head = text.split('\n').slice(0, 12).join('\n');
        checks.hasTitle = text.indexOf('# ' + config.title) === 0;
        checks.hasGroups = /\n## Assigned To: /.test(text) && /\n### Status: /.test(text);
        checks.hasItemLinks = /- Item link: https:\/\/[^\n]+DispForm\.aspx\?ID=\d+/.test(text);
        checks.peopleHaveEmail = /- Assigned To: [^\n]+\([^\n@]+@[^\n]+\)/.test(text);
        checks.noObjectLeaks = text.indexOf('[object Object]') < 0 && text.indexOf('undefined') < 0;
        checks.dateOnlyIsDay = !/- Start Date: \d{4}-\d\d-\d\d \d/.test(text);
        // Just exported → not due, for BOTH reasons, checked separately:
        // (a) the file was written after the slot started;
        return task.due(taskCtx(config, new Date(Date.now() - 60000)));
      }).then(function (isDue) {
        checks.notDueFileFresh = isDue === false;
        // (b) with no slot boundary, only the list-unchanged comparison can say no.
        return task.due(taskCtx(config, null));
      }).then(function (isDue) {
        checks.notDueListUnchanged = isDue === false;
        var passed = Object.keys(checks).every(function (k) { return checks[k] === true; });
        return { passed: passed, results: { checks: checks, detail: detail } };
      }).catch(function (e) {
        return { passed: false, results: { error: String(e && e.message ? e.message : e), checks: checks, detail: detail } };
      });
    }
  };
})();
