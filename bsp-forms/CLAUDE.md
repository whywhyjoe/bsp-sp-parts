# BSP Forms — agent guide (CLAUDE.md)

JSON-configured forms app for SharePoint pages: one shared engine
(`bsp-forms.js` + `bsp-forms.css`) renders multi-page forms from a per-form
JSON config and writes submissions + attachments to a SharePoint list.
`README.md` is the human overview; `docs/CONFIG-REFERENCE.md` is the config
contract. Read both before changing behavior.

## Where the rules come from

- **UI = the BSP design system** (`whywhyjoe/bsp-design-system`, deployed as
  the sibling `bsp-design/`). This app is *employee-facing*, so BSP applies —
  NOT the DCS Workbench design system. Compose from BSP classes
  (`.field .input .stepper .msgbar .dropzone .tag .avatar .btn .spinner`);
  `bsp-forms.css` is an **additive layer** in the spirit of `editorial.css`:
  scoped to `.bspf`, token-built, never redefines `:root`, never restyles BSP
  classes. The choice-pill hues are feedback-tint pairs or `color-mix()` of
  chart-palette tokens — keep it that way; no free-standing hex.
- **Construction method = the DCS Workbench docs**
  (`whywhyjoe/dcs-workbench-tools/docs/`): classic-script engine, idempotent
  per mount, survives re-evaluation, edit-mode guard, host CSP nonce on every
  injected script, `?v=` cache-busting, paths derived from
  `document.currentScript`. The L1/L2 tier model does NOT apply here.
- **Buildless is non-negotiable.** What's authored is what runs: no modules,
  no bundler, no CDN at runtime. `dev/vendor/alpine.js` is dev-harness-only.
- **ES5-style source is a settled decision.** Target browsers would run
  `let`/`const`/template literals fine (the code already uses `Promise` and
  `fetch`), but classic `var`/`function` is the house idiom across the
  BSP/DCS SharePoint projects; a syntax modernization was proposed in review
  and declined as churn with no behavior gain. Don't re-litigate it
  piecemeal — match the existing style.

## File map

