# BSP Forms — config reference

A form is one JSON document. `forms/example-it-request.json` shows everything
below in use.

```
{
  "form":          { … title / intro boilerplate … },
  "target":        { … which list, which site, Title template … },
  "submitConfirm": { … optional "are you sure?" before saving … },
  "confirmation":  { … post-submit screen … },
  "attachments":   { … file rules … },
  "strings":       { … any UX/error string override … },
  "pages":         [ { sections: [ { fields: [ … ] } ] } ]
}
```

`forms/example-it-request.json` is the reference for the single-item form;
`forms/ps-zone-attestation.json` is the reference for bilingual text,
`assignments`, `currentUser`, `headerCard`, `submitConfirm`, `target.set` and
section `tint`; `forms/example-branching.json` is the reference for
branching (page `visibleWhen` / `endWhen`), `choicesWhen` on a yes/no field,
business-day date rules, `target.sendEmpty`, a `_`-prefixed column and
`confirmation.redirect`.

## Bilingual forms (`form.languages`)

`"languages": ["en", "fr"]` makes a form bilingual. Then **any** text value in
the config, anywhere, may be a pair instead of a string:

```json
"title": { "en": "Physical Security Zones Attestation", "fr": "Attestation des zones de sécurité physique" }
```

- The language comes from the repo's bilingual library (`bilingual/intl.js`,
  `window.intl`). If the page doesn't load it already, the engine loads it from
  the shared `lib/` folder beside `bsp-design/` (`intlUrl` in
  `BSP_FORMS_SETTINGS` overrides that). Its language detection is whatever
  `intl.getLang()` returns. Today that's the `?lang=fr` placeholder; see the
  bilingual README.
- A missing or empty `fr` falls back to `en`, as in the intl library.
- Every engine message has a built-in French version (`DEFAULT_STRINGS_FR` in
  `bsp-forms.js`); `strings` overrides take pairs too.
- `intl.setLang()` re-renders the form in place. Answers, loaded rows, the
  page and the screen carry over.
- The form root gets `lang="en|fr"` and the `lang-keep` class, so screen
  readers use the right voice and the library's dual-DOM CSS never hides it.
- **Saved values never change with the language.** Give a choice a bilingual
  `label` and keep its `value` in one language (see `choices`).
- Without `languages`, pairs still resolve, to English.

## `form`

| Key | Default | Notes |
| --- | --- | --- |
| `title` | — | Shown as the form heading and available as `{form:title}`. |
| `intro` | — | Boilerplate paragraph under the title. Supports links — see *Links in text*. |
| `showTitle` | `true` | Set `false` to suppress the heading (e.g. the page already has one). |
| `appearance` | see below | How the form sits on the page. |
| `vars` | — | A bucket of named values for this form — `{ "converterUrl": "https://…", "redirectSeconds": 5 }` — used anywhere tokens work as `{var:name}`. For settings that change rarely; nothing in the page URL can override them. |
| `businessHours` | — | The business calendar for `withinBusinessDays` rules and date `prompt`s — see *Business time*. Required if either is used. |
| `languages` | — | `["en", "fr"]` — see *Bilingual forms*. |
| `headerCard` | — | A link tile beside the intro: `{ "title", "text", "url", "icon" }`. `url` takes `{var:…}` (keep the address in `vars`), opens in a new tab, and must be http(s) or server-relative. While it's empty or unsafe the card isn't shown. `icon` is an asset path (`"abacus-icons/light-bulb-48.svg"`) or a sprite name (`"shield"`). |

### `form.appearance`

| Key | Default | Notes |
| --- | --- | --- |
| `frame` | `"card"` | `"card"` = raised surface (border, radius, shadow, padded content, footer nav strip). `"plain"` = the flat chrome-less layout. |
| `header` | `"band"` | `"band"` = tinted header strip behind title/intro; `"plain"` = no strip. |
| `tint` | `"sky"` | Band ground: `sky` · `blue` · `neutral` (the engagement-layer surface tints). |
| `icon` | — | Brand icon shown at the right of the header, e.g. `"abacus-icons/digital-form-48.svg"`. Paths without a leading `/` resolve against the deployed `bsp-design/` folder; absolute URLs pass through. |

