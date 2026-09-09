# BSP Forms

A JSON-configured replacement for MS Forms that runs inside SharePoint pages.
One shared engine renders an attractive, multi-page form built on the
**BMO SharePoint Design System (BSP)** and writes submissions — including
multi-file attachments — to a SharePoint list via the self-hosted **pnpjs v2**
bundle.

No build step, no CDN, no per-form code: a form is one JSON file plus a
two-line web part insert.

```
┌ modern SharePoint page ─────────────────────────────┐
│ custom-script web part                              │
│   <div data-bsp-form data-config="…/my-form.json">  │
│   <script src="…/bsp-forms/bsp-forms.js?v=1">       │
│         │                                           │
│         ▼                                           │
│   bsp-forms.js  ── injects BSP CSS + sprite + its   │
│         │          own layer + Alpine + pnp         │
│         ▼                                           │
│   renders form from JSON ── validates ── submits ──▶ SharePoint list
│                                          (+ attachments on the item)
└─────────────────────────────────────────────────────┘
```

## Features

- **Card presentation** by default: a raised BSP surface with a tinted header
  band (optional Abacus brand icon), section hairlines, and a footer nav strip
  — all token-built. `form.appearance` switches frame/band/tint or drops back
  to a flat layout; `confirmation.illustration` puts a BMO spot illustration
  on the thank-you screen.
- **Pages & sections** with a stepper, per-page validation, back navigation.
- **Field types:** text, textarea, email, phone, number, currency, choice
  (SharePoint-style colored **pill dropdown**, optional fill-in), multichoice
  (pill multi-select, optional fill-in), yes/no switch, date / date+time,
  person & multi-person (**directory-searching people picker**), hyperlink,
  lookup (options from another list), plus static `heading` and `note` blocks.
- **Show/hide rules** (`visibleWhen`) on fields and sections, driven by yes/no,
  choice, multichoice, or date fields (date rules compare two date fields or a
  date field against the submission date, with a day offset). Hidden fields are
  neither validated nor submitted.
