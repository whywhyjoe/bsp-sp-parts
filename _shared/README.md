# _shared — the boot contract for every tool in this repo

## `dcs-part-boot.js` (deployed, once per site)

The saved pattern. SharePoint renders web part zones on its own schedule, navigates
without a page reload, and lets authors edit the page live — so **every** tool needs the
same four things. Rather than re-implementing them per tool (which guarantees drift),
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
| **static** (`initTree: true`) | The markup is already in the page (e.g. `#dcs-app` with `x-ignore`), as in the Fraud Journeys app | remove `x-ignore`, call `Alpine.initTree(host)` — Alpine already owns that tree |

**Relationship to `fcu-standard.js`.** This file never overrides the standard include. It
uses `waitForElement`, `waitForPnP2`, `dcsOnSpaNavigation`, `dcsRegisterAlpineComponent`
and `__dcsIsEditMode` when they exist, and defines minimal stand-ins **only when they are
absent** — so tools also run standalone (dev harness, from disk, or a page without the
standard include). It adds `waitForAlpine`, which the standard doesn't have yet.

Note `waitForElement` is `querySelector`-based (first match only), so it serves purely as
the "something appeared" trigger; `dcsMountPart` then queries **all** unmounted hosts
itself. That is what lets two copies of a web part live on one page.

## `fcu-standard-additions.js` (NOT deployed — a proposal)

Backward-compatible improvements to `fcu-standard.js`, which lives with the prod page
includes rather than in this repo. Drop-in replacements plus two bug fixes; **no existing
call signature changes**. The important one: `waitForPnP2` and `waitForElement` currently
report a timeout only to the console, so a caller cannot distinguish "still waiting" from
"never coming" — which is exactly how a tool ends up silently inert on a live page.
