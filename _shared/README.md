# _shared — the boot contract for web part tools

**Scope: this contract binds web part tools only** — parts that inject UI into
a web part zone. Page libraries and tenant services do not use it; the kinds
table in the repo README says which part is which. A page library that renders
page UI *may* adopt `dcsMountPart()` deliberately — if it does, its own README
says so; absence of a statement means it doesn't.

## `dcs-part-boot.js` (deployed, once per site)

The saved pattern. SharePoint renders web part zones on its own schedule, navigates
without a page reload, and lets authors edit the page live — so **every** web-part-zone
UI needs the same four things. Rather than re-implementing them per tool (which guarantees drift),
tools call `dcsMountPart()` and only declare *what* to render.

```js
window.dcsMountPart({
  id: 'sp-list-ordering',                    // SPA subscriber id + mount guard value
  selector: '[data-sp-part="list-ordering"]',
  label: 'List ordering',                    // used in the edit-mode placeholder
  editMode: 'placeholder',                   // 'placeholder' | 'skip' | 'run'
  render: function (host) { return MARKUP; } // injected-mount style
});
```

It owns: waiting for the host element(s) · mounting **every** matching host idempotently
(guard attribute `data-dcs-mounted="<id>"`) · an edit-mode placeholder instead of a live
tool · re-mounting after SharePoint SPA navigation. Returns a handle, also registered at
`window.dcsParts['<id>']` — `.mountAll()`, `.remount()`, `.isEditMode()` are useful from
the console on a real page.

**Two mount styles.** Which one you need depends on where the markup comes from:

| Style | When | Re-mount means |
| --- | --- | --- |
| **injected** (`render`) | The tool renders its own markup into a host div — most tools here | re-inject; Alpine v3's document observer initializes the new tree |
| **static** (`initTree: true`) | The markup is already in the page (e.g. `#dcs-app` with `x-ignore`), as in the Fraud Journeys app | remove `x-ignore`, call `Alpine.initTree(host)` — Alpine already owns that tree. This is the only style that needs `dcsRegisterAlpineComponent` |

**Alpine registration.** Tools use a plain global factory —
`window.<toolName> = function () {…}` with `x-data="<toolName>()"` — matching
bsp-design-system, which ships no `Alpine.data()` layer by design. `dcsRegisterAlpineComponent`
is still shimmed here, but only for the static-mount case (`initTree: true`), where Alpine
already owns the tree and must resolve the component by name.

**Relationship to `fcu-standard.js`.** This file never overrides the standard include. It
uses `waitForElement`, `waitForPnP2`, `dcsOnSpaNavigation`, `dcsRegisterAlpineComponent`
and `__dcsIsEditMode` when they exist, and defines minimal stand-ins **only when they are
absent** — so tools also run standalone (dev harness, from disk, or a page without the
standard include). It adds `waitForAlpine`, which the standard doesn't have yet.

Note `waitForElement` is `querySelector`-based (first match only), so it serves purely as
the "something appeared" trigger; `dcsMountPart` then queries **all** unmounted hosts
itself. That is what lets two copies of a web part live on one page.

## Proposed `fcu-standard.js` improvements

Moved to [`dev/vendor/fcu-standard-additions.js`](../dev/vendor/), alongside the vendored
copy of `fcu-standard.js` itself, so the whole prod-adjacent set relocates together.
