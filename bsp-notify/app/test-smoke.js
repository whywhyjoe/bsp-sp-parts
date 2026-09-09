// Smoke test op — exercises the REAL caller path: loads bsp-notify.js (the
// wrapper, deployed alongside this op), queues one live notification to the
// CURRENT USER via window.bspNotify, and reads the created item back from the
// Notifications list. Passed === the item exists with NotifyStatus 'Queued'.
// The flow then picks it up on its next tick — email arrival is verified by
// the driver, not by this op. No addresses are hardcoded: the recipient is
// whoever is signed in (environment-agnostic, safe on both tenants).
(function () {
  'use strict';
  window.__spEnvOp = {
    name: 'test-smoke',
    run: function (ctx) {
      var sp = ctx.sp, env = ctx.env, base = ctx.base, runId = ctx.runId;
      var listTitle = env.lists.notifications.title;

      function loadScript(url) {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = url;
          s.onload = function () { res(); };
          s.onerror = function () { rej(new Error('failed to load ' + url)); };
          document.head.appendChild(s);
        });
      }

      var chain = window.bspNotify ? Promise.resolve() : loadScript(base + '/bsp-notify.js');
      return chain.then(function () {
        if (!window.bspNotify) { throw new Error('bsp-notify.js loaded but window.bspNotify missing'); }
        window.BSP_NOTIFY_SETTINGS = { listTitle: listTitle, webUrl: env.siteUrl };
        return sp.web.currentUser();
      }).then(function (me) {
        if (!me.Email) { throw new Error('current user has no Email — cannot pick a recipient'); }
        return window.bspNotify({
          subject: 'bsp-notify smoke #' + runId,
          body: '<p>Automated smoke test of the bsp-notify queue. Run <b>' + runId + '</b>. Safe to ignore.</p>',
          to: me.Email,
          source: 'bsp-notify/test-smoke',
          type: 'smoke test'
        }).then(function (r) { return { me: me.Email, queued: r }; });
      }).then(function (st) {
        if (!st.queued || !st.queued.id) { throw new Error('bspNotify resolved without an item id'); }
        return sp.web.lists.getByTitle(listTitle).items.getById(st.queued.id)
          .select('Id', 'Title', 'NotifyStatus', 'To', 'Attempts', 'Source')()
          .then(function (item) {
            var ok = item.NotifyStatus === 'Queued' && item.Title.indexOf(runId) >= 0;
            return {
              passed: ok,
              results: {
                itemId: item.Id,
                title: item.Title,
                notifyStatus: item.NotifyStatus,
                to: item.To,
                attempts: item.Attempts,
                source: item.Source,
                note: ok ? 'queued via window.bspNotify; the BSP Notify flow sends it on its next tick'
                  : 'item read back but not in the expected Queued state'
              }
            };
          });
      }).catch(function (e) {
        return { passed: false, results: { error: String(e && e.message ? e.message : e) } };
      });
    }
  };
})();
