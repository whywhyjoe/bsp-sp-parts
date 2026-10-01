# sp-list-to-markdown — config and output

Exports one SharePoint list to one Markdown file, overwriting it each time, for
Copilot to read. Host: `<div data-admin-task="sp-list-to-markdown" data-config="…">`.

## Config

| Key | Required | Default | Notes |
| --- | --- | --- | --- |
| `title` | | the list title | H1 of the file |
| `list.site` | | the page's own web | Server-relative, e.g. `/sites/Intake`; `/` is the tenant root site |
| `list.title` | ✓ | | List display title |
| `fields` | ✓ | | Internal names of the columns to write, in order |
| `heading` | | `Title` | Column used as each item's heading |
| `group` | | none | Column for `##` sections |
| `subgroup` | | none | Column for `###` sections inside each group |
| `filter` | | none | OData `$filter`, passed as-is, e.g. `Status ne 'Closed'` |
| `orderBy` | | `ID` descending | `"Col"`, `{ "field": "Col", "ascending": false }`, or a list of those |
| `maxItems` | | `50` | 1–5000; one request. Hitting the limit is stated in the file |
| `timeZone` | | the exporter's browser zone | IANA name for date+time values, e.g. `America/New_York` |
| `output.site` | | `list.site` | Site that owns the output library |
| `output.folder` | ✓ | | Server-relative folder, e.g. `/sites/Intake/Shared Documents/copilot` |
| `output.file` | ✓ | | File name, e.g. `intake.md` |
| `schedule.slots` | | `[8,10,12,14,16,18]` | Local hours (runner setting) |
| `schedule.until` | | last slot + 2 | Hour the day closes, 1–24; nothing starts at or after it (runner setting) |
| `label` | | `Export list to Markdown` | Name shown in the panel (runner setting) |

The runner keys this browser's memory of an instance by the host's `data-id`
attribute, else its `data-config` URL — set `data-id` only when the config URL
is not stable.

Filter and order columns should be **indexed** once a list passes 5,000 items,
or SharePoint refuses the query. Changing only the config does not trigger an
export (the list did not change) — visit with `?adminTasks=force`.

## Output

```markdown
# Intake requests

- Source list: Intake (https://…/Lists/Intake)
- Exported: 2026-09-28 10:05 (America/New_York)
- Items: 42
- Filter: Status ne 'Closed'
- Order: Due Date ascending

---

## Assigned To: Avery Chen

### Status: New

#### New vendor intake form

- Assigned To: Avery Chen (avery@example.org)
- Status: New
- Due Date: 2026-10-01 12:30
- Description: Build the vendor form.
  - Fields from the spec
- Item link: https://…/Lists/Intake/DispForm.aspx?ID=3
```

Why it looks like this — every choice is for Copilot, which reads the file in
chunks:

- **Group values repeat on every item** as bullets, so a chunk that lost its
  `##` heading still knows whose item it is.
- **ISO dates** (`YYYY-MM-DD`, 24-hour times). Date-only columns show the date
  only, and keep their calendar day for any site zone within ±11 h of UTC (all
  of the Americas and Europe; a UTC+12/+13 site would see the previous day).
- **An item link** on every item, so answers can cite the list item.
- **Empty values are left out**; blank group values land in a `(none)` group,
  sorted last. Headings are single lines; multi-line text stays inside its
  bullet (continuation lines indented; blank lines removed from both plain and
  rich text, because a blank line would end the bullet).
- **No Markdown escaping** of values: `Fix #123 [urgent]` stays readable in the
  raw file, which is read as often as the rendered one.

## Value rendering

Person → `Name (email)` (`Name` in headings) · multi-person/lookup/choice →
`a; b` · lookup → its shown field · URL → `[description](url)` · Yes/No ·
rich text → plain text with line breaks and `- ` list items · managed metadata →
the label when REST provides one · anything unrecognised that is an object is
omitted rather than printed as `[object Object]`.
