# dev/vendor — dev-only copies. **Nothing here is ever deployed.**

These exist so the dev harness can mirror a real SharePoint page from disk. Live
pages load the originals from the portal; this repo deploys none of them.

## Source URLs — update these when a prod location moves

| File | Source on prod | Notes |
| --- | --- | --- |
| `fcu-standard.js` | `/sites/FCUPortal/Code/fcu-standard.js` | Standard include, on every page. Supplies `waitForElement`, `waitForPnP2`, `__dcsIsEditMode`, `injectIntoElement`, `debounce`, … |
| `std-spa-loader.js` | `/sites/FCUPortal/Code/std-spa-loader.js` | SPA navigation bus (`dcsOnSpaNavigation`) + `dcsRegisterAlpineComponent` |
| `alpine.js` | `/sites/FCUPortal/Code/lib/alpine.js` | Alpine 3.16.2 build |
| `colors_and_type.css`, `components.css` | `/sites/FCUPortal/Code/bsp-design/` | From the `bsp-design-system` repo; carry their own `/*! … vX.Y.Z … */` banner |

Each vendored `.js` repeats its source URL in a header block at the top of the
file, so you can find it without coming here first.

## Keep the copies VERBATIM

When refreshing, copy the prod file over and re-add the header block. **Do not fix
bugs in these copies.** A faithful copy is the entire point: if the harness runs
different code than production, it stops being evidence. Known issues are noted in
the headers and reproduced deliberately.

## `fcu-standard-additions.js` — a proposal, not a copy

Backward-compatible improvements to `fcu-standard.js`, parked here so the whole
prod-adjacent set lives in one folder for relocation. **This one is meant to be
applied to prod**, unlike its neighbours — move it to whatever repo hosts
`fcu-standard.js`. No existing call signature changes.

Contents: `onTimeout` + a returned Promise on `waitForPnP2` and `waitForElement`
(today a timeout only logs, so a caller cannot tell "still waiting" from "never
coming"); an `all` option on `waitForElement` for multi-instance mounts; a new
`waitForAlpine`; plus two bug fixes — `initLocalizer`'s undefined `maxAttempts`,
and the `'mode'` / `'Mode'` casing disagreement between `fcu-standard.js` and
`fj.bootstrap.js`.

## Harness modes

`dev/sp-list-ordering.dev.html` defaults to **integrated**: it loads
`fcu-standard.js` + `std-spa-loader.js`, so the tool runs against the real prod
helpers. Append **`?standalone=1`** to skip them and exercise the stand-ins in
`_shared/dcs-part-boot.js` instead — the path used on a page without the standard
include. The link in the harness toolbar toggles between the two.