- **Date validation rules** in `block` (can't continue) or `warn` (note only)
  mode — e.g. "due date must be ≥ 2 days out" as a warning, "end date must be
  after start date" as a hard stop.
- **Conditional choice variants:** several fields may map to the **same list
  column**, declared explicitly via top-level `sharedColumns` (undeclared
  duplicates are config errors). Only one should be visible at a time; if more
  than one is, the **later field in the JSON wins** at submit.
- **Attachments:** drag-drop or browse, count/size/extension limits from
  config, uploaded as native list-item attachments. If the item saves but an
  upload fails, the response is **never duplicated** — the user retries only
  the failed files.
- **All UX and error strings** live in the engine's defaults and are
  overridable per form via `strings` (intro, title, confirmation screen, and
  every message).
- **Doctor mode:** add `data-validate` to the div (or run
  `BSPForms.validate(div)` in devtools) to render a report comparing the
  config's column mappings against the real list schema.
- **Edit-mode aware:** in page edit mode the web part shows an inert
  placeholder naming the config file, so the web part stays selectable.

## Deployment layout

The engine assumes the standard `/sites/FCUPortal/Code/` layout and derives
every path from its own script URL — deploy elsewhere and it still works, as
long as the siblings hold:

```
Code/
├─ bsp-design/         the BSP design system (colors_and_type.css,
│                      components.css, fluent-basic-icons.svg)
├─ lib/                alpine.js · pnp2.bundle.js  (self-hosted)
└─ bsp-forms/          ← this folder's runtime files
   ├─ bsp-forms.js     the engine (one classic script)
   ├─ bsp-forms.css    the form layer (BSP-token-built)
   └─ forms/*.json     one config per form
```

Non-standard layouts: set `window.BSP_FORMS_SETTINGS = { designBase, libBase,
alpineUrl, pnpUrl }` before the engine script (see
`webpart/bsp-forms.webpart.html`).

**Cache-busting:** the web part's `?v=` on `bsp-forms.js` is the version stamp
— bump it on every engine deploy (it is reused for `bsp-forms.css`). Configs
are fetched with `cache: 'no-cache'`, so JSON edits go live on refresh.

## Adding a form

1. **Create the list** with columns matching your fields (see the type table
   in `docs/CONFIG-REFERENCE.md`). Grant your audience **Add** permission; for
   MS-Forms-like privacy set the list's item-level permissions to
   *"Read items that were created by the user"* / *"Create items and edit
   items that were created by the user"* (List settings → Advanced settings).
2. **Write the config JSON** (start from `forms/example-it-request.json`;
   full reference in `docs/CONFIG-REFERENCE.md`) and upload it to
   `bsp-forms/forms/`.
3. **Insert the web part**: copy `webpart/bsp-forms.webpart.html`, point
   `data-config` at your JSON, and point the custom-script web part at it.
4. **Verify the mapping**: temporarily add `data-validate` to the div and load
   the page — fix anything the report flags, then remove the attribute.

The div fills its container (100% width, no margin/padding) — the web part
supplies the page spacing, so place and size it however the page needs.

## Local development

`dev/index.html` runs the whole app with **zero SharePoint and zero network**:
a mock adapter (`dev/mock-sp.js`) records writes to
`window.__BSPF_MOCK_WRITES__`, and Alpine is vendored (dev-only) in
`dev/vendor/alpine.js`. The BSP CSS is read from a **sibling clone of
`bsp-design-system`**.

```
cd <folder containing various/ and bsp-design-system/>
python -m http.server 8000
# → http://localhost:8000/various/bsp-forms/dev/index.html   (?validate for the doctor)
```

Set `window.BSPF_MOCK_FAIL = { addItem: true }` (or `addAttachment`, …) in
devtools to exercise the error paths.

**Regression suite:** `dev/smoke.spec.js` drives the harness headlessly
(Playwright, dev-only — never deployed) through edit mode, the config-error
paths, the full submit flow, and the payload invariants:

```
node various/bsp-forms/dev/smoke.spec.js   # server running as above
```

If a form fails to initialize on a live page (e.g. a transient config fetch),
the mount stays retryable: `BSPForms.retry(div)` from devtools, or any
re-scan, re-attempts it.

## Caveats & design notes

- **People search** uses SharePoint's `ClientPeoplePickerSearchUser` API
  restricted to user principals — DLs, security groups, and SharePoint groups
  never appear. Exclusion of disabled/room/service accounts is **best-effort**
  (entities that resolve without a usable email are dropped; SharePoint's
  people API has no reliable "disabled" flag). No group-based restriction, by
  design.
- **pnpjs v2 setup is global** (`pnp.sp.setup({ sp: { baseUrl } })`). The
  engine re-asserts the base URL before its own operations, but be aware if
  another app on the same page also calls `setup` concurrently.
- **Date-only values** are written as noon local time, so the stored date
  can't shift a day across time zones.
- **No branching, drafts, or post-submit actions** in this phase; the config
  format leaves room for them (`visibleWhen` is the seam branching will reuse).
- **50 MB** is the practical single-request ceiling for an attachment upload;
  keep `maxFileSizeMb` well below it.

## Files

| File | Role |
| --- | --- |
| `bsp-forms.js` | The engine — classic IIFE, idempotent per mount, deploy as-is. |
| `bsp-forms.css` | Additive BSP layer (`.bspf-*`): pills, combos, people picker, attachments. |
| `forms/example-it-request.json` | Reference config exercising every feature. |
| `webpart/bsp-forms.webpart.html` | The web part insert snippet. |
| `docs/CONFIG-REFERENCE.md` | Full JSON reference — every key, type, and rule. |
| `dev/` | Local harness + mock adapter + vendored Alpine + `smoke.spec.js` regression suite (never deployed). |

Deploy only `bsp-forms.js`, `bsp-forms.css`, and your `forms/*.json`.
