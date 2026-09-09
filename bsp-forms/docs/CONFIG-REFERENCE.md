# BSP Forms — config reference

A form is one JSON document. `forms/example-it-request.json` shows everything
below in use.

```
{
  "form":         { … title / intro boilerplate … },
  "target":       { … which list, which site, Title template … },
  "confirmation": { … post-submit screen … },
  "attachments":  { … file rules … },
  "strings":      { … any UX/error string override … },
  "pages":        [ { sections: [ { fields: [ … ] } ] } ]
}
```

## `form`

| Key | Default | Notes |
| --- | --- | --- |
| `title` | — | Shown as the form heading and available as `{form:title}`. |
| `intro` | — | Boilerplate paragraph under the title. |
| `showTitle` | `true` | Set `false` to suppress the heading (e.g. the page already has one). |
| `appearance` | see below | How the form sits on the page. |

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
| `listId` | — | List GUID; wins over `listTitle`. |
| `siteUrl` | current site | Absolute or server-relative URL of the target web, e.g. `/sites/FCUPortal`. |
| `titleTemplate` | — | Fills the list's `Title` column when no field maps to `Title`. Tokens: `{form:title}` `{user:name}` `{user:email}` `{date}` `{time}` `{field:<id>}`. |

## `confirmation`

| Key | Default | Notes |
| --- | --- | --- |
| `title` | strings.confirmTitle | Heading of the post-submit screen. |
| `message` | strings.confirmMessage | Body text. |
| `allowAnother` | `true` | Show a "Submit another response" button (resets the form). |
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
| `page` | last page | 0-based page index to render the dropzone on. |

## `strings`

Any key here overrides the engine default of the same name — button labels,
validation messages, people-picker text, attachment errors, confirmation
defaults, the edit-mode note, everything. The full catalog is the
`DEFAULT_STRINGS` object at the top of `bsp-forms.js`. Messages support the
placeholders shown there (`{min}`, `{max}`, `{name}`, `{other}`, …).

## `pages`

`pages[]` → `sections[]` → `fields[]`. Pages render with a stepper (when there
is more than one) and validate on **Next**; sections group fields under an
optional title/description and can carry their own `visibleWhen`.

| Key (page / section) | Notes |
| --- | --- |
| `id` | Optional but recommended; auto-generated if missing. |
| `title`, `description` | Optional headings. |
| `visibleWhen` (sections only) | Rule — a hidden section's fields are neither validated nor submitted. |

## Fields

Common keys:

| Key | Notes |
| --- | --- |
| `id` | **Required, unique.** Referenced by rules and `{field:…}` tokens. |
| `type` | One of the table below. |
| `label`, `hint`, `placeholder` | Display text. |
| `required` | Enforced only while the field is visible. For `boolean`, required means "must be switched on". |
| `column` | SharePoint **internal** column name. Omit for display-only fields. Several fields may share one column — see *Conditional variants*. |
| `default` | Initial value (type-appropriate). |
| `visibleWhen` | Rule object — see *Rules*. |
| `validation` | Type-specific, below. |

### Field types → SharePoint columns

| `type` | Renders | Column type | `validation` keys / extras |
| --- | --- | --- | --- |
| `text` | single-line input | Single line of text | `minLength`, `maxLength`, `pattern` (+`patternMessage`), `url: true` |
| `textarea` | multi-line (`rows` opt.) | Multiple lines (plain) | `minLength`, `maxLength` |
| `email` | input w/ email validation | Single line of text | — |
| `phone` | input w/ phone validation | Single line of text | — |
| `number` | numeric input | Number | `min`, `max`, `integer: true` |
| `currency` | numeric input (0.01 step) | Currency (or Number) | `min`, `max` |
| `choice` | **pill dropdown** | Choice | `choices` (see below), `fillIn: true` for an "enter your own" row |
| `multichoice` | pill multi-select | Choice, multi | `choices`, `fillIn`, `validation.minChoices` / `maxChoices` |
| `boolean` | toggle switch | Yes/No | `toggleText` — label beside the switch |
| `date` | date picker | Date and Time | `includeTime: true` for date+time; `rules` (see *Date rules*) |
| `person` | people picker | Person or Group | `multiple: true` → allow multiple (**UserMulti** column); `validation.maxPeople` |
| `link` | URL input | Hyperlink | `withDescription: true` adds a display-text input |
| `lookup` | pill dropdown from a list | Lookup (single) | `lookup: { listTitle, displayField: "Title", siteUrl?, top? }`, `color` |
| `heading` | section-style heading | — | `text`, `description` |
| `note` | message bar / paragraph | — | `text`, `style`: `info` `warning` `success` `danger` `plain` |

`choices` entries are strings or `{ "value": "…", "color": "…" }`. Colors:
`blue green yellow red gray sky teal berry lavender orange` — auto-assigned in
a cycle when omitted, so configs can stay plain arrays.

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

## Rules (`visibleWhen`)

A rule is a comparison, or a combinator over rules:

```json
{ "field": "hasBudget",  "op": "equals",   "value": true }
{ "field": "category",   "op": "in",       "value": ["Hardware", "Software"] }
{ "field": "systems",    "op": "includes", "value": "FCU Portal" }
{ "all": [ …rules… ] }   { "any": [ …rules… ] }   { "not": { …rule… } }
```

Ops: `equals` · `notEquals` · `in` · `notIn` · `includes` · `includesAny` ·
`includesAll` (multichoice) · `isEmpty` · `notEmpty` — plus the date ops below,
usable in `visibleWhen` too (that's how a "rush warning" note keys off a date).
Show/hide is intended to be driven by **yes/no, choice, multichoice, and date**
fields.

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

Rules are skipped while either date is empty — pair with `required` or a
`notEmpty` visibility guard as needed.

## Hidden-field semantics

A field hidden by `visibleWhen` (or inside a hidden section) is **not
validated and not submitted**; its value is kept in memory, so re-showing it
restores what the user had entered.

## Submit behavior

1. All pages validate; on failure the user is taken to the first page with an
   error.
2. Person fields resolve directory entries to user ids (`ensureUser`).
3. The item is created (`items.add`) with the coerced values — later fields
   win on duplicate columns; `titleTemplate` fills `Title` if unmapped.
4. Attachments upload one at a time. If any fail, the item is **kept** and the
   user can retry just the failed files or continue without them — the
   response is never duplicated.
5. The confirmation screen renders; "Submit another response" resets to a
   fresh form.
