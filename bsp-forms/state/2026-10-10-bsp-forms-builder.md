# State — bsp-forms builder

Last touched: 2026-10-10
Mode: Joe
Branch: `bsp-forms-builder`, pushed (not merged to main)
State: Phase 1 (engine 0.6.0) DONE — built, reviewed (xo 8), fixed, re-reviewed (xo 9), last gap fixed; dev-deployed at ?v=62 and live-verified; Phase 2 (builder core) not started; prod untouched

## What this is

A web-based builder for bsp-forms: it runs on a SharePoint page, reads a
chosen list's schema, lets the user add controls and map each to a column,
and downloads the form JSON plus a web part stub for the user to upload.
Engine 0.6.0 (done) adds what the builder emits. The plan, the user's
decisions D1–D21, the B0 dev results and the review log are in
`docs/BUILDER-PLAN.md`; the feature contract is `docs/CONFIG-REFERENCE.md`.

## Done

- Plan approved by the user 2026-10-10, including the review's four
  additions and D20 (one/two-column sections, drag ordering) and D21 (the
  zone attestation's visual level).
- B0 on dev: list **BSPF Builder Test** (`dev/live/live-builder-list.ps1`)
  and the probe; results recorded in the plan's section 5.
- Engine 0.6.0 (commits 1cad24c, 90c8803 and the reset-prune fix after the
  xo 9 re-review): smoke 320/320; dev live `live-v06.js` 33/33 plus the four
  existing forms (35, 25, 15, 20 + 24 non-admin) at `?v=62`.

## Next

- [ ] **Phase 2 — builder core** per the plan's section 5 (B1 outline +
      properties panes, B2 document model, B3 list picker/schema, B4
      controls, B7 schema checks + download), in `bsp-forms/builder/`, with
      `dev/builder.dev.html` on the mock tenant (`BSPForms.lists()` mock
      already returns the B0 column set) and `dev/builder.spec.js`.
- [ ] Merge `bsp-forms-builder` to main when the user says (the branch now
      carries engine 0.6.0, which the other bsp-forms threads' prod steps
      would then install).

## Companion documents

- `docs/BUILDER-PLAN.md` — **live**, the build plan. Remove (or reduce to
  the builder README) when Phase 4 lands.

## Landmines

- Engine 0.6.0 is on this branch only. PROD-DEPLOY.md on this branch
  already says 0.6.0; main still says 0.5.0 until the merge.
- Existing forms' payloads must stay identical: `sendEmpty` is opt-in. The
  one visible change for them is the × on optional fields.
- The builder must make no SharePoint calls of its own; reads go through
  `BSPForms.lists()` (read-only facade), per bsp-forms/CLAUDE.md.
- Dev test pages are at `?v=62`; bump `-Ver` on every engine upload
  (`live-page.ps1`, `live-v06.ps1`).
- Writing engine code through the Bash tool collapses `\\` — use Edit/Write
  for anything with escaped quotes (it broke a line once this session).
