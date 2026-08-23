# bsp-sp-parts

Deployable **custom script web part tools** for SharePoint sites, built on the
[BSP design system](https://github.com/whywhyjoe/bsp-design-system) (which runs
live on the portal at `/sites/FCUPortal/Code/bsp-design/`). Buildless and
CDN-free at runtime, like everything in the BSP family: what's authored here is
what runs.

## The pattern

Every tool is one folder with four artifacts:

| File | Role | Deployed |
| --- | --- | --- |
| `<tool>.webpart.html` | **Per-instance stub** (~8 meaningful lines): CSS links, one target div, script tags. Each embedding page keeps its **own copy**, and the only edit that matters is pointing `data-config` at that page's JSON. | One copy per embedding page |
| `<tool>.js` | The shared, environment-agnostic engine: waits for the target div (timer + DOM check — SharePoint renders zones on its own schedule), injects the UI, runs it with inline Alpine. | Once per site |
| `<tool>.css` | Tool-local styles built on design-system tokens. | Once per site |
| `<tool>.config.json` | **Owned by the embedding page**, referenced by the stub's `data-config`. Sample ships in the tool folder. | One per instance |

Shared runtime prerequisites, already live on the portal: the design system
bundle (`Code/bsp-design/styles.css`) and the self-hosted libs
(`Code/lib/alpine.js`, `Code/lib/pnp2.bundle.js`).

## Tools

- **[sp-list-ordering](sp-list-ordering/)** — drag-to-reorder editor for a
  numeric `SortOrder` field on SharePoint lists. Optional per-list filter,
  explicit Save that renumbers the visible scope to gapped integers, and
  self-healing for missing/duplicate values.

## Development

`dev/` holds a disk-openable harness per tool (`dev/<tool>.dev.html`): it
simulates the SharePoint page — late-rendered web part zone included — and the
tools' mock data adapters activate automatically outside SharePoint.
`dev/vendor/` carries dev-only copies of the design-system CSS; live pages link
the deployed design system instead. Alpine is CDN in the harness only —
production always self-hosts.
