# State — bsp-forms builder

Last touched: 2026-10-11
Mode: Joe
Branch: `bsp-forms-builder`, pushed (not merged to main)
State: Phases 1–3 DONE (engine 0.6.0 + builder: core, rules editor, form settings, live preview); builder 594/594, engine 351/351, live on dev at ?v=70; Phase 4 not started; prod untouched

## What this is

A web-based builder for bsp-forms: it runs on a SharePoint page, reads a
chosen list's schema, lets the user add controls, map each to a column, add
rules, and preview the form live, then downloads the form JSON plus a web
part stub for the user to upload. The plan, decisions D1–D21, B0 results and
the review log (xo turns 7–13) are in `docs/BUILDER-PLAN.md`; the builder's
contract is `builder/README.md`.

## Done

- Engine 0.6.0 (Phase 1) plus the builder hooks added in Phases 2–3:
  `loadUi`, `engineBase`, `inEditMode`, `list.webUrl`, choice
  `validation.maxLength`, the doctor accepting a required column with a
  default, and `mountConfig` preview mounts.
- Builder 0.1.0, Phases 2–3:
  - outline/properties/preview panes, list picker + catalog, 12 controls with
    schema-forced mapping;
  - rules editor (show-when on controls/sections/pages, end-when, choice
    limits, date rules), form settings (look, "are you sure?", success +
    redirect, attachments);
  - checks, undo/redo, draft, download.
- Live on dev, all green at the last runs:
  - `live-builder.js` 16 + 9;
  - `live-builder-rules.js` 14 + 6 — the preview on a real page made zero
    SharePoint writes and never navigated;
  - the four existing forms + `live-v06.js` at `?v=69` (152).

## Next

- [ ] **Phase 4** per the plan's section 5:
  - **Open JSON**, from a local file or a deployed config URL. Refuse
    `assignments` (D3). Preserve the parts the builder doesn't model
    (bilingual pairs, afterSubmit, prompts, locks, query/hidden/lookup
    controls) and lock those controls in the outline. Re-read the schema of
    `$builder.list` or `target`.
  - **Round-trip:** each `forms/*.json` except the zone attestation opens and
    re-downloads deep-equal apart from `$builder` and key order.
  - **The full reference walker on real configs:** classic `resourceName` →
    `afterSubmit.lookup.matchField`; creative `priority` →
    `prompt.confirm.set`.
  - Dev live regression of the four forms on the final engine; PROD-DEPLOY
    §4 "Install the builder".
- [ ] Merge `bsp-forms-builder` to main when the user says.

## Companion documents

- `docs/BUILDER-PLAN.md` — **live**, the build plan + review log. Remove (or
  reduce to the builder README) when Phase 4 lands.
- `builder/README.md` — **live**, the builder's contract.

## Landmines

- Engine 0.6.0 is on this branch only; main still says 0.5.0 until the merge.
- Existing forms' payloads must stay identical: `sendEmpty` is opt-in.
- The builder makes no SharePoint calls of its own (`BSPForms.lists()` only);
  its preview must never write or navigate (`mountConfig({ preview })`).
- Builder gotchas (reactive mirrors, blank stand-ins, schema identity,
  flush-before-download, "always filled", the preview's Alpine isolation —
  never `x-ignore`) are in `bsp-forms/CLAUDE.md`.
- `defineProperty` on an Alpine reactive proxy skips its triggers. Author
  keys go through `put()`/`mapWith()` (a copy assigned whole).
- Dev pages: forms `?v=69`, builder `?v=70`; bump `-Ver` on every upload
  (`live-page.ps1`, `live-v06.ps1`, `live-builder.ps1 [-Publish -Name]`).
- Writing code through the Bash tool collapses `\\`: use Edit/Write for
  anything with escaped quotes.