## `target`

| Key | Default | Notes |
| --- | --- | --- |
| `listTitle` | — | Display name of the destination list. One of `listTitle`/`listId` is **required**. |
| `listUrl` | — | The list's URL, server-relative (`/sites/x/Lists/My List`) or relative to `siteUrl` (`Lists/My List`). Survives a rename of the list's display name, so prefer it when the title is unstable. Wins over `listTitle`. |
| `listId` | — | List GUID; wins over `listUrl` and `listTitle`. |
| `siteUrl` | current site | Absolute or server-relative URL of the target web, e.g. `/sites/FCUPortal`. |
| `titleTemplate` | — | Fills the list's `Title` column when no field maps to `Title`. Tokens: `{form:title}` `{user:name}` `{user:email}` `{date}` `{time}` `{now}` `{field:<id>}` `{var:<name>}` (and `{lookup}` on `afterSubmit` screens, `{row:<column>}` on an assignments form). |
| `set` | — | Columns filled from templates, not fields: `{ "UserName": "{user:name}", "UserEmail": "{user:email}", "AttestationTime": "{now}" }`. Same tokens as `titleTemplate`. An empty result is left out; a field mapped to the same column wins. |
| `sendEmpty` | `false` | `true`: every shown, mapped field that's empty is saved as **empty** (`null`; `{ "results": [] }` for multi-choice and multi-person). Without it an empty field is left out of the save, and SharePoint then fills in the column's **default** — so clearing a Priority that defaults to `Standard` would save `Standard`. Columns whose fields are all hidden (or on skipped pages) are still left out. The form builder always sets it. |

**Column names starting with `_`** (and the `_x0032_…` names SharePoint makes
for columns created with a leading digit or symbol): write `column` as the
internal name; the engine saves it as `OData_<name>`, which is how
SharePoint's REST API names those columns.

