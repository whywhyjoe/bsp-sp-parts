# BSP Forms builder — build plan

Status: **draft for review** (2026-10-10). Thread state:
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

- Validation: `@me` only on `person`.
- Mock: `userInfo()` already exists; add a `login`.

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

- `pages[i].visibleWhen` — the page is skipped when false. Its rule may only
  reference fields on **earlier pages** (normalize error otherwise — a page
  can't hide itself by its own answers).
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
  recomputed live; the current page index is clamped to an active page.
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

### E7. Redirect after the plain success message

`confirmation.redirect: { "url": "...", "seconds": 5 }` — reuses
`startRedirect`/`countdownText` and the "Go now" link. Same `safeHref` rule
and config-only URL (no page-URL override). "Submit another" stays available
and cancels the countdown.

### E8. Column names starting with `_`

The payload key for an internal name starting with `_` becomes `OData_` +
name (and `OData_<name>Id` for person). The doctor and builder compare by
internal name, unchanged.

### E9. Public API for the builder

- `BSPForms.normalize(raw, lang)` → `{ errors: [...] }` — the exact
  validation the page runs. The builder's "valid" means "loads on the page".
- `BSPForms.mountConfig(el, raw, { preview: true })` → `{ destroy(), writes }`.
  Renders a config object into an element (no `data-bsp-form`, so `scan()`
  never touches it). `preview: true` wraps the adapter: reads go through
  (people search, current user, lookups), `addItem`/`addAttachment` are
  recorded in `writes` and never sent, and a redirect shows "Would go to
  <url>" instead of navigating (a preview must not take the builder page
  away). `destroy()` tears down Alpine, timers and `NS._defs[uid]`.
- `BSPForms.adapter()` → a read-only adapter for the builder: `ready()`,
  `userInfo()`, `getWebLists(webUrl)`, `getListSchema({ siteUrl, listId })`.
  These live in `makeAdapter` (the "every SharePoint read stays in the
  adapter" rule) and in `dev/mock-sp.js`.
  - `getWebLists`: non-hidden lists with `BaseTemplate eq 100` (custom
    lists), selecting `Id, Title, RootFolder/ServerRelativeUrl,
    EnableAttachments, ItemCount`.
  - `getListSchema`: list properties + **all** fields **without** `$select`,
    so derived-type properties come back (`Choices`, `FillInChoice`,
    `MaxLength`, `DisplayFormat`, `AllowMultipleValues`, `MinimumValue`,
    `MaximumValue`, `ShowAsPercentage`, `RichText`, `AppendOnly`,
    `NumberOfLines`, `EnforceUniqueValues`, `ValidationFormula`,
    `DefaultValue`, `EntityPropertyName`). **Verify on dev first** (B0) that
    pnp v2's accept header returns these; fall back to per-type `$select`
    with `odata=verbose` if not.
- `BSPForms.compat` — the doctor's `TYPE_COMPAT` table, so the builder and
  doctor share one compatibility source.
- `BSPForms.assetVersion` — the engine's `?v=` (for the generated stub).

### E10. Reference configs

`forms/example-it-request.json` keeps exercising every feature that fits a
single linear form (E1, E2, E3, E5, E6, E7, E8 via a mock `_`-column).
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
editable. Renaming an id rewrites every reference: rules (`field`,
`compareTo`), `choicesWhen.field`, `{field:…}` tokens in `titleTemplate`,
`target.set`, confirmation/submitConfirm text.

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
  block/warn and an optional message. Using a business-day rule adds
  `form.businessHours` (`America/Toronto`, Mon–Fri, 09:00–17:00) if it's
  missing.

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
Errors come from two places, shown together in an errors panel (click →
select the control):

1. Builder checks: unmapped value control (not logic-only); column missing
   from the schema or no longer compatible; Choice subset violations;
   list-required column unmapped (Title excepted with `titleTemplate`);
   attachments on a list without attachments; dropdown/slider without
   bounds; empty choice list; rule referring to a deleted control.
2. `BSPForms.normalize(json)` — anything the engine would reject.

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
lock icon; they can be moved or deleted but their advanced keys pass
through byte-for-byte.

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
5. **Preview must not navigate or write** (E9 preview adapter).
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

## 5. Phases and acceptance

Each phase ends with its tests green, docs updated, a commit on
`bsp-forms-builder`, and the state file updated. Phases 1 and 4 each get an
xo Codex review round.

**B0 — schema probe (dev, ~1 hour).** On the dev site, read a purpose-made
list `BSPF-Builder-Test` (one column of every type the builder handles plus
the excluded ones, a required column, a `_`-prefixed column, FillInChoice
on/off, DateOnly and DateTime, percent Number, picture URL). Script:
`dev/live/live-builder-list.ps1`. Confirm which schema properties pnp v2
returns without `$select`. Outcome decides E9's fetch shape.

**Phase 1 — engine 0.6.0 (E1–E10).** Acceptance:
- smoke suite green, with new checks for each feature, including: page
  skip/end + stepper numbering + Back after changing a branch answer;
  inactive-page fields absent from the payload; choicesWhen pruning (single,
  multi, fill-in, boolean driver) and the "no options → inactive" case;
  slider unset/required/clear and dropdown values saved as numbers; every
  clear button; business-day rules with the clock pinned on Fri/Sat/Sun and
  across a DST change, browser zone Pacific; `@me` prefill and reset;
  confirmation redirect (and that a preview mount doesn't navigate);
  `OData_` payload key; `mountConfig` preview records writes and `destroy()`
  leaves no `_defs` entry.
- all six existing configs normalize unchanged; their smoke checks pass
  untouched.
- dev live regression: `live-submit.js`, `live-creative.js`,
  `live-classic.js`, `live-zone.js` (admin + non-admin) all pass on 0.6.0.
- CONFIG-REFERENCE, Copilot guide, README features, PROD-DEPLOY §1 (engine
  update) current.

**Phase 2 — builder core (B1–B4, B7 download).** Harness with a mock tenant
(three lists incl. the B0 column set). Acceptance (`builder.spec.js`): pick
list → schema catalog correct (mappable vs excluded with reasons); add one
of each control, map, required forced by schema; switching lists clears
columns; unmapped blocks download, logic-only doesn't; id rename rewrites
references; undo/redo; autosave restore; downloaded JSON passes
`BSPForms.normalize` and, loaded into the engine harness, submits a payload
whose keys are exactly the mapped columns.

**Phase 3 — rules, settings, preview (B5, B6, preview pane).** Acceptance:
show-when on field/section/page, end-form, choice filter, date rules,
submit confirm, confirmation redirect, attachments limits — each built in
the builder, previewed, and asserted in the downloaded JSON; the preview
records writes and never navigates.

**Phase 4 — open/round-trip, live E2E, docs.** Acceptance:
- round-trip: each of `forms/*.json` except the zone attestation opens,
  re-downloads, and is deep-equal to the original apart from `$builder` and
  key order; the zone attestation is refused with the D3 message.
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
