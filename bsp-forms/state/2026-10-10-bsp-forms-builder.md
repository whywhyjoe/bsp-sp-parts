# State — bsp-forms builder

Last touched: 2026-10-10
Mode: Joe
Branch: `bsp-forms-builder`, pushed
State: plan written and under Codex review; no code yet

## What this is

A web-based builder for bsp-forms: it runs on a SharePoint page, reads a
chosen list's schema, lets the user add controls and map each to a column,
and downloads the form JSON plus a web part stub for the user to upload.
It needs engine 0.6.0 features first (branching, choice filtering, number
dropdown/slider, business-day date rules, clear buttons, `@me` person
default, confirmation redirect, a public API for validation and preview).
The full plan, including the user's decisions D1–D18, is
`docs/BUILDER-PLAN.md`.

## Next

- [ ] Finish the xo Codex review of `docs/BUILDER-PLAN.md`, revise the plan,
      notify the user.
- [ ] After the user approves the plan: B0 (dev schema probe), then Phase 1
      (engine 0.6.0), per the plan's section 5.

## Companion documents

- `docs/BUILDER-PLAN.md` — **live**, the build plan. Remove (or reduce to
  the builder README) when Phase 4 lands.

## Landmines

- Engine 0.6.0 ships before bsp-forms' first prod install. The other three
  bsp-forms threads' prod steps then install 0.6.0 (fine), but their `?v=`
  numbers in docs/PROD-DEPLOY.md change.
- The builder must make no SharePoint calls of its own; reads go through the
  engine adapter (`BSPForms.adapter()`), per bsp-forms/CLAUDE.md.