**Tokens.** `{user:name}` and `{user:email}` are the signed-in user from
SharePoint (the email falls back to the account's UPN). `{now}` is the moment of
the submit as ISO 8601 UTC, which a Date and Time column takes as-is.
SharePoint shows it in the site's regional time zone, so an Eastern site shows
Eastern time. Every item from one submit shares the same `{now}`.

## `submitConfirm`

A last look before saving, for submits that can't be undone. After the form
validates, a dialog shows; nothing is saved until the user confirms.

| Key | Default | Notes |
| --- | --- | --- |
| `message` | — (required) | The dialog text (supports links). |
| `title` | strings.submitConfirmTitle | Dialog heading. |
| `confirm` / `cancel` | `"Confirm"` / `"Go back"` | Button labels. |

Focus starts on the cancel button, and **Escape goes back**. That's the
opposite of a date `prompt`, whose Escape keeps the date.

## `confirmation`

| Key | Default | Notes |
| --- | --- | --- |
| `title` | strings.confirmTitle | Heading of the post-submit screen. |
| `message` | strings.confirmMessage | Body text. |
| `allowAnother` | `true` | Show a "Submit another response" button (resets the form). |
| `redirect` | — | `{ "url": "/sites/x/SitePages/Home.aspx", "seconds": 5 }`: a countdown under the message, then the page goes there ("Go now" skips the wait; "Submit another" cancels it). `seconds` is 0–60, default 5. Only `http(s)` or server-relative URLs; `{var:…}` works. The URL comes from the config only, never the page URL. |
| `anotherLabel` | strings.confirmAnother | Label for that button. |
| `illustration` | — | Artwork above the title, replacing the default checkmark icon — e.g. `"spot-illustrations/checkmark-l.svg"` (resolved against `bsp-design/` like `appearance.icon`). |

## `attachments`

Attachments are form-level (they attach to the created list item), rendered as
a dropzone at the bottom of the last page unless `page` says otherwise.

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `false` | Master switch. |
| `required` | `false` | At least one file must be attached. |
| `label` / `hint` | `"Attachments"` / auto | The auto hint states the limits. |
| `maxFiles` | `10` | Count ceiling. |
| `maxFileSizeMb` | `10` | Per-file ceiling (keep well under SharePoint's 50 MB request limit). |
| `accept` | `null` (any) | Allowed extensions, e.g. `[".pdf", ".docx"]`. |
| `page` | last page | 0-based page index to render the dropzone on (in its own section at the end of the page). |
| `section` | — | A section `id`: render the dropzone at the end of that section instead (full width in a two-column section). The section must not have `visibleWhen`. Wins over `page`. |

## `strings`

Any key here overrides the engine default of the same name — button labels,
validation messages, people-picker text, attachment errors, confirmation
defaults, the edit-mode note, everything. The full catalog is the
`DEFAULT_STRINGS` object at the top of `bsp-forms.js` (French:
`DEFAULT_STRINGS_FR`). Messages support the placeholders shown there (`{min}`,
`{max}`, `{name}`, `{other}`, …). Values may be `{ "en", "fr" }` pairs.

## `pages`

`pages[]` → `sections[]` → `fields[]`. Pages render with a stepper (when there
is more than one) and validate on **Next**; sections group fields under an
optional title/description and can carry their own `visibleWhen`.

| Key (page / section) | Notes |
| --- | --- |
| `id` | Optional but recommended; auto-generated if missing. |
| `title`, `description` | Optional headings. `description` supports links. |
| `icon` (sections only) | A Fluent sprite name (`person`, `edit`, `document`, `calendar-ltr`, … — the `fluent-basic-icons.svg` set, without the `ic-fluent-`/`-24-regular` wrapper). Shows the section head with an icon tile. A name the sprite doesn't have renders blank. |
| `visibleWhen` (pages only) | Rule — **branching**. The page is skipped while it's false. It may only use fields on **earlier** pages, and the first page can't have one (so there's always a page). See *Branching*. |
| `endWhen` (pages only) | Rule. While it's true this page is the last: **Submit** replaces **Next** and every later page is skipped. It may use fields on this page or earlier. |
| `columns` (sections only) | `1` (default) or `2`. Two columns once the **form** is at least 600px wide, one below — keyed to the form's own width, so a narrow web-part column stays single. Headings, notes and `span: "full"` fields take the whole row; a hidden field gives its cell to the next one. |
| `tint` (sections only) | `sky` · `blue` · `neutral`: the section becomes a soft tinted panel, e.g. to set an attestation checkbox apart. |
| `visibleWhen` (sections only) | Rule — a hidden section's fields are neither validated nor submitted. |

## Fields

Common keys:

| Key | Notes |
| --- | --- |
| `id` | **Required, unique.** Referenced by rules and `{field:…}` tokens. |
| `type` | One of the table below. |
| `label`, `hint`, `placeholder` | Display text. `hint` supports links. |
| `span` | `"full"` makes the field take the whole row in a `columns: 2` section. |
| `required` | Enforced only while the field is visible. For `boolean`, required means "must be switched on". |
| `column` | SharePoint **internal** column name. Omit for display-only fields. Several fields may share one column — see *Conditional variants*. |
| `default` | Initial value (type-appropriate). On a `person` field, `"@me"` fills in the signed-in user (still editable — "on behalf of"); it fills only a field that's still empty, so a person the user already picked is kept. |
| `choicesWhen` | `choice` / `multichoice` only: which choices show depends on an earlier field — see *Limiting choices*. |
| `query` | Fill the field from a page-URL parameter, e.g. `"Team"` for `?Team=…`. The name matches in any case and the value arrives decoded. Works on `text` `textarea` `email` `phone` `hidden` `choice`. It beats `default`, and "Submit another" resets back to it. |
| `normalize` | Cleans a `query` value: `{ "keep": "alnum", "case": "lower", "maxLength": 40 }`. `keep: "alnum"` drops everything but a–z/0–9 (spaces too); `case` is `lower` or `upper`; `maxLength` cuts it. |
| `readOnly` | `text` only: shown as plain, non-editable text (the decoded value, never parsed as HTML) and still submitted. The row is hidden while empty. |
| `visibleWhen` | Rule object — see *Rules*. |
| `lockWhen` | Rule object. While it's true the field is held at `lockValue` (default `true`) and its control is disabled; when it turns false the field unlocks and **keeps** its value. Today only the `boolean` switch renders the disabled state. |
| `lockValue` | The value a locked field is held at. |
| `lockNote` | Shown under the field while it's locked (supports links). |
| `validation` | Type-specific, below. |

### Field types → SharePoint columns

| `type` | Renders | Column type | `validation` keys / extras |
| --- | --- | --- | --- |
| `hidden` | nothing (not rendered) | Text (or Choice / Note) | A value carried in state and submitted, normally from `query`. Needs `query` or `default`. `required` and `validation` (`url`, `maxLength`, `pattern`) apply; a bad value triggers `queryError`. |
| `text` | single-line input | Single line of text | `minLength`, `maxLength`, `pattern` (+`patternMessage`), `url: true` |
| `textarea` | multi-line (`rows` opt.) | Multiple lines (plain, or rich text with `richText`) | `minLength`, `maxLength`; `richText: true` for a **rich-text** column — the text is HTML-escaped and line breaks become `<br>` (raw newlines collapse in a rich-text column). The doctor flags a mismatch. |
| `email` | input w/ email validation | Single line of text | — |
| `phone` | input w/ phone validation | Single line of text | — |
| `number` | numeric input — or a dropdown or slider with `display` | Number | `min`, `max`, `integer: true`; `display`: `"input"` (default), `"dropdown"` or `"slider"` — see *Number dropdown and slider* |
| `currency` | numeric input (0.01 step) | Currency (or Number) | `min`, `max` |
| `choice` | **pill dropdown** | Choice | `choices` (see below), `fillIn: true` for an "enter your own" row |
| `multichoice` | pill multi-select | Choice, multi | `choices`, `fillIn`, `validation.minChoices` / `maxChoices` |
| `boolean` | toggle switch, or checkbox with `control: "checkbox"` | Yes/No — or Choice/Text with `values` | `toggleText` — label beside the switch (for a checkbox: the box's text; without it the field label becomes the box's text). `values` works with both controls. `values: { "on": "Urgent", "off": "Standard" }` saves those words instead of yes/no, and the switch reads out the current word. SharePoint's REST API accepts a word that isn't one of a Choice column's choices. |
| `date` | date picker | Date and Time | `includeTime: true` for date+time; `rules` (see *Date rules*); `prompt` (see *Business time*) |
| `person` | people picker | Person or Group | `multiple: true` → allow multiple (**UserMulti** column); `validation.maxPeople` |
| `link` | URL input | Hyperlink | `withDescription: true` adds a display-text input |
| `lookup` | pill dropdown from a list | Lookup (single) | `lookup: { listTitle, displayField: "Title", siteUrl?, top? }`, `color` |
| `heading` | section-style heading | — | `text`, `description` |
| `note` | message bar / paragraph | — | `text`, `style`: `info` `warning` `success` `danger` `plain` |
| `currentUser` | identity card: photo (initials fallback), name, email | — | `label`. Display only. |
| `assignments` | a table of the user's rows, a color-dot dropdown per row | Text or Choice (`column`, per row) | See *Assignments*. One per form. |

**Clear buttons.** An optional single choice, lookup, date, number (any
display) and link field shows a **×** while it has a value; choice-style
menus also start with **Clear selection**. Required fields don't get one. A
checkbox or switch is cleared by turning it off; multi-choice and people
fields remove one pill at a time.

### Number dropdown and slider

`"display": "dropdown"` lists every whole number from `validation.min` to
`validation.max` (at most 200 of them) in the pill dropdown;
`"display": "slider"` gives a slider between them with the two ends labelled
and the value in a pill. Both need whole-number `min` and `max`, step 1, and
save a Number. A slider starts **Not set** (dimmed) until it's moved or
clicked — so an optional slider can stay empty, and a required one shows
the required message until it's touched. Not for `currency`.

### Limiting choices (`choicesWhen`)

```json
"choicesWhen": {
  "field": "category",
  "map": { "Hardware": ["Laptop", "Monitor"], "Software": ["Licence"] },
  "else": []
}
```

`field` is an **earlier** `choice` or `boolean` field (for a boolean, the map
keys are `"true"` and `"false"`). The choices shown are the map entry for
its current value, else `else`, else none. **With no choices to show, the
field is hidden** (not validated, not saved) — that's also what happens
while the driver is unanswered. When the driver changes, picks it no longer
allows are removed, and so is an "enter your own" value. Every listed value
must be one of the field's own `choices`.

`choices` entries are strings or `{ "value": "…", "label": "…", "color": "…" }`.
`value` is what's saved; `label` (optional, may be bilingual) is what's shown.
Colors: `blue green yellow red gray sky teal berry lavender orange`,
auto-assigned in a cycle when omitted, so configs can stay plain arrays.

### Assignments

For "confirm something about each item assigned to you". The rows come from a
**source list**, filtered to the signed-in user. Each row gets one dropdown.
Submit saves **one item per row** to the target list.

```json
{
  "id": "zones", "type": "assignments", "required": true,
  "rowLabel": "Floor/Area", "choiceLabel": "Physical Security Zone", "placeholder": "Select a zone",
  "source": { "listTitle": "PS_Zone-Attestation-Assignments", "userColumn": "UserEmail",
              "labelColumn": "AreaName", "orderBy": "AreaName" },
  "responses": { "userColumn": "UserEmail", "keyColumn": "LookupID" },
  "column": "ZoneSelection",
  "rowColumns": { "LookupID": "ID", "UserDescription": "UserDescription", "AreaName": "AreaName" },
  "choices": [ { "value": "Green", "label": { "en": "Green", "fr": "Vert" }, "color": "green" } ],
  "empty":   { "title": "…", "message": "…" },
  "allDone": { "title": "…", "message": "…" }
}
```

| Key | Notes |
| --- | --- |
| `source` | The list (`listTitle` / `listUrl`, optional `siteUrl`). `userColumn` (required) holds an email. A row belongs to the user when it equals their profile email **or** UPN, ignoring case. `labelColumn` (required) names the row; `detailColumn` (optional) adds a second line; `orderBy` (default: the label) and `top` (default 500). If more rows match than `top`, the first `top` show with a warning ("submit these, then reload"); nothing is dropped silently. **Limit:** if every row in that first `top` is already answered, the form can't reach the rest — it says so instead of "already submitted". Raise `top` if one person can have that many. |
| `column` | The **target** column each row's choice is saved to. Required. |
| `rowColumns` | Target column → source column, copied into each row's item. `"ID"` is the source item's id (saved as a number). |
| `responses` | Optional. The rows this user already saved are found in the target list (`userColumn` = their email) and not shown again. They're matched on `keyColumn`, which must be a `rowColumns` target (normally the copied ID). A note says how many were skipped. If every row is done, the `allDone` screen shows instead of the form. One read covers up to 5,000 earlier responses per user; past that a warning says answered rows may show again, and "already submitted" is never claimed on a cut-off read. |
| `required` | Every row needs a choice; each empty row shows its own error. |
| `empty` / `allDone` | The screens for "nothing assigned" and "all already submitted". Engine defaults exist. |
| `rowLabel` / `choiceLabel` | The table's two column headers. |

- Every dropdown can be cleared: the **×** in the control, or **Clear
  selection** at the top of its menu.
- Once the user confirms, the answers are frozen: every input is disabled
  while saving, and the items are built from a copy of the answers taken at
  that moment.
- The rows save one at a time, in order. If one fails, the rows known to be
  saved lock with a check mark and the message says how many. Submitting
  again sends only the rest. A save can also land in SharePoint while the
  browser never hears back (a dropped connection). So, with `responses` set,
  a retry first re-reads the user's responses and skips any row already
  there. That check asks about exactly the unsaved rows, so the 5,000 cap
  doesn't apply. Without `responses`, a retry can only trust what the
  browser saw, and that case can save a row twice. So can the same person
  submitting from two tabs at the same moment; only a uniqueness rule on the
  list would stop that, and it would also block re-running the attestation.
- File attachments are frozen too: nothing can be added, dropped or removed
  while a submit runs.
- Can't be combined with `attachments`, or with `visibleWhen` on the field.
- Other fields (e.g. a confirm checkbox) and `target.set` are written into
  **every** row's item. `titleTemplate` can use `{row:<column>}`.
- **Permissions.** Users need read access to their rows in the source list,
  and add access to the target list. With `responses`, they also need read
  access to their own target items. "Read items that were created by the user"
  covers that. **The filter is not security.** Anyone who can read the source
  list can read every row in it over REST. If people mustn't see other
  people's assignments, give each source item its own permissions (see the
  form's README notes).
- **Lists over 5,000 items:** index `userColumn` in both lists, or the
  filtered reads fail at the list view threshold.

### Conditional variants (shared columns)

Multiple fields may declare the same `column` and be shown/hidden by different
criteria (e.g. a different option list per category) — but the column must be
**declared** in a top-level `sharedColumns` array:

```json
"sharedColumns": ["SubCategory"]
```

A column mapped by more than one field that is *not* declared is a config
error (this catches accidental duplicates); a declared entry no field maps to
is also an error (catches typos). The form creator is responsible for showing
at most one variant at a time; if several are visible, the **field that
appears later in the JSON wins** at submit time (and the engine logs a
console warning). The doctor report tags these rows `· shared`.

## Links in text

`form.intro`, page and section `description`, field `hint`, `note` text,
`heading` description and `confirmation.message` accept Markdown-style links:

```json
"intro": "For other services, use the [GSI intake](/sites/FCUPortal/Go#gsi-intake)."
```

Everything else stays plain, escaped text. Only `https://`, `http://`,
`mailto:`, server-relative (`/…`) and `#anchor` targets become links; anything
else is left as literal text. Links leave the page in a new tab, so a
half-filled form isn't lost.

## Rules (`visibleWhen`)

A rule is a comparison, or a combinator over rules:

```json
{ "field": "hasBudget",  "op": "equals",   "value": true }
{ "field": "category",   "op": "in",       "value": ["Hardware", "Software"] }
{ "field": "systems",    "op": "includes", "value": "FCU Portal" }
{ "all": [ …rules… ] }   { "any": [ …rules… ] }   { "not": { …rule… } }
```

Ops: `equals` · `notEquals` · `in` · `notIn` · `includes` · `includesAny` ·
`includesAll` (multichoice) · `isEmpty` · `notEmpty` · `withinBusinessDays`
(see *Business time*) — plus the date ops below, usable in `visibleWhen` too
(that's how a "rush warning" note keys off a date).
Show/hide is intended to be driven by **yes/no, choice, multichoice, and date**
fields.

## Branching (pages)

A page with `visibleWhen` is skipped while its rule is false; a page whose
`endWhen` is true ends the form there. The stepper shows only the pages that
apply and numbers them 1, 2, 3…; **Next** and **Back** jump over skipped
pages.

- **Answers on a skipped page count as empty**, for every rule, choice
  filter and `{field:…}` token, and they're not saved. An answer left behind
  on a branch the user backed out of can't drive anything.
- If an earlier answer changes so the page the user is on no longer applies,
  the form steps back to the nearest page that does.
- Attachments must be on a page every path reaches: not a page with
  `visibleWhen`, and not after a page with `endWhen`.
- Hidden **sections** are different: their fields keep their values for
  rules (as before); only pages read as empty.

## Date rules (`rules` on a `date` field)

Each rule compares the field's value against another date field or `@today`
(the submission date), plus an optional calendar-day offset:

```json
"rules": [
  { "op": "onOrAfter", "compareTo": "@today",             "mode": "block",
    "message": "Can't be in the past." },
  { "op": "onOrAfter", "compareTo": "@today", "days": 2,  "mode": "warn",
    "message": "Less than 2 days' notice — same-week fulfilment isn't guaranteed." },
  { "op": "after",     "compareTo": "startDate",          "mode": "block",
    "message": "Must be after the start date." }
]
```

| Key | Values |
| --- | --- |
| `op` | `after` · `onOrAfter` · `before` · `onOrBefore` (calendar-day comparison) |
| `compareTo` | another date field's `id`, or `"@today"` |
| `days` | offset added to `compareTo` before comparing (may be negative) |
| `mode` | `block` (validation error) or `warn` (amber note under the field) |
| `message` | shown to the user; defaults exist in `strings` |

**Business-day rules** (need `form.businessHours`; only its `timeZone` and
`days` matter here):

```json
{ "op": "minBusinessDays", "days": 2, "mode": "block" },
{ "op": "businessDay", "mode": "block" }
```

- `minBusinessDays` — the date must be at least `days` **whole** business
  days after today: Friday → Monday is 1. Today never counts, and "today"
  is the business time zone's date. A blocking one also sets the date
  picker's earliest date.
- `businessDay` — the date must fall on a business day (not a weekend).
  `minBusinessDays` alone lets a far-off Saturday through, so pair them.
- A date+time value counts on the business zone's calendar (a late-evening
  pick in Vancouver can be the next day in Toronto). Holidays aren't
  modeled.

Rules are skipped while either date is empty — pair with `required` or a
`notEmpty` visibility guard as needed.

## Business time

For "how much working time is left" rules. Declare the calendar once:

```json
"form": { "businessHours": {
  "timeZone": "America/Toronto", "days": [1, 2, 3, 4, 5],
  "start": "09:00", "end": "17:00", "dateAt": "end"
} }
```

| Key | Default | Notes |
| --- | --- | --- |
| `timeZone` | — (required) | IANA zone. All counting happens on **this** zone's wall clock, so the viewer's own zone and daylight-saving changes don't matter. |
| `days` | `[1,2,3,4,5]` | Business weekdays, 0 = Sunday. **Holidays aren't modeled.** |
| `start`, `end` | `"09:00"`, `"17:00"` | Business hours. One **business day** = `end − start` working hours (8). |
| `dateAt` | `"end"` | Which moment a date-only value stands for: `"end"` (close of business that day) or `"start"` (opening). `includeTime` dates use their own time, which the picker shows in the **viewer's** zone; it is converted to the business zone before counting (a 2pm pick in Vancouver is 5pm Eastern). |

Working time between now and a target counts only business hours; any moment
outside them counts as the last close (6pm Tuesday = 5pm Tuesday). The
boundary is **inclusive**: a target exactly N business days away is "within N".
Dates before today are never "within" (they're invalid input, and a
half-typed year must not trip anything).

**Rule op** — `{ "field": "launchDate", "op": "withinBusinessDays", "value": 1 }`
is true while the date is at most 1 business day away. Use it in
`visibleWhen` or `lockWhen`.

**Date `prompt`** — a dialog when the user picks a date inside the window:

```json
"prompt": {
  "withinBusinessDays": 1,
  "title": "Next business day request",
  "message": "For next business day requests, your intake will be marked urgent…",
  "confirm":     { "label": "OK", "set": { "priority": true } },
  "alternative": { "label": "Change to 48 hours", "moveToBusinessDays": 2 }
}
```

- **confirm** keeps the date and applies `set` (field `id` → value). **Escape**
  does the same.
- **alternative** (optional) moves the date to the earliest one at least
  `moveToBusinessDays` away.
- It asks once per chosen value. If the user submits (or presses Next) with
  an unanswered prompt, for example because the form sat open overnight, the
  dialog opens instead and they submit again.
- Pair it with a `lockWhen` on the field that `set` changes, so the user can't
  undo the answer while the date is still in the window.

Tests can pin "now" with `BSPForms.clock = function () { return <ms>; }`
(set before the engine loads, or any time after).

## For the form builder (public API)

The engine exposes what the builder needs; nothing here writes to SharePoint.

| Call | Returns |
| --- | --- |
| `BSPForms.normalize(config)` | `{ errors: [...] }` — exactly what a page would reject. |
| `BSPForms.lists()` | A read-only object: `ready()`, `userInfo()`, `getWebLists(webUrl?)` (custom lists: `id`, `title`, `url`, `enableAttachments`, `itemCount`) and `getListSchema({ siteUrl?, listId or listUrl })` (`list` + `fields` with SharePoint's own property names: `InternalName`, `EntityPropertyName`, `TypeAsString`, `Required`, `Choices`, `MaxLength`, `DisplayFormat`, `MinimumValue`/`MaximumValue` — null when unbounded — and so on). |
| `BSPForms.compat` | The doctor's field-type → column-type table. |
| `BSPForms.assetVersion` | The engine script's `?v=`. |

## Hidden-field semantics

A field hidden by `visibleWhen` (or inside a hidden section, on a skipped
page, or with no choices left by `choicesWhen`) is **not
validated and not submitted**; its value is kept in memory, so re-showing it
restores what the user had entered.

## After submit (`afterSubmit`)

Replaces the plain confirmation with a result screen, after an optional
lookup in another list:

```json
"afterSubmit": {
  "continueOnSaveError": true,
  "lookup": { "siteUrl": "/sites/FCUPortal", "listUrl": "Lists/Classic-URL-Redirects",
              "matchField": "resourceName", "matchColumn": "ResourceName", "returnColumn": "URL" },
  "found":    { "title": "…", "message": "…", "link": { "text": "{field:resourceName}" } },
  "notFound": { "title": "…", "message": "…", "copy": "{field:link}",
                "redirect": { "url": "{var:converterUrl}", "seconds": "{var:redirectSeconds}" } }
}
```

| Key | Notes |
| --- | --- |
| `continueOnSaveError` | `true`: a failed save is logged to the console and the result screen still shows. Default: the usual error message. |
| `lookup` | First row in `siteUrl` + `listUrl` (or `listTitle`) where `matchColumn` equals the value of field `matchField`. The comparison is case-insensitive, as SharePoint compares text, and quotes are escaped. `returnColumn` may be a Hyperlink column (its URL is used) or text. Only an `http(s)` or server-relative value counts as a result. An empty match value, no row, or a failed lookup means **not found**. The viewer needs read access to that list. |
| `found` | Shown when the lookup returns a URL. `link.text` is the link's text, defaulting to the URL; `{lookup}` is the URL as a token. |
| `notFound` | Shown otherwise, or always when there's no `lookup`. |

A screen (`found`, `notFound`, `queryError`) takes:

- `title` and `message` (both take tokens; `message` supports links).
- `copy`: text to put on the clipboard. If the browser blocks it, a Copy box
  appears and the countdown pauses until they copy.
- `redirect`: `{ url, seconds }`, a countdown and then navigation, with a
  "Go now" link. Only `http(s)` or server-relative URLs are followed.
  `seconds` is 0–60, default 5. Keep the URL in `form.vars`, never in the
  page URL, so the page can't be turned into an open redirect.

## Bad URL values (`queryError`)

If any field with a `query` fails validation when the page loads (e.g. a
required `hidden` field is missing, isn't a URL, or is too long), the form is
skipped and this screen shows instead. It's the same shape as the
`afterSubmit` screens:
`"queryError": { "title": "…", "message": "…", "redirect": { … } }`.

## Submit behavior

1. All pages validate; on failure the user is taken to the first page with an
   error. With `submitConfirm`, the dialog then asks; nothing below happens
   until the user confirms.
2. Person fields resolve directory entries to user ids (`ensureUser`).
   *(An assignments form instead saves one item per row, in order, and skips
   rows already saved; see* Assignments*.)*
3. The item is created (`items.add`) with the coerced values — later fields
   win on duplicate columns; `titleTemplate` fills `Title` if unmapped.
4. Attachments upload one at a time. If any fail, the item is **kept** and the
   user can retry just the failed files or continue without them — the
   response is never duplicated.
5. The confirmation screen renders; "Submit another response" resets to a
   fresh form. With `afterSubmit`, its lookup and result screen run instead.
