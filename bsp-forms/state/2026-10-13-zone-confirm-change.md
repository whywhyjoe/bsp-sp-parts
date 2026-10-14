# State — Zone attestation: confirm or change (bsp-forms 0.5.1)

Last touched: 2026-10-13
Branch: `bsp-forms-zone-confirm`, merged to `main` through PR
whywhyjoe/bsp-sp-parts#1 (main is the branch now)
State: engine 0.5.1 + form config on main. Harness suite green. Dev live
green 2026-10-13 (admin 23/23, non-admin 27/27) on the first commit; the later
UI commits were checked with the harness suite and screenshots only. Codex
review round done (xo turns 14, 15; all findings fixed). **Prod untouched.**

## What changed

Each area is now a **card** showing its current zone (dot, name, a
description). The user ticks "Confirm this is the correct zone" (a large
bordered tile) or clicks **Change zone**. Change shows the dropdown, which
leaves the current zone out, plus **Keep current zone** to undo, which sets
the row back to unconfirmed. Once a new zone is picked, the old one greys out
and is struck through, and the description switches to the new zone's. An
area with no current zone gets the dropdown straight away. The card wears the
zone's colour: a thick stripe, a tinted head and a big dot. Unanswered cards
have a blue-tinted action band; answered ones settle to grey and get a solid
green badge (Confirmed / Changed / Selected). Everything is a generic engine
option (docs: CONFIG-REFERENCE *Assignments*).

## Decisions (user, 2026-10-13)

- Five zones, named, never called by colour. Saved values (English, short):
  `Public` (lime, a light green chosen for colour blindness), `Public Plus`
  (yellow), `Standards` (berry/purple), `Secure Restricted` (orange),
  `High Security` (red). Labels are the full names.
- New columns: Assignments `CurrentZone` (same values; empty = none);
  Responses `PreviousZone` (text) and `ZoneChanged` (Yes/No; true when no
  current zone).
- Stacked cards were picked over table rows and 2-up cards.
- The ¾ / ¼ layout is the **SharePoint page's own section layout**, not the
  engine. The right column (resources) is the user's.
- Keep the bottom attestation checkbox and the submit warning dialog.
- Descriptions are per-zone placeholders. French zone names were drafted by
  the agent; the user will replace them.
- Example areas everywhere (harness mock, dev live test, dev twin list):
  FCP - Concourse Podium (High Security), FCP - Tower 10 (Public Plus),
  FCP - Tower 37 (none).
- Completion is tracked only in the Responses list (already the design; a
  dev "still completed" report was a delete in the wrong same-titled list).

## Companion artifacts

- Stakeholder walkthrough deck (BMO Presentations design system), screenshots
  with numbered markers, no title / translation / mobile slides:
  https://claude.ai/artifact/TaUDwfnPfo81KbWis3fWQD (private until shared).
  Screens were captured from the harness by a scratch Playwright script, not
  kept in the repo.

## Next

- [ ] Real zone descriptions + official French names → form JSON only.
- [ ] Prod (docs/PROD-DEPLOY.md): add the three columns, fill CurrentZone,
      deploy 0.5.1, set `jobAidUrl`, one test submission as an attester.
- [ ] Merge `main` into `bsp-forms-builder` (that branch has engine 0.6.0;
      the version and the assignments markup will need reconciling).
- [ ] Dev cleanup when 0.5.1 reaches dev for good: the side-by-side copy
      `<code>/bsp-forms-zc/` and page `bsp-forms-zone-confirm-test.aspx`.

## Landmines

- **Dev's deployed engine is the builder branch's 0.6.0**, and the builder's
  dev pages need it. The live run backed up `<code>/bsp-forms/` (engine,
  `forms/*.json`) and `lib/intl.js`, uploaded 0.5.1, ran, then restored the
  backup (hash-checked). Do the same on any rerun, or the builder breaks.
  The 0.5.1 copy for hand-testing lives in `<code>/bsp-forms-zc/`.
- **Two same-titled Responses lists on dev**: the form reads the tenant
  root's (`/Lists/PS_ZoneAttestationResponses`); the dev site's copy is the
  pnp cache-collision fixture. Reset test responses in the root one.
- A first admin run timed out once on the reload step's mount wait (slow page
  load); the rerun passed. If it recurs, look at `open()` in live-zone.js.
- The admin Playwright profile has leftover `*.CHROME_DELETE` folders from an
  old Chromium downgrade. The first headed re-login exited 33; the retry worked.
- Harness suite: `playwright` isn't installed in this repo. It ran with
  `NODE_PATH=C:/dev/repos/sp-traffic-analytics/node_modules`.
- `forms/ps-zone-attestation.json` must keep its hand formatting:
  `live-setup.ps1` swaps exact lines. Never re-serialize it with a JSON
  dumper.