| Path | What |
| --- | --- |
| `bsp-forms.js` | The whole engine: settings/base resolution → asset loader → pnpjs v2 adapter (+mock seam) → config normalize/validate → rule engine → validators → markup builders → Alpine instance factory → doctor → boot/scan. Sections are banner-commented in that order. |
| `bsp-forms.css` | The `.bspf-*` layer: pills, combo, people picker, attachments, nav, done screen, edit note, doctor. Also owns the `[x-cloak]` rule (kept out of inline `<style>` for CSP). |
| `forms/example-it-request.json` | Reference config — exercises every field type and rule. Keep it exercising anything you add. |
| `webpart/bsp-forms.webpart.html` | The insert snippet users paste/point the web part at. |
| `forms/gsi-digital-initiatives-intake.json` | Live form: FCU GSI Digital Initiatives Technology Intake → the Creative Digital Solutions intake list (internal column names; see its `$comment`). |
| `forms/gsi-digital-creative-intake.json` | Live form: FCU GSI Digital & Creative Solutions Intake → the same list. Uses business time: urgent prompt + locked Urgent/Standard switch. |
| `forms/classic-url-request.json` | Live form: classic-link request (`?Link=&ResourceName=`) → Classic-URL-Requests, lookup in Classic-URL-Redirects, else copy + redirect to the link converter (`form.vars`). |
| `dev/` | Harness (`index.html`), mock adapter (`mock-sp.js`, same method names as the real adapter), vendored Alpine. Never deployed. |
| `dev/live/` | Dev-tenant live smoke for the two GSI forms: `live-crosssite.js` (the list's twin on the tenant root site), `live-setup.ps1` (upload both configs, with `siteUrl` swapped to the dev root), `live-page.ps1` (test page per `-Config`), `live-submit.js` (initiatives form), `live-creative.js` (creative form, clock pinned), `live-classic-lists.ps1` + `live-classic.js` (classic-link form) — end-to-end + REST read-back. Needs the sp-env skill; never deployed, never run on prod. |

## Paid-for gotchas (don't relearn these)

- **The edit-mode placeholder depends on `.is-suspended` staying ON.** The
  CSS shows `.bspf-editnote` only while the mount has the class, so a
  deferred (edit-at-boot) mount keeps it for the whole edit session and
  `applyEditState` must never touch deferred mounts' classes. Removing the
  class "because nothing is built yet" blanks the web part in edit mode —
  that exact bug shipped once and was caught in code review.
- **Init failures are retryable.** A failed mount clears `__bspfInit`, so any
  later `BSPForms.scan()` (or script re-evaluation) retries; error cards are
  tagged `data-bspf-fatal` and cleared on retry. `BSPForms.retry(mount)` is
  the devtools shortcut. Don't reintroduce a permanent init flag.
- **Stylesheet dedupe is by canonical URL (query-stripped), never basename** —
  an unrelated `components.css` on the page must not suppress the real one.
- **Field/section ids are author data**: index maps are null-prototype and
  `safeKey` remaps `__proto__`/`constructor`/`prototype`, so ids like
  "constructor" behave as plain data. Keep new lookup maps
  `Object.create(null)`.
- **`validation.pattern` compiles once at normalize time** (`f._pattern`); an
  invalid regex is a config error, never a silently-skipped rule.
- **No `<button>` inside the combo control.** The control is a
  `div[role="combobox"]` *because* selected multi-choice pills carry remove
  `<button>`s — HTML forbids nested buttons and the parser silently re-parents
  them, breaking layout. Keep it a div.
- **Errors clear live, not at blur.** `reval()` re-checks a field on input
  once it has an error. Without it, the error paragraph collapses at
  mousedown-on-Next and the button jumps out from under the click.
- **Alpine init:** markup is inserted first; if Alpine is already on the page,
  `Alpine.initTree(root)` is called (roots added after `Alpine.start()` are
  not picked up automatically). `_x_dataStack` presence = already initialized.
- **File objects stay out of Alpine state.** Reactive proxies break Blob
  method calls; raw `File`s live in the non-reactive `def.store.files`, only
  metadata (`filesMeta`) is reactive.
- **Date-only values are written as noon local** so the stored date can't
  shift a day across timezones. Date rule comparisons are calendar-day based.
- **Duplicate `column` mappings** must be declared in top-level
  `sharedColumns` (undeclared duplicates and unmapped declarations are config
  errors). Later visible field wins — the payload builder just iterates config
  order and console-warns when more than one is visible.
- **Appearance chrome** (`form.appearance`: frame card/plain, header
  band/plain, tint sky/blue/neutral, Abacus `icon`;
  `confirmation.illustration`) is pure CSS + a couple of markup branches in
  `renderForm` — asset paths resolve against `designBase` via
  `resolveAsset()`.
- **Attachment failures never re-create the item** (`store.itemId` guard);
  retry uploads only what's still `pending`/`failed`.
- **`pnp.sp.setup` is global** — the adapter re-asserts `baseUrl` before its
  operations; prefer `pnp.Web(url)` when the bundle exposes it.
- **The pnp bundle loads with `define.amd` hidden** (`loadScript(…, true)`).
  Modern pages run an AMD loader; a UMD bundle injected late registers as an
  anonymous AMD module and `window.pnp` never appears ("pnpjs bundle loaded
  but window.pnp.sp is missing"). Restore on success *and* failure. Found on
  the first live run (dev, 0.1.1).
- **No `_spPageContextInfo` on modern pages** (the Modern Script Editor only
  injects it when its toggle is on). `resolvePageWeb()` then probes
  `<path>/_api/web` from the page's folder upward and also fetches the
  current user for `{user:*}` tokens; every adapter call goes through
  `whenCtx()`. Without it the doctor, people search and submit all fail with
  `no-context`. Found on the first live run (dev, 0.1.2).
- **Layout is keyed to the form's width, not the viewport.** `.bspf` is the
  `bspf` size container; two columns and the narrow-padding/stacked-header
  rules are `@container bspf` queries, because a web part can sit in a
  one-third column on a wide screen. Rules inside those queries can only
  style `.bspf`'s *descendants* (an element can't query itself). Don't
  "simplify" them back to `@media`.
- **Author prose goes through `prose()`, never raw `innerHTML`.** It escapes
  first, then turns only `[text](url)` with an http(s)/mailto/`/`/`#` target
  into a link (`target="_blank"` off-page, so a half-filled form survives).
  Labels and titles stay `esc()` only. The smoke suite pins the
  `javascript:` case.
- **Cross-site targets:** `ensureUser` runs on the *target* web (user ids
  are per site collection) while people search runs on the page web. The
  dev twin of the intake list lives on the tenant root site precisely to
  exercise this (`dev/live/live-crosssite.js`).
- **Business time counts on the business zone's wall clock** (`bizNow` via
  `Intl.DateTimeFormat` + civil day numbers), never in viewer-local or UTC
  `Date` math: that's what makes it immune to the viewer's zone and DST. Past
  days are never "within" (`bizWithin`), or a half-typed year (`0202-…`)
  locks Urgent; the prompt has the same guard. A picked **time**
  (`includeTime`) is in the viewer's zone. `bizAtDate` turns it into an
  instant and then into business-zone wall time, never reading "14:00" as
  Eastern. The smoke suite runs that test in Pacific time.
