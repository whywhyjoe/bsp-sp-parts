# sp-list-ordering

Drag-to-reorder editor for SharePoint list items. SharePoint's native
drag-reorder ("Custom order") is UI-only — the order can't be read by REST,
Graph, or Power Automate, and dies when any sort is applied — so apps that
consume list items in a defined order need an explicit numeric field (by
convention `SortOrder`). This tool is the missing editor for that field.

## How it works

- A top dropdown picks the list (from config). An optional per-list **filter
  field** (e.g. Category) scopes the grid; reordering applies **only to the
  visible scope**.
- Drag rows by the handle, or use the per-row **move up / move down** buttons
  (the keyboard-accessible path). Nothing is written until **Save order**.
- **Save renumbers the visible scope to gapped integers (10, 20, 30…)** and
  writes only the items whose value changed, in batched requests. Gaps leave
  room for occasional manual edits between sessions. **Reset** restores the
  loaded order.
- Items with a **missing or duplicated** sort value float to the top with a
  *Needs placement* badge; the next Save normalizes them. This is also what
  self-heals collisions when an item's category changes: it shows up badged in
  its new category's scope and gets clean numbers on the next save there.

**Convention for consuming apps:** sort by `SortOrder asc, ID asc`. The ID
tie-break makes duplicate values (possible across filter scopes, or after a
category change) render in a stable order instead of flickering.

## Deploying to a site

The shared assets deploy **once per site**; the stub + config are
**per-instance** (each embedding page has its own copy of the stub pointing at
its own config):

1. Upload `sp-list-ordering.js`, `sp-list-ordering.css` to the site (e.g.
   `SiteAssets/sp-parts/sp-list-ordering/`).
2. Write a config JSON for your lists (schema below) and upload it wherever the
   embedding app keeps its assets.
3. Copy `sp-list-ordering.webpart.html`, point its `data-config` at your JSON,
   fix the `DEPLOY REPOINT` URLs for your site, upload it.
4. Point a custom script web part at your copy of the stub.

Prereqs on the page/site: the design system
(`/sites/FCUPortal/Code/bsp-design/styles.css`), self-hosted Alpine and PnPjs v2
(`/sites/FCUPortal/Code/lib/alpine.js`, `…/pnp2.bundle.js`). The stub loads all
of these; duplicate tags are harmless if the page already has them.

Two stubs on one page work: the loader mounts every
`[data-sp-part="list-ordering"]` div independently, each with its own config.

## Config schema

```json
{
  "webUrl": "/sites/FCUPortal",
  "lists": [
    {
      "title": "FAQ Entries",
      "label": "FAQ entries",
      "sortField": "SortOrder",
      "filterField": { "internalName": "Category", "label": "Category", "type": "Choice" },
      "displayFields": [
        { "internalName": "Category", "label": "Category", "type": "Choice" },
        { "internalName": "Owner", "label": "Owner", "type": "Text" },
        { "internalName": "Modified", "label": "Modified", "type": "DateTime" }
      ]
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `webUrl` | Fallback web URL for PnPjs; `_spPageContextInfo` wins when present. |
| `lists[].title` | The SharePoint list **title** (used with `getByTitle`). |
| `lists[].label` | Dropdown text (defaults to `title`). |
| `lists[].sortField` | Internal name of the **Number** column that holds the order. |
| `lists[].filterField` | Optional; one per list. `type: "Choice"` reads the column's choices; anything else offers the distinct values found in the data. |
| `lists[].displayFields` | Up to 4 extra grid columns. `type` is a formatting hint only: `Number` right-aligns, `DateTime` renders a locale date. |

Title and Sort order columns always show. Keep display/filter fields to simple
types (Text, Choice, Number, DateTime) — Lookup/Person columns need `$expand`
and aren't supported in v1.

The tool loads at most 500 items per list and warns if that truncates; reorder
inside a filter scope for bigger lists.

## The SortOrder column

A plain **Number** column (integers in practice; the column type allows decimals
if a future strategy wants midpoint inserts). New items can default to `0` or
blank — either way they surface as *Needs placement* here.

## Dev / mock mode

When `pnp` is absent (or the page is opened from `file:`), a mock adapter with
built-in demo lists takes over automatically — including one missing and one
duplicated sort value so the *Needs placement* path is visible. Open
`../dev/sp-list-ordering.dev.html` straight from disk; it also simulates the web
part zone rendering late, which exercises the timer-based boot.
