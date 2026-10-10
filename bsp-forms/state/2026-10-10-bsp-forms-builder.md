# State — bsp-forms builder

Last touched: 2026-10-10
Mode: Joe
Branch: `bsp-forms-builder`, pushed (not merged to main)
State: Phase 1 (engine 0.6.0) DONE; Phase 2 (builder core) DONE — built, suite 380/380, two Codex rounds (xo 10, 11) fixed, live on dev at ?v=67; Phase 3 not started; prod untouched

## What this is

A web-based builder for bsp-forms: it runs on a SharePoint page, reads a
chosen list's schema, lets the user add controls and map each to a column,
and downloads the form JSON plus a web part stub for the user to upload.
Engine 0.6.0 adds what the builder emits. The plan, decisions D1–D21, B0
results and the review log are in `docs/BUILDER-PLAN.md`; the builder's
contract is `builder/README.md`.

## Done

- Engine 0.6.0 + a few Phase 2 engine hooks (`BSPForms.loadUi`, `engineBase`,
  `engineSrc`, `inEditMode`, `list.webUrl` in schemas, doctor accepts a
  required column with a default, choice `validation.maxLength`). Engine suite
  320/320; the four existing live forms + the 0.6.0 live test all green at
  `?v=66`.
- Builder 0.1.0 (Phase 2 scope: B1 outline + properties, B2, B3, B4, B7):
  `builder/`, suite `dev/builder.spec.js` 380/380, live on dev
  (`SitePages/bsp-forms-builder.aspx`): `live-builder.js` 16/16 against the
  real list, its download published (`live-builder.ps1 -Publish`) and
  submitted 9/9 with the item read back.

## Next

- [ ] **Phase 3** per the plan's section 5:
  - B5, the rules editor: show-when on fields, sections and pages,
    end-the-form, `choicesWhen` table, date rules (business-day lead adds a
    blocking `businessDay`);
  - B6, form settings: appearance, submit confirm with Yes/No, confirmation
    + redirect, attachments ≤ 5 files / 10 MB on a reachable page;
  - E9b, `BSPForms.mountConfig` preview (simulated `ensureUser`/writes, no
    navigation) and the B1 preview pane.

  Rename/delete through rules uses the existing walker. The field pane's
  "comes with the rules editor" notes mark where B5 goes.
- [ ] Phase 4: open JSON + round-trip of `forms/*.json` (zone attestation
      refused), PROD-DEPLOY §4 "Install the builder".
- [ ] Merge `bsp-forms-builder` to main when the user says.

## Companion documents

- `docs/BUILDER-PLAN.md` — **live**, the build plan. Remove (or reduce to
  the builder README) when Phase 4 lands.
- `builder/README.md` — **live**, the builder's contract.

## Landmines

- Engine 0.6.0 is on this branch only; main still says 0.5.0 until the merge.
- Existing forms' payloads must stay identical: `sendEmpty` is opt-in.
- The builder makes no SharePoint calls of its own (`BSPForms.lists()` only).
- Builder gotchas (reactive mirrors, blank stand-ins, schema identity,
  flush-before-download, "always filled") are in `bsp-forms/CLAUDE.md`.
- Dev test pages: forms at `?v=66`, builder page at `?v=67`; bump `-Ver` on
  every upload (`live-page.ps1`, `live-v06.ps1`, `live-builder.ps1`).
- Writing code through the Bash tool collapses `\\` (bit twice this session):
  use Edit/Write for anything with escaped quotes.