- **A date prompt decides before locks apply.** `dateChanged` opens the
  prompt and only enforces `lockWhen` if no prompt opened. Otherwise the
  lock flips the value on before the user answers, and "Change to 48 hours"
  leaves it stuck on.
- **Time-dependent tests pin the clock**: `page.clock.setFixedTime` in the
  smoke suite (Playwright ≥ 1.45); the `BSPForms.clock` seam on live pages.
  Never let a test's outcome depend on the weekday it runs.
- **Every SharePoint read/write stays in `makeAdapter`** (plus its mock twin,
  same method names). There's no shared, deployed list library elsewhere in
  the BSP projects to call instead. `listOf(spec)` gives any list on any web
  the same routing as the target list. Filter values go through `odataStr()`
  (quotes doubled); the live classic test pins an apostrophe.
- **No open redirects.** A redirect or result link must pass `safeHref`
  (http(s) or server-relative only). Redirect URLs come from config
  (`form.vars`), never from the page URL. Don't add a URL-parameter override
  "for convenience".
- **Clipboard needs a recent click.** The copy runs right after the submit
  click's async work. If the browser refuses it, the Copy box appears and
  the countdown pauses; `copyAgain` runs inside a new click. Don't let the
  redirect fire while a copy failed.
- The people API can't reliably filter disabled/room accounts; the adapter
  drops non-`User` principals and entries without an email. Best-effort by
  design — don't promise more in UI copy.

## Verifying a change

Serve the folder that contains BOTH this repo and `bsp-design-system`, then
open the harness (mock SP, vendored Alpine, writes logged to
`__BSPF_MOCK_WRITES__`):

```
python -m http.server 8000       # from the parent of both clones
http://localhost:8000/various/bsp-forms/dev/index.html      (?validate → doctor)
```

Then run the regression suite — it covers the lifecycle and payload
invariants manual clicking misses (edit-mode placeholder, config-error paths,
hidden-field exclusion, shared-column precedence, attachment retry):

```
node dev/smoke.spec.js [harness url]     # needs playwright installed; dev-only
```

All checks must pass before a push. When extending it, keep nav clicks
programmatic (`el.click()` via evaluate) — pointer-coordinate clicks flake
when validation messages shift layout mid-click. In manual runs, the two
`about:invalid` photo errors are the mock exercising the initials fallback;
inspect `__BSPF_MOCK_WRITES__` for the exact payload.

## Scope guards

- Don't edit the design-system repos from here; extend via `bsp-forms.css`.
- Deployed artifacts are only `bsp-forms.js`, `bsp-forms.css`, `forms/*.json`.
- Next phases (not built, don't scaffold speculatively): branching, drafts,
  builder UI, and post-submit actions beyond `afterSubmit`'s single lookup +
  result screen.
