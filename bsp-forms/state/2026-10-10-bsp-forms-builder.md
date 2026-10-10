# State — bsp-forms builder

Last touched: 2026-10-10
Mode: Joe
Branch: `bsp-forms-builder`, pushed
State: plan written, Codex-reviewed (xo turn 7) and revised; waiting for the user's approval; no code yet

## What this is

A web-based builder for bsp-forms: it runs on a SharePoint page, reads a
chosen list's schema, lets the user add controls and map each to a column,
and downloads the form JSON plus a web part stub for the user to upload.
It needs engine 0.6.0 features first (branching, choice filtering, number
dropdown/slider, business-day date rules, clear buttons with real "empty"
saves, `@me` person default, confirmation redirect, a public API for
validation, schema reads and preview). The full plan, including the user's
decisions D1–D18 and the review log, is `docs/BUILDER-PLAN.md`.

## Next

- [ ] **User:** approve the plan (or adjust it). Items the review added
      that the user hasn't seen yet: `target.sendEmpty` (E6a), "answers on
      skipped pages count as empty" (E4), page 1 can't be conditional (E4),
      required columns must be written on every branch path (B7).
- [ ] Then B0: create `BSPF-Builder-Test` on the dev site
      (`dev/live/live-builder-list.ps1`) and answer B0's questions by REST.
- [ ] Then Phase 1 (engine 0.6.0), per the plan's section 5.

## Companion documents

- `docs/BUILDER-PLAN.md` — **live**, the build plan. Remove (or reduce to
  the builder README) when Phase 4 lands.

## Landmines

- Engine 0.6.0 ships before bsp-forms' first prod install. The other three
  bsp-forms threads' prod steps then install 0.6.0 (fine), but their `?v=`
  numbers in docs/PROD-DEPLOY.md change.
- The builder must make no SharePoint calls of its own; reads go through the
  engine's read-only facade (`BSPForms.lists()`, E9a), per bsp-forms/CLAUDE.md.
- Existing configs' payloads must stay byte-identical under 0.6.0 (Phase 1
  acceptance); `sendEmpty` is opt-in for that reason.
