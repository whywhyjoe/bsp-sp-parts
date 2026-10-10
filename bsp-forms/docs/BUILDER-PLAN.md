# BSP Forms builder — build plan

Status: **approved** (user, 2026-10-10), after the Codex review (xo turn
7; all 11 findings accepted — see section 7). Thread state:
`bsp-forms/state/2026-10-10-bsp-forms-builder.md`.

## 1. What we're building

A web-based form builder for the bsp-forms engine. It runs on a SharePoint
page (dev or prod). The user picks a SharePoint list, the builder reads the
list's schema, the user adds controls and maps each one to a compatible
column, and the builder downloads the form JSON plus a filled-in web part
stub. The user uploads those files and makes the page from their own SEWP
template page. The builder never writes to SharePoint.

The builder can only emit what the engine renders, so the work is two
layers: **engine 0.6.0** (new runtime features the builder needs) and the
**builder** itself.

### Decisions already made (user, 2026-10-10)

| # | Decision |
| --- | --- |
| D1 | The builder lives in `bsp-forms/builder/`, deploys to `Code/bsp-forms/builder/`, follows the **page-library** rules (its own README/CLAUDE.md is its contract), reuses the engine for validation and preview. No `dcsMountPart`, no four-artifact pattern. |
| D2 | It runs on prod against prod lists (same-origin REST from the page). |
| D3 | Opening an existing JSON: parts the builder doesn't model are preserved untouched, with a warning. A form with an `assignments` field is refused. |
| D4 | English only in v1. A `{en, fr}` pair survives: the builder edits `en` and keeps `fr` (flagged stale when `en` changed). |
| D5 | A control can be explicitly **"Not saved (logic only)"**. Any other control without a column is an error that blocks download. |
| D6 | Submitter: a person control can default to the signed-in user (editable — "on behalf of"). Person controls take one or many people. |
| D7 | Business days are counted in Eastern (`America/Toronto`). The date+time picker stays in the viewer's own zone (unchanged engine behavior). |
| D8 | Business-day date rules count **whole days**. Weekend dates are rejected. Holidays are out of scope. |
| D9 | Branching = page "show when <rule>" plus "end the form after this page when <rule>". No "go to page X". |
| D10 | Limiting choices = a table keyed by one earlier **choice or yes/no** field; values no longer allowed are cleared automatically. |
| D11 | For a SharePoint Choice/MultiChoice column, the control's choices are a subset (reorder, relabel, recolor) of the column's. Free lists only for Text columns. "Other" only when the column allows fill-in. |
| D12 | Number as dropdown or slider: options generated from min..max, step 1. No max (or no min) → only free entry is offered. A non-required slider has an unset state and a clear button. |
| D13 | Phone validation stays permissive (the engine's existing rule). |
| D14 | Downloads: the form JSON and a filled-in web part stub. The builder runs its own config-vs-list check. |
| D15 | v1 includes attachments, title template, the "are you sure" submit dialog (custom title/text, Yes/No buttons), appearance, two-column sections, warn/block date rules. v1 excludes URL-parameter fields, `afterSubmit` lookups, assignments, prompts and locks (preserved on import, not editable). |
| D16 | Single user (the operator). Dense three-pane editor, move up/down + drag, autosaved draft, no guided help. |
| D17 | Clear button on optional single choice, date, date+time, number (all displays), link. Checkbox/switch excluded; multi-choice and person already remove per chip. |
| D18 | Attachments: max **5** files, max **10 MB** each (the builder's ceiling; can be set lower). They attach to the created list item, so the list must have attachments enabled. |
| D19 | The review's four additions are approved: cleared means empty (E6a `sendEmpty`), answers on skipped pages count as empty (E4), page 1 always shows (E4), required columns must be written on every branch path (B7). |
| D20 | The builder offers one- or two-column layout per section (the engine's `columns`), and drag ordering of pages, sections and controls (plus move up/down for keyboard). |
| D21 | Visual interest at the level of the zone attestation form: new engine controls (slider, number dropdown, clear buttons) and the builder's own UI use the same tinted sections, icon tiles, pills/dots and motion vocabulary — not bare inputs. |

## 2. Engine 0.6.0

All additive: every existing config keeps its exact behavior. ES5 style,
buildless, null-prototype maps for author ids, prose through `prose()`.
Each feature lands with CONFIG-REFERENCE, the Copilot guide (same commit,
per CLAUDE.md), smoke checks, and a reference-config example.

### E1. Person default to the signed-in user

`"default": "@me"` on a `person` field. On init (and on "Submit another")
the field is filled with the current user once the page context resolves:
`{ key: login, text: name, email, id: null }`, where `login` is the claims
login from `getUserInfo()` (`ensureUser` accepts it). Editable like any
pick. Works with `multiple`. If the user can't be resolved, the field stays
empty (console warning) — never an error card.

- The fill is asynchronous (the page context resolves after init), so it
  applies **only if the field is still empty and untouched** — it never
  overwrites a person the user picked first.
- Validation: `@me` only on `person`.
- Mock: `userInfo()` already returns a claims `login` (`mock-sp.js:68`);
  test against it.

### E2. Choice filtering (`choicesWhen`)

```json
"choicesWhen": {
  "field": "category",
  "map": { "Hardware": ["Laptop", "Monitor"], "Software": ["Licence", "Install"] },
  "else": []
}
```

On `choice` / `multichoice`. The driver is an **earlier** `choice` or
`boolean` field (keys `"true"`/`"false"` for a boolean). The allowed set is
`map[driverValue]`, else `else`, else none. With **no allowed options** the
field is inactive (not rendered, validated or submitted), exactly like a
hidden field — that covers "driver not answered yet".

- Options outside the allowed set are not rendered (`x-show` per option).
- When the driver changes, selected values outside the new set are dropped
  (single → `''`, multi → filtered) and any fill-in ("Other") value is
  dropped too, because it was entered against the old driver. Implemented
  with one `$watch` per driver field registered in `init`, so pruning
  happens whatever changed the driver (click, `prompt.confirm.set`, reset).
- Composes with `visibleWhen` (both must pass) and with `sharedColumns`.
- Normalize errors: unknown/later/wrong-type driver; a map value that isn't
  one of the field's choices; a map key that isn't one of the driver's
  choice values (or `true`/`false`).

### E3. Number display: dropdown and slider

`"display": "input" | "dropdown" | "slider"` on `number` (not `currency`).
Dropdown and slider require integer `validation.min` and `validation.max`
with `max > min`; `integer` is implied. Dropdown is capped at 200 options
(normalize error past that). Step is always 1.

- **Dropdown** reuses the `.bspf-combo` control (plain option rows, no
  pills), keyboard as the choice combo, value saved as a Number.
- **Slider** is new `.bspf-slider` vocabulary in `bsp-forms.css`, built from
  tokens (the design system has no range control). A native
  `<input type="range">` cannot be empty, so the field value stays `''`
  until the user moves the thumb; until then the readout says "Not set" and
  the track is dimmed. Keyboard: arrows/Home/End/PageUp/PageDown (native).
  Required + unset → the usual required error.

### E4. Branching: page `visibleWhen` and `endWhen`

- `pages[0]` must not have `visibleWhen` or depend on anything (normalize
  error), so there is always at least one active page and init, reset and
  the language-switch carry can always land on page 0.
- `pages[i].visibleWhen` — the page is skipped when false. Its rule may only
  reference fields on **earlier pages** (normalize error otherwise — a page
  can't hide itself by its own answers).
- **Answers on inactive pages read as empty.** `_get(id)` returns the type's
  empty value for a field whose page is inactive, for every rule (page,
  section, field, `choicesWhen`, `lockWhen`, date `compareTo`) and for
  `{field:…}` tokens. Otherwise an answer typed on page 2 before the user
  went Back and took the other branch would still drive page 3. There's no
  cycle: `pageActive(i)` reads only pages before `i` (its `visibleWhen` by
  the rule above; the earlier pages' `endWhen` read pages ≤ themselves).
  Existing configs have no page rules, so every page stays active and
  nothing changes for them. (Hidden **sections** keep today's raw-value
  semantics; documented, not changed.)
- `pages[i].endWhen` — when true, this page is the last: Submit replaces
  Next, later pages are inactive. May reference fields on this page or
  earlier.
- One derived notion, `pageActive(i)`: visible, and no earlier active page
  has `endWhen` true. `fieldActive` gains a `pageActive(f.page)` term, so
  inactive pages' fields are neither validated nor submitted (same semantics
  as hidden sections).
- Navigation walks active pages only: `next()` goes to the next active page,
  `prev()` to the previous active one, the stepper renders active pages only
  and numbers them 1..n, Submit shows on the last active page.
  `nextOrSubmit`, `validateAll`, `pageHasError`, `focusFirstError` and
  `pendingPrompt(null)` all switch to the active list.
- If answers change on an earlier page (user went Back), the active set is
  recomputed live. If the current page becomes inactive, `page` moves to the
  nearest earlier active page (page 0 at worst). The same clamp runs after a
  language-switch carry.
- **Attachments:** the dropzone's page must always be reachable: normalize
  errors if `attachments.page`/`section` is on a page with `visibleWhen`, or
  after any page with `endWhen`. (The builder enforces the same and defaults
  attachments to the first page's end when branching exists — see B6.)

### E5. Business-day date rules

Two new ops in a date field's `rules` (same `mode` block/warn and `message`
as the calendar ops). Both need `form.businessHours` (only `timeZone` and
`days` matter for them).

```json
{ "op": "minBusinessDays", "days": 3, "mode": "block", "message": "Needs 3 business days' notice." }
{ "op": "businessDay", "mode": "block", "message": "Pick a weekday." }
```

- **Whole days (D8):** "today" is the business zone's civil date
  (`bizNow(...).day`). `minBusinessDays N` passes when the number of business
  days in `(today, D]` is ≥ N (today never counts). Fri → Mon is 1.
- `businessDay` fails when D's weekday isn't in `businessHours.days`.
- `minBusinessDays` alone does **not** reject a weekend D (a Saturday far
  enough out passes it). D8's "weekends rejected" is the builder's job: a
  builder date control with a business-day lead rule always also emits
  `businessDay` in **block** mode, and the builder's standalone "weekdays
  only" is block-only. The engine keeps both ops independent (and `warn`
  available) for hand-written configs.
- For `includeTime` values, D is the business-zone date of the picked
  instant (`bizAtDate`), matching the existing business-time rules.
- The date input gets a reactive `:min` = the earliest date a **block**
  `minBusinessDays` rule allows (`bizDateAfter`-style helper, whole-day
  version). A native picker can't grey out weekends; validation covers that.
  `:min` is advisory — validation stays authoritative (a page left open
  overnight has a stale `min`).
- Tests pin the clock (`page.clock`), and run the Friday/weekend/DST edges
  in a non-Eastern browser zone.

### E6. Clear buttons

A `×` button (`.bspf-clear`, the assignments combo's pattern: `@click.stop`,
`@keydown.enter.stop`, `@keydown.space.stop`) on **non-required** single
`choice`, `date` (both kinds), `number` (input/dropdown/slider) and `link`,
shown while the field has a value and the form isn't busy. Choice menus also
get the "Clear selection" first row the assignments combo has. Clearing
re-runs `check` and (for drivers) the E2 pruning. No config key.

**Cleared must mean empty in the list (E6a).** Today the payload omits an
empty value, and SharePoint then applies the column's default to the new
item — so clearing a Priority that defaults to `Standard` would save
`Standard`. New opt-in `target.sendEmpty: true`: every **active**, mapped,
empty field is sent as an explicit empty value (text/choice/note `null`,
number/currency `null`, date `null`, link `null`, multichoice
`{ results: [] }`, person `<col>Id: null` or `{ results: [] }`). A column
whose every mapping is inactive is still omitted (its default applies).
Builder forms always set it; existing configs don't, so their payloads are
unchanged. The builder pre-fills a control's `default` from the column's
`DefaultValue` (removable), so what the form shows is what gets saved. B0
verifies each explicit-empty shape against real columns.

### E7. Redirect after the plain success message

`confirmation.redirect: { "url": "...", "seconds": 5 }` — reuses
`startRedirect`/`countdownText` and the "Go now" link. Same `safeHref` rule
and config-only URL (no page-URL override). "Submit another" stays available
and cancels the countdown.

### E8. Column names starting with `_`

The payload key for an internal name starting with `_` becomes `OData_` +
name (and `OData_<name>Id` for person). That is SharePoint's rule for
`EntityPropertyName` (internal names of columns created with a leading
digit or symbol start `_x00…` too). The doctor and builder compare by
internal name, unchanged. The builder treats the schema's
`EntityPropertyName` as the authority: a column whose `EntityPropertyName`
doesn't match `column` / `OData_` + `column` is shown as not mappable.

### E9. Public API for the builder

- `BSPForms.normalize(raw, lang)` → `{ errors: [...] }` — the exact
  validation the page runs. The builder's "valid" means "loads on the page".
E9 is split: **E9a** (normalize, the read-only lists facade, compat,
assetVersion) ships in Phase 1 because the builder core needs it; **E9b**
(`mountConfig` preview) ships in Phase 3 with the preview pane. Both stay
inside engine 0.6.0 — nothing deploys to prod before Phase 5.

- **E9b** `BSPForms.mountConfig(el, raw, { preview: true })` →
  `{ destroy(), writes }`. Renders a config object into an element (no
  `data-bsp-form`, so `scan()` never touches it; its own `uid`, so `_defs`
  stay separate). `preview: true` builds a **preview adapter**, a distinct
  object rather than a wrapper that forwards unknown calls:
  - reads pass through to a real adapter (people search, current user,
    lookups);
  - `ensureUser` is **simulated** (synthetic ids) — on a real site it can
    add the person to the site's user list, which is a write, and the engine
    calls it both on pick (`addPerson`, engine:2435) and in `buildPayload`;
  - `addItem` / `addAttachment` are recorded in `writes` and return a
    synthetic `{ id, item }` so the attachment path and its retry complete;
  - the instance's `startRedirect` is replaced for the preview mount, so
    **every** redirect path (E7, `afterSubmit`, `queryError`) shows "Would go
    to <url>" instead of calling `location.assign`.
  `destroy()` tears down Alpine (`destroyTree`), the redirect timer, and
  `NS._defs[uid]`. Test: a preview submit with a person and an attachment
  issues no SharePoint write request (network log), and leaves no `_defs`
  entry after `destroy()`.
- **E9a** `BSPForms.lists()` → a **read-only facade** exposing exactly
  `ready()`, `userInfo()`, `getWebLists(webUrl)` and
  `getListSchema({ siteUrl, listId })` — nothing that writes. Under it is a
  `makeAdapter({ target: {} })` instance (target web = the page web), so the
  calls live in `makeAdapter` (the "every SharePoint read stays in the
  adapter" rule) and in `dev/mock-sp.js`. Each call routes to its own
  `siteUrl` per call (`web(absUrl(siteUrl))`), never through the global
  `pnp.sp.setup` state of a mounted form.
  - `getWebLists`: non-hidden lists with `BaseTemplate eq 100` (custom
    lists): `.select('Id', 'Title', 'EnableAttachments', 'ItemCount',
    'RootFolder/ServerRelativeUrl').expand('RootFolder')`.
  - `getListSchema`: `lists.getById(listId)` → list properties (same select
    + expand) + **all** fields **without** `$select`,
    so derived-type properties come back (`Choices`, `FillInChoice`,
    `MaxLength`, `DisplayFormat`, `AllowMultipleValues`, `MinimumValue`,
    `MaximumValue`, `ShowAsPercentage`, `RichText`, `AppendOnly`,
    `NumberOfLines`, `EnforceUniqueValues`, `ValidationFormula`,
    `DefaultValue`, `EntityPropertyName`). **Verify on dev first** (B0) that
    pnp v2's accept header returns these; fall back to per-type `$select`
    with `odata=verbose` if not.
  - `DisplayFormat` means different things per type and is read only after
    checking `TypeAsString`: DateTime `0` = date only, `1` = date and time;
    URL `0` = hyperlink, `1` = picture.
- `BSPForms.compat` — the doctor's `TYPE_COMPAT` table, so the builder and
  doctor share one compatibility source.
- `BSPForms.assetVersion` — the engine's `?v=` (for the generated stub).

### E10. Reference configs

`forms/example-it-request.json` keeps exercising every feature that fits a
single linear form (E1, E2, E3, E5, E6, E7, E8 via a mock `_`-column).
`sendEmpty` (E6a) changes every payload, so it gets its own small fixture
rather than switching the IT request over.
Branching (E4) gets its own `forms/example-branching.json`, because adding
skipped pages to the IT request would change the existing smoke flow
(precedent: the zone attestation has its own reference config). The mock
list gains the columns these need.

## 3. The builder

### Files

```
bsp-forms/builder/
├─ bsp-forms-builder.js        the builder (one classic script, ES5)
├─ bsp-forms-builder.css       .bfb-* layer on BSP tokens (scoped, additive)
├─ builder.webpart.html        the SEWP stub for the builder page
├─ README.md                   contract: kind, deploy, what it emits, limits
└─ dev/builder.dev.html        harness: mock SP (several lists), vendored Alpine
bsp-forms/dev/builder.spec.js  Playwright suite for the builder (dev-only)
```

Deployed: `Code/bsp-forms/builder/bsp-forms-builder.js` + `.css`. The
builder page (one per tenant, e.g. `SitePages/bsp-forms-builder.aspx` on
FCUPortal) embeds `builder.webpart.html`, which loads the engine
(`../bsp-forms.js?v=…`) and then the builder. The builder refuses to start
(visible `.msgbar--danger`) if `BSPForms.version` is below 0.6.0 — deploy
order is engine first.

Boot: like the engine — idempotent per mount (`[data-bspf-builder]`),
survives re-evaluation, inert placeholder in page edit mode, retryable on
failure. Interactivity = Alpine with a global factory
(`window.bspFormsBuilder = function () {…}`), no `Alpine.data()`.

### B1. Layout

Toolbar (list picker, form settings, undo/redo, Open, Download, errors
count, full-screen toggle) over three panes:

1. **Outline** — pages → sections → controls as a tree. Add page/section/
   control, move up/down buttons (keyboard path), drag handles (the
   sp-list-ordering affordance pattern), duplicate, delete. Every row shows
   an error/warn badge.
2. **Properties** — the selected item's settings (sections B3–B6).
3. **Preview** — the real engine via `mountConfig(..., { preview: true })`,
   re-mounted on change (debounced ~400 ms), a "Payload" toggle showing the
   recorded `writes` after a preview submit.

A web part column on a SharePoint page is usually too narrow for this, so a
**Full screen** toggle pins the builder as a fixed overlay over the page
chrome (Escape exits). Below ~1100 px the preview becomes a tab.

### B2. The document

The document **is** the engine JSON, plus builder metadata the engine
ignores (`normalizeConfig` doesn't reject unknown keys):

- top-level `"$builder": { "version": 1, "list": { "siteUrl", "listId",
  "listTitle", "listUrl" }, "savedAt" }`
- per field `"$builder": { "logicOnly": true }` (D5), and on pages/sections
  nothing extra.

Target written as `target.siteUrl` + `target.listUrl` (server-relative;
survives a rename, readable in diffs), with `listId` kept only in
`$builder` for "is this the same list?" checks on open.

Key order on download is fixed (`form`, `target`, `sharedColumns`,
`submitConfirm`, `confirmation`, `attachments`, `strings`, `pages`, …,
`$builder` last), 2-space indent, so re-downloads diff cleanly.

**Undo/redo:** snapshots of the JSON (cap 50), Ctrl+Z / Ctrl+Y outside text
inputs. **Autosave:** the draft goes to `localStorage` (try/catch; per
list id + form slug) on every change; on start, the builder offers to
restore the last draft.

### B3. List picker and schema

1. Site URL input (default: the page's web) → `getWebLists` → pick a list.
2. `getListSchema` → the builder's column catalog:
   - **Mappable:** Text, Note, Number, Currency, Choice, MultiChoice,
     DateTime, Boolean, User, UserMulti, URL (hyperlink format only).
   - **Not mappable (shown greyed with the reason):** Lookup/LookupMulti
     (v1), managed metadata, Calculated, Computed, Counter, Location,
     Image/Thumbnail, URL in picture format, Number with
     `ShowAsPercentage` (stores 0–1; the form would save 50 as 5000%),
     read-only and hidden fields, system fields (`FromBaseType` except
     `Title`).
3. **Changing the list** (confirm dialog): every control's column and
   `sharedColumns` are cleared, `$builder.list` and `target` replaced. The
   controls, their choices and rules stay; schema checks then flag choices
   that don't fit a newly picked column.
4. **Reopening a JSON:** the builder re-reads the schema of
   `$builder.list` (or `target`), so a column renamed/deleted since is
   flagged immediately.

### B4. Controls (palette → engine type)

| Palette | Engine | Columns offered | Builder-only settings → engine |
| --- | --- | --- | --- |
| Single line text | `text` / `email` / `phone` / `text`+`url` | Text (Note as warn) | "Validate as" none/email/phone/URL; placeholder ("example text"); min/max length (max capped at the column's `MaxLength`) |
| Multi-line text | `textarea` | Note (Text as warn) | placeholder; rows; `richText` set from the column, not editable |
| Number | `number` / `currency` | Number / Currency | min/max (within the column's bounds); integer; display input/dropdown/slider (D12; dropdown/slider offered only with min and max) |
| Yes/No | `boolean` | Boolean; Choice/Text via `values` | switch or checkbox; `toggleText`; on/off words when saving to Choice/Text |
| Choice | `choice` / `multichoice` | Choice → single, MultiChoice → multi; Text → single with free list | choices (subset per D11); colors; "Other" (`fillIn`) only if `FillInChoice`; min/max picks (multi); limit choices (E2) |
| Date | `date` | DateTime | date only / date + time (forced date only for a `DateOnly` column); rules (B5) |
| Person | `person` | User → single, UserMulti → multi | default to me (E1); max people (multi) |
| URL | `link` or `text`+`url` | URL (hyperlink) → `link`; Text → text+url | display-text input (`withDescription`, `link` only) |
| Heading | `heading` | — | text, description |
| Note | `note` | — | text (links allowed), style |
| Current user card | `currentUser` | — | label |

Common to all value controls: label, description (`hint`), required,
column, "Not saved (logic only)", full width (`span`), show-when rule.

**Schema-forced settings:** a column the list requires forces the control
to required (locked on). `MaxLength`, Number bounds, `DisplayFormat`,
`AllowMultipleValues`, `RichText`, `FillInChoice` constrain the editors as
above. `EnforceUniqueValues` and a `ValidationFormula` show a warning ("the
form can't check this; a failing submit shows SharePoint's message").

**Ids:** generated from the label (camelCase, unique, `[A-Za-z][A-Za-z0-9]*`),
editable. One **reference walker** (shared by rename, delete, and the
"rule refers to a deleted control" check) knows every place an id appears,
including in preserved structures the builder can't edit:

- rules anywhere: field/section/heading/note `visibleWhen`, page
  `visibleWhen` / `endWhen`, `lockWhen` — the `field` and `compareTo` keys,
  through `all` / `any` / `not` at any depth;
- date `rules[].compareTo`; `choicesWhen.field`;
- `prompt.confirm.set` **keys**; `afterSubmit.lookup.matchField`;
- `{field:…}` tokens in `titleTemplate`, `target.set` values,
  `confirmation`, `submitConfirm`, `afterSubmit` screens
  (`title`, `message`, `copy`, `link.text`, `redirect.url`) and
  `queryError` — in both halves of a `{en, fr}` pair.

Rename rewrites all of them; delete is blocked while any remain (the
message lists them). Phase 4 tests renaming `resourceName` in the classic
link config (its `afterSubmit.lookup.matchField` must follow).

**Shared columns:** a column already used by another control is offered
only after a confirm ("conditional variants — make sure only one is ever
visible"); the builder then maintains `sharedColumns` itself and warns if
either variant has no show-when rule.

### B5. Rules editor

One editor component used for: field/section/heading/note **show when**,
page **show when** and **end the form after this page when** (E4), and the
choice filter's driver (E2, a table rather than a rule).

- A list of conditions joined by **all / any** (one level). Each condition:
  driver field → operator (filtered by the driver's type) → value editor
  (choice picker, yes/no, number, date or `@today ± days`).
- Drivers offered: fields **before** the target in form order (pages: fields
  on earlier pages; `endWhen`: this page or earlier). Logic-only controls
  are valid drivers.
- An imported rule deeper than one level (or with `not`) is shown as
  read-only JSON with "Replace" (start over) — never silently rewritten.
- Date control rules: "not in the past", "at least N business days ahead"
  (E5), "weekdays only" (E5), "after/before another date field" — each with
  an optional message. Calendar rules offer block/warn; "at least N business
  days ahead" offers block/warn for the lead time but **always** adds a
  blocking `businessDay` (D8); "weekdays only" is block-only. Using a
  business-day rule adds `form.businessHours` (`America/Toronto`, Mon–Fri,
  09:00–17:00) if it's missing.

### B6. Form-level settings

Title, intro (links allowed), show title; appearance (frame, header, tint,
icon path); `titleTemplate` (offered and required when `Title` is required
and no control maps to it; token picker for `{field:…}`, `{user:name}`,
`{date}`…); submit confirm (D15: title, message, buttons default **Yes** /
**No**); confirmation (title, message, "submit another", redirect URL +
seconds — E7, URL validated with the engine's `safeHref` rule);
attachments (D18: enabled only when the list has `EnableAttachments`; max
files 1–5, max size 1–10 MB, required, accepted extensions, placed at the
end of a chosen section; with branching, only sections on always-reachable
pages are offered — E4).

### B7. Checks and download

Download is disabled while there are **errors**; warnings don't block.
Errors come from two separate sources, shown in one errors panel but
labelled by source (click → select the control). Passing (2) proves the
config **loads**; only (1) speaks to whether a **save** will succeed, and
even (1) can't see list-level rules (warned, not checked).

1. **Schema checks (builder)** — each one an explicit check on a named
   schema property, not just `BSPForms.compat`:
   - unmapped value control (not logic-only); column missing from the schema;
     type incompatible (`compat`); `EntityPropertyName` mismatch (E8);
   - Choice/MultiChoice subset violations; "Other" without `FillInChoice`;
   - `MaxLength`, `MinimumValue`/`MaximumValue` exceeded by the control;
   - DateOnly column with "date + time"; URL in picture format; percent
     Number; read-only/hidden columns;
   - **required columns, path-aware:** a column the list requires must be
     written on **every** submit path. Satisfied only by a mapped control
     that is unconditionally active (no `visibleWhen` on it or its section,
     no `choicesWhen`, on a page with no `visibleWhen` and not after any
     page with `endWhen`) and itself required; or by `target.set`; or for
     `Title` by a `titleTemplate` containing literal text or an
     always-filled token (`{form:title}`, `{date}`, `{time}`, `{now}`,
     `{user:name}`, `{user:email}`); or by a column `DefaultValue` (only
     where B0 confirms SharePoint applies it to an omitted required
     column). Shared variants never count — the builder can't prove one is
     always visible;
   - attachments on a list without attachments; attachments section on a
     page some path skips;
   - dropdown/slider without integer bounds; empty choice list; a reference
     to a missing control (the walker, B4);
   - **warnings:** `EnforceUniqueValues`, a column `ValidationFormula`, a
     list `ValidationFormula` ("the form can't check this; a failing submit
     shows SharePoint's message").
2. **Engine load check** — `BSPForms.normalize(json)`: anything the engine
   would reject.

Download produces:

- `<slug>.json` — the config.
- `<slug>.webpart.html` — the stub, with `data-config` =
  `<engine folder>/forms/<slug>.json` and the engine `src` with the current
  `?v=` (both absolute, derived from the engine script the builder page
  loaded), and an optional `data-validate` for the first load (checkbox).

After download the builder shows the deploy checklist (upload JSON to
`Code/bsp-forms/forms/`, page from template + stub, first load with
`data-validate`, one test submit).

**Open:** a local `.json` file (FileReader), or a deployed config URL
(fetched read-only with `no-cache`). Refused: `assignments` (D3). Shown as
"preserved, not editable": `afterSubmit`, `queryError`, `form.vars`,
`form.headerCard`, `form.languages` + any `{en,fr}` pairs (D4), `strings`,
`target.set`, field `query`/`normalize`/`readOnly`/`prompt`/`lockWhen`,
`hidden` and `lookup` controls. The outline shows those controls with a
lock icon; they can be moved or deleted, and their advanced keys are
preserved **semantically** (parsed and re-serialized in the fixed key
order, so values are deep-equal but whitespace and key order may differ —
Phase 4's round-trip test asserts deep equality, not bytes). Ids inside
them are still kept consistent by the reference walker (B4).

## 4. Gotchas this plan designs around

1. **Same-origin only.** The builder reads schemas over REST from the page,
   so it must be hosted on the tenant; it cannot run from disk except
   against the mock.
2. **One validator.** The builder never re-implements engine validation; it
   calls `BSPForms.normalize` and shares `BSPForms.compat` with the doctor.
3. **REST accepts off-list choice values.** D11 keeps Choice columns to
   their own values; otherwise list filters break silently.
4. **Omitted columns get the SharePoint default.** An optional control left
   empty is not sent, so the column's `DefaultValue` applies server-side
   (e.g. the GSI list's Priority `Standard`). The properties panel shows the
   column default next to "required".
5. **Preview must not navigate or write** — including `ensureUser`, which
   the engine calls on every person pick (E9b preview adapter).
6. **Branching vs attachments:** the dropzone must sit on a page every path
   reaches (E4, B6).
7. **Page rules can't depend on their own page** (E4) — otherwise a page
   could hide itself mid-answer.
8. **Percent Number columns** store fractions; excluded in v1 (B3).
9. **Same-titled lists on two webs** (the pnp entity-type cache collision)
   are already handled by `listEntityType`; the builder writes `listUrl`, not
   a title.
10. **Native date pickers** can't disable weekends; validation enforces E5.
11. **A slider can't be empty natively** — E3's unset state.
12. **pnp `setup` is global.** The builder makes no SharePoint calls of its
    own; everything goes through the engine adapter, which re-asserts
    `baseUrl` per call.
13. **The page URL never chooses a redirect** — E7 keeps the config-only
    rule.
14. **Omitted means "use the column default"** in SharePoint, so a cleared
    field would silently save the default; E6a's `sendEmpty` fixes it for
    builder forms only.
15. **Stale answers on skipped pages** read as empty for every rule (E4);
    hidden sections keep the old raw-value behavior.
16. **`DisplayFormat` is type-specific** (B3/E9a).

## 5. Phases and acceptance

Each phase ends with its tests green, docs updated, a commit on
`bsp-forms-builder`, and the state file updated. Phases 1 and 4 each get an
xo Codex review round.

**B0 — schema probe (dev, ~1 hour).** On the dev site, read a purpose-made
list `BSPF-Builder-Test` (one column of every type the builder handles plus
the excluded ones, a required column, a `_`-prefixed column, FillInChoice
on/off, DateOnly and DateTime, percent Number, picture URL). Script:
`dev/live/live-builder-list.ps1`. B0 answers, by REST against real columns
(the mock can't): which schema properties pnp v2 returns without `$select`
(decides E9a's fetch shape); whether each E6a explicit-empty shape is
accepted and saves empty (text, note, choice, multichoice, number, date,
link, single/multi person); whether an omitted column with a
`DefaultValue` gets the default, including a **required** one (decides
whether B7 may count a default as satisfying a required column); and the
`EntityPropertyName` of the `_`-prefixed column (E8).

**B0 results (dev, 2026-10-10, `live-builder-probe.js`)** — done:
- pnp v2 `fields.filter('Hidden eq false').get()` with **no `$select`**
  returns every derived property the builder needs (`Choices` as an array,
  `FillInChoice`, `MaxLength`, `DisplayFormat`, `MinimumValue`/
  `MaximumValue` — **±1.797e308 when unbounded**, `ShowAsPercentage`,
  `RichText`, `AppendOnly`, `NumberOfLines`, `AllowMultipleValues`,
  `SelectionMode`, `EnforceUniqueValues`, `ValidationFormula`,
  `DefaultValue` as a string, `EntityPropertyName`, `LookupList`).
  `getWebLists` with `RootFolder` expand works. `pnp.Web` is absent.
- Explicit empties all save empty: `null` for Text, Note (plain and rich),
  Number, Currency, Choice, DateTime, URL, `<Person>Id`; `{ results: [] }`
  for MultiChoice and `<People>Id`. `''` also empties Text/Choice/Note.
- Omitted columns get their `DefaultValue` (Text, Number, Choice), and an
  omitted **required** Choice with a default saves its default.
- **REST does not enforce `Required`:** `ChoiceReqDef: null` on a required
  column was accepted and saved empty. So the B7 required-column check is
  the only guard; a gap there means bad data, not a failed save.
- `_Under` as a payload key → 400 ("property does not exist");
  `OData__Under` works; `EntityPropertyName` is `OData__Under`, and the
  digit-led column is `_x0032_Num` / `OData__x0032_Num` — E8's rule holds.
- A column `ValidationFormula` violation → 500 "List data validation
  failed." (B7 warns; nothing more to do).
- UI-created lists drop hyphens from their URL (`BSPDash Test  Empty`) —
  another reason to read `RootFolder/ServerRelativeUrl`, never build it.

**Phase 1 — engine 0.6.0 (E1–E8, E9a, E10).** Acceptance:
- smoke suite green, with new checks for each feature, including: page
  skip/end + stepper numbering + Back after changing a branch answer; a
  **stale answer** on a now-skipped page doesn't drive a later page rule or
  appear in the payload; the current page clamps when it becomes inactive;
  `pages[0].visibleWhen` is a normalize error; inactive-page fields absent
  from the payload; choicesWhen pruning (single, multi, fill-in, boolean
  driver) and the "no options → inactive" case; slider unset/required/clear
  and dropdown values saved as numbers; every clear button; `sendEmpty`
  payload shapes, and that existing configs' payloads are byte-identical to
  0.5.0's for the same answers; business-day rules with the clock pinned on
  Fri/Sat/Sun and across a DST change, browser zone Pacific, including a
  weekend date beyond the lead time (passes `minBusinessDays`, fails
  `businessDay`); `@me` prefill, reset, and not overwriting an earlier pick;
  confirmation redirect; `OData_` payload key; `BSPForms.lists()` exposes no
  write method.
- all six existing configs normalize unchanged; their smoke checks pass
  untouched.
- dev live regression: `live-submit.js`, `live-creative.js`,
  `live-classic.js`, `live-zone.js` (admin + non-admin) all pass on 0.6.0.
- CONFIG-REFERENCE, Copilot guide, README features, PROD-DEPLOY §1 (engine
  update) current.

**Phase 2 — builder core (B1 outline + properties panes, B2, B3, B4, B7
schema checks and download).** No preview pane yet. Harness with a mock
tenant (three lists incl. the B0 column set). Acceptance
(`builder.spec.js`): pick list → schema catalog correct (mappable vs
excluded with reasons); add one of each control, map, required forced by
schema; switching lists clears columns; unmapped blocks download,
logic-only doesn't; each B7 schema check fires on a crafted case, including
a required column mapped only on a skippable page; renaming an id rewrites
the references Phase 2 can create (`{field:}` tokens in `titleTemplate`);
undo/redo; autosave restore; downloaded JSON passes `BSPForms.normalize`
and, loaded into the engine harness, submits a payload whose keys are
exactly the mapped columns.

**Phase 3 — rules, settings, preview (B5, B6, E9b, the B1 preview pane).**
Acceptance: show-when on field/section/page, end-form, choice filter, date
rules (a business-day rule emits the blocking `businessDay`), submit
confirm, confirmation redirect, attachments limits — each built in the
builder, previewed, and asserted in the downloaded JSON; rename/delete
through rules created here; the E9b preview tests (no write requests incl.
`ensureUser`, no navigation on any redirect path, clean `destroy()`).

**Phase 4 — open/round-trip, live E2E, docs.** Acceptance:
- round-trip: each of `forms/*.json` except the zone attestation opens,
  re-downloads, and is deep-equal to the original apart from `$builder` and
  key order; the zone attestation is refused with the D3 message.
- the full reference walker: renaming `resourceName` in the classic link
  config carries `afterSubmit.lookup.matchField` and its `{field:}` tokens;
  renaming the creative form's `priority` carries `prompt.confirm.set`;
  delete is blocked while references remain.
- dev live regression of all four live forms again on the final 0.6.0.
- live dev E2E (sp-env §0 — the agent verifies, not the user): builder page
  on the dev site; pick `BSPF-Builder-Test`; load a scripted draft; download
  (Playwright download capture); upload JSON to dev `Code/bsp-forms/forms/`;
  page via `live-page.ps1`; submit through Playwright; read the item back
  over REST and compare every column.
- builder README, `bsp-forms/CLAUDE.md` (file map; scope guard no longer
  lists "builder UI"), repo README kinds table note, PROD-DEPLOY §4 "Install
  the builder".

**Phase 5 — prod (user).** Engine 0.6.0 per PROD-DEPLOY §1, builder files,
builder page from the template. Then build one real form with it.

## 6. Out of scope (v1)

Bilingual editing; lookup controls; URL-parameter fields; `afterSubmit`
lookups; assignments; prompts/locks; holidays; "go to page X" branching;
nested rule groups; writing files to SharePoint from the builder; creating
or changing list columns; a raw JSON editor (view + copy only).

## 7. Review log

**xo turn 7 — Codex (gpt-6-sol), 2026-10-10, against 571ea01.** 11
findings, all accepted:

| # | Sev | Finding | Where fixed |
| --- | --- | --- | --- |
| 1 | High | Preview could still write via `ensureUser` | E9b (simulated `ensureUser`, synthetic add results), gotcha 5, Phase 3 |
| 2 | High | Required-column check ignored branching | B7 path-aware rule, Phase 2 test |
| 3 | High | `minBusinessDays` let a far-out weekend pass | E5 note, B5 (builder always adds blocking `businessDay`), Phase 1 test |
| 4 | High | Page rules could branch on stale answers from skipped pages | E4 "inactive pages read as empty", Phase 1 test |
| 5 | High | Clear could save the column default | E6a `target.sendEmpty`, B0, gotcha 14 |
| 6 | Med | Builder adapter would expose writes / need a target | E9a read-only `BSPForms.lists()` facade |
| 7 | Med | Rename missed `matchField` and `prompt.confirm.set` | B4 reference walker, Phase 4 tests |
| 8 | Med | "Loads" ≠ "saves"; compat table too coarse; use `EntityPropertyName` | B7 two labelled sources + explicit checks, E8 |
| 9 | Med | No defined behavior with zero active pages | E4: page 1 unconditional, clamp rule |
| 10 | Med | Preview pane and rename tests in the wrong phases | §5 phases rewritten; E9 split into E9a/E9b |
| 11 | Low | Mock already has `login`; `@me` must not overwrite a pick | E1 |

Also adopted from its "missing gotchas": every redirect path guarded in
preview (E9b), type-specific `DisplayFormat` (E9a, gotcha 16), and
"semantic, not byte-for-byte" preservation (B7). Review cost: 1.41M input
tokens / 9.8K output.
