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
| `intro` | — | Boilerplate paragraph under the title. Supports links — see *Links in text*. |
| `showTitle` | `true` | Set `false` to suppress the heading (e.g. the page already has one). |
| `appearance` | see below | How the form sits on the page. |
| `vars` | — | A bucket of named values for this form — `{ "converterUrl": "https://…", "redirectSeconds": 5 }` — used anywhere tokens work as `{var:name}`. For settings that change rarely; nothing in the page URL can override them. |
| `businessHours` | — | The business calendar for `withinBusinessDays` rules and date `prompt`s — see *Business time*. Required if either is used. |

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
| `titleTemplate` | — | Fills the list's `Title` column when no field maps to `Title`. Tokens: `{form:title}` `{user:name}` `{user:email}` `{date}` `{time}` `{field:<id>}` `{var:<name>}` (and `{lookup}` on `afterSubmit` screens). |

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
| `page` | last page | 0-based page index to render the dropzone on (in its own section at the end of the page). |
| `section` | — | A section `id`: render the dropzone at the end of that section instead (full width in a two-column section). The section must not have `visibleWhen`. Wins over `page`. |

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
| `title`, `description` | Optional headings. `description` supports links. |
| `icon` (sections only) | A Fluent sprite name (`person`, `edit`, `document`, `calendar-ltr`, … — the `fluent-basic-icons.svg` set, without the `ic-fluent-`/`-24-regular` wrapper). Shows the section head with an icon tile. A name the sprite doesn't have renders blank. |
| `columns` (sections only) | `1` (default) or `2`. Two columns once the **form** is at least 600px wide, one below — keyed to the form's own width, so a narrow web-part column stays single. Headings, notes and `span: "full"` fields take the whole row; a hidden field gives its cell to the next one. |
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
| `default` | Initial value (type-appropriate). |
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
| `number` | numeric input | Number | `min`, `max`, `integer: true` |
| `currency` | numeric input (0.01 step) | Currency (or Number) | `min`, `max` |
| `choice` | **pill dropdown** | Choice | `choices` (see below), `fillIn: true` for an "enter your own" row |
| `multichoice` | pill multi-select | Choice, multi | `choices`, `fillIn`, `validation.minChoices` / `maxChoices` |
| `boolean` | toggle switch | Yes/No — or Choice/Text with `values` | `toggleText` — label beside the switch. `values: { "on": "Urgent", "off": "Standard" }` saves those words instead of yes/no, and the switch reads out the current word. SharePoint's REST API accepts a word that isn't one of a Choice column's choices. |
| `date` | date picker | Date and Time | `includeTime: true` for date+time; `rules` (see *Date rules*); `prompt` (see *Business time*) |
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
| `dateAt` | `"end"` | Which moment a date-only value stands for: `"end"` (close of business that day) or `"start"` (opening). `includeTime` dates use their own time. |

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

## Hidden-field semantics

A field hidden by `visibleWhen` (or inside a hidden section) is **not
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
   error.
2. Person fields resolve directory entries to user ids (`ensureUser`).
3. The item is created (`items.add`) with the coerced values — later fields
   win on duplicate columns; `titleTemplate` fills `Title` if unmapped.
4. Attachments upload one at a time. If any fail, the item is **kept** and the
   user can retry just the failed files or continue without them — the
   response is never duplicated.
5. The confirmation screen renders; "Submit another response" resets to a
   fresh form. With `afterSubmit`, its lookup and result screen run instead.
