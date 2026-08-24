# bsp-sp-parts — agent guide (CLAUDE.md)

This repo holds **deployable custom-script-web-part tools** for SharePoint
sites. It is a sibling of `whywhyjoe/bsp-design-system` (the component library —
read its CLAUDE.md before styling anything) and consumes that system **as a live
deployment**, never as a dependency to rebuild.

## Non-negotiables (inherited from the BSP family)
- **Buildless, CDN-free at runtime.** No bundler, no ES `import`, nothing the
  shipped artifact needs may depend on a build. CDN tags are dev-harness-only.
- **One BEM vocabulary on shared tokens.** Compose from `bsp-design` classes and
  CSS custom properties. No raw hex, no off-ramp px, never redefine `:root`.
  Genuinely new vocabulary a tool needs (e.g. drag affordances) lives in the
  **tool's own CSS file**, still built from tokens — promote to the design
  system only when a second tool needs it.
- **Interactivity = minimal inline Alpine** against the design system's state
  contract. Page-level factory functions (`window.<tool>Tool = function () {…}`)
  are the sanctioned shape for real app state; no `Alpine.data()` layer.
- **Icons** come from the design system sprite (`ic-fluent-*`). Extra glyphs are
  **copied** (never invented) from `whywhyjoe/bsp-fluent-icon-library`, with
  `fill` normalized to `currentColor`.
- **SharePoint data = PnPjs v2** (self-hosted `Code/lib/pnp2.bundle.js`, global
  `pnp`). Keep every pnpjs touchpoint inside one adapter object per tool, with a
  mock twin implementing the same interface.

## Boot contract — do not hand-roll it
Tools **must** delegate startup to `dcsMountPart()` in `_shared/dcs-part-boot.js` rather
than writing their own waiters. It owns the host wait, multi-instance idempotent mounting,
the edit-mode placeholder, and SPA re-mount. See `_shared/README.md` for the two mount
styles (injected vs static) and why re-mount differs between them.

**Alpine components are plain global factories** — `window.<toolName> = function () {…}`,
used from the markup as `x-data="<toolName>()"`. This matches bsp-design-system, which
ships **no `Alpine.data()` factory layer by design** and says so in its CLAUDE.md,
AGENTS.md, copilot-instructions.md, index.html and TECHNICAL-REFERENCE; its own pages use
inline `x-data` objects or a global factory, with zero `Alpine.data()` registrations. It is
also the more greppable form: the markup is visibly a function call, so searching the name
lands on the code. Do **not** reach for `dcsRegisterAlpineComponent` for an ordinary tool —
it exists for the one case that needs it: an app-shaped tool with **static** markup using
`dcsMountPart({ initTree: true })`, as the Fraud Journeys `#dcs-app` does.

PnPjs v2 is the global **`pnp2`** (not `pnp`). Never decide mock-vs-live from a synchronous
`typeof` check: wait via `waitForPnP2`, and on a live page treat a missing `pnp2` as a
**visible error**. Mock data must be opt-in only (`file:` protocol or `data-mock` on the
host) — silently substituting demo rows for a user's real list is the worst failure mode
this repo can ship.

## The web part pattern (what every tool follows)
1. **Stub** `<tool>.webpart.html` — per-instance; a page copies it and points
   `data-config` at its own JSON. Keep it tiny; all environment URLs live here
   and in the config, never in the JS.
2. **Engine** `<tool>.js` — mounts into every
   `[data-sp-part="<tool>"]:not([data-*-mounted])` div. Boot uses a **timer +
   DOM check** (`waitFor`) — SharePoint renders web part zones late and out of
   order, and a MutationObserver alone is not reliable there; the observer is
   attached only as an accelerator. Wait for `window.Alpine` the same way and
   render a plain-HTML `.msgbar--danger` on timeout. Alpine v3 auto-initializes
   injected trees, so mount order vs. Alpine load order doesn't matter.
3. **Mock mode** — when `pnp` is missing or the page is on `file:`, the mock
   adapter activates; every tool must be fully exercisable from disk via its
   `dev/<tool>.dev.html` harness (which injects the target div late on purpose).

## Live URLs (the portal deployment this repo targets)
- Design system: `/sites/FCUPortal/Code/bsp-design/styles.css` (or the two CSS
  files individually, tokens first)
- Libs: `/sites/FCUPortal/Code/lib/alpine.js`, `/sites/FCUPortal/Code/lib/pnp2.bundle.js`
- Full icon library (separate deployment): `/sites/FCUPortal/fluent-icons/`
- Tool assets: per-site SiteAssets folder, chosen at deploy time

## Verifying a change
Open the tool's `dev/*.dev.html` from disk: the late-injected div must mount,
mock data must load, and every `<use href="#…">` must resolve against the
injected sprite. No console errors, keyboard path works (move buttons), reduced
motion respected. Real-site smoke happens after upload — see each tool's README.

## Ignore
`dev/vendor/` — dev-only design-system snapshots, never deployed, refreshed by
hand from the design-system repo.
