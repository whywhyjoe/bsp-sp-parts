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

1. Upload `_shared/dcs-part-boot.js` (e.g. `SiteAssets/sp-parts/_shared/`) and
   `sp-list-ordering.js`, `sp-list-ordering.css` (e.g.
   `SiteAssets/sp-parts/sp-list-ordering/`). The boot helper is shared by every tool in
   this repo — upload it once per site.
2. Write a config JSON for your lists (schema below) and upload it wherever the
   embedding app keeps its assets.
3. Copy `sp-list-ordering.webpart.html`, point its `data-config` at your JSON,
   fix the `DEPLOY REPOINT` URLs for your site, upload it.
4. Point a custom script web part at your copy of the stub.

The tool is a **drop-in**: it fills the web part's container, brings no page
chrome, and scrolls its grid horizontally when the container is narrow. The
stub owns the per-instance presentation:

- The **heading block** (title + description) is plain markup in the stub —
  edit the copy or delete the block entirely.
- The **section ground**: the cards read best on `--surface-subtle`, and the
  page section containing the web part has to supply it. The stub ships a
  `:has()` override (`#CanvasZoneContainer:has([data-sp-part="list-ordering"])`)
  plus a plain fallback that paints the web part's own box — adjust the
  selector to your page's canvas structure, or delete if the section already
  has the right background.
- Web part margins/padding collapse is the embedding page's job (the usual
  custom-script-web-part CSS), not the tool's.

Prereqs on the page/site: the design system
(`/sites/FCUPortal/Code/bsp-design/styles.css`), self-hosted Alpine and PnPjs v2
(`/sites/FCUPortal/Code/lib/alpine.js`, `…/pnp2.bundle.js` → global **`pnp2`**). The stub
loads all of these; duplicate tags are harmless if the page already has them.

**Behavior on a real page.** The tool survives SharePoint SPA navigation (it re-mounts via
`dcsOnSpaNavigation`), shows a paused placeholder instead of the live grid while the page is
in edit mode, and — if `pnp2` never loads — shows a visible error rather than quietly
falling back to demo data. Mock data appears only when opened from disk or when the host div
carries `data-mock`.

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

Mock data is **opt-in, never a silent fallback**: it engages only when the page is
opened from `file:` or when the host div carries `data-mock`. On a real page a missing
`pnp2` produces a visible error instead — demo rows must never stand in for a user's
actual list. The demo lists include one missing and one duplicated sort value so the
*Needs placement* path is visible.

Open `../dev/sp-list-ordering.dev.html` straight from disk. The harness simulates the
web part zone rendering late (exercising the boot waiter) and adds two buttons:
**Simulate SPA navigation** (tears the zone down and re-renders it, proving re-mount)
and **Toggle edit mode** (proving the placeholder path). It deliberately does *not*
load `fcu-standard.js`, so it also exercises the stand-in helpers in
`_shared/dcs-part-boot.js`.
