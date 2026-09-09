# bsp-sp-parts

Deployable **parts** for SharePoint sites — anything added to a page. Buildless
and CDN-free at runtime, like everything in the BSP family: what's authored
here is what runs. Parts come in three kinds:

- **Web part tools** — visible UI, built on the
  [BSP design system](https://github.com/whywhyjoe/bsp-design-system) (which
  runs live on the portal at `/sites/FCUPortal/Code/bsp-design/`), following
  the four-artifact pattern below.
- **Page libraries** — invisible runtime behavior a page opts into via a
  script include (language swapping, redirects, form engines). Dependency-free
  or self-hosted-deps only; the four-artifact pattern and the boot contract do
  **not** apply — each library's own README is its contract.
- **Tenant services** — shared backend capabilities other parts **call**;
  pages never include them directly. A thin JS wrapper plus tenant-side
  machinery (lists, Power Automate flows) deployed per tenant; each service's
  README is its contract.

Which rules bind which part is explicit, not inferred:

| Part | Kind | Boot contract (`_shared/dcs-part-boot.js`) |
| --- | --- | --- |
| `sp-list-ordering` | Web part tool | **Required** |
| `bilingual` | Page library | No |
| `bsp-forms` | Page library | No — could optionally adopt it for its mount (host wait / edit mode / SPA re-mount would genuinely help); if that ever happens, its README says so |
| `classic-referrer-redirects` | Page library | No |
| `bsp-notify` | Tenant service | No |

New parts add a row here. A part's own README states its kind; this table and
that statement are the authority — never assume a rule applies from folder
adjacency.

Each part deploys independently; a part that versions its deployments carries
its own `VERSION` file in its folder (repo-standard format — see
`C:\dev\repos\README.md`). There is no repo-wide VERSION.

## The web part tool pattern

Every tool is one folder with four artifacts:

| File | Role | Deployed |
| --- | --- | --- |
| `<tool>.webpart.html` | **Per-instance stub** (~8 meaningful lines): CSS links, one target div, script tags. Each embedding page keeps its **own copy**, and the only edit that matters is pointing `data-config` at that page's JSON. | One copy per embedding page |
| `<tool>.js` | The shared, environment-agnostic engine: waits for the target div (timer + DOM check — SharePoint renders zones on its own schedule), injects the UI, runs it with inline Alpine. | Once per site |
| `<tool>.css` | Tool-local styles built on design-system tokens. | Once per site |
| `<tool>.config.json` | **Owned by the embedding page**, referenced by the stub's `data-config`. Sample ships in the tool folder. | One per instance |

Plus one repo-wide shared file: **[`_shared/dcs-part-boot.js`](_shared/)** — the boot
contract every tool delegates to (host wait, multi-instance mounting, edit-mode
placeholder, SPA re-mount). Deployed once per site, loaded before any tool script.

Shared runtime prerequisites, already live on the portal: the design system
bundle (`Code/bsp-design/styles.css`), the self-hosted libs (`Code/lib/alpine.js`,
`Code/lib/pnp2.bundle.js` → global **`pnp2`**), and `fcu-standard.js`, which is
included at the top of every page and supplies `waitForElement`, `waitForPnP2`,
`dcsOnSpaNavigation`, `dcsRegisterAlpineComponent` and `__dcsIsEditMode`. Tools use
those when present and fall back to stand-ins in `_shared/dcs-part-boot.js`, so they
also run outside SharePoint.

## Parts

Web part tools:

- **[sp-list-ordering](sp-list-ordering/)** — drag-to-reorder editor for a
  numeric `SortOrder` field on SharePoint lists. Optional per-list filter,
  explicit Save that renumbers the visible scope to gapped integers, and
  self-healing for missing/duplicate values.

Page libraries:

- **[bilingual](bilingual/)** — dependency-free EN/FR string-swap system
  (keyed dictionary + `data-intl` markup + `intl.t()`) for SharePoint pages,
  with a demo page.
- **[bsp-forms](bsp-forms/)** — JSON-configured replacement for MS Forms that
  runs inside SharePoint pages: one shared engine renders a multi-page form on
  the BSP design system and writes submissions (incl. multi-file attachments)
  to a SharePoint list via the self-hosted pnpjs v2 bundle. A form is one JSON
  file plus a two-line web part insert. Config reference in
  `bsp-forms/docs/CONFIG-REFERENCE.md`.
- **[classic-referrer-redirects](classic-referrer-redirects/)** —
  referrer-based second-hop redirect script for classic→modern SharePoint
  site migrations: JSON mapping of old-site paths to new-site pages, plus a
  destination-page notice snippet. Dependency-free, ES5-safe, `node test.js`.
  Being expanded for use across multiple sites.

Tenant services:

- **[bsp-notify](bsp-notify/)** — shared email-notification service. Parts
  queue an item on the site's `Notifications` list via `window.bspNotify(…)`
  (validated inputs, pnpjs v2, opt-in mock); the **BSP Notify** Power
  Automate flow (recurrence + queue, standard connectors only) sends each
  item from a shared mailbox and stamps `Sent`/`Failed` back on the item,
  with Teams alerts on error. Contract, schema, latency and staleness rules
  in [bsp-notify/README.md](bsp-notify/README.md).

## Development

`dev/` holds a disk-openable harness per tool (`dev/<tool>.dev.html`): it
simulates the SharePoint page — late-rendered web part zone included — and the
tools' mock data adapters activate automatically outside SharePoint.
`dev/vendor/` carries dev-only copies of the design-system CSS; live pages link
the deployed design system instead. Alpine is CDN in the harness only —
production always self-hosts.
