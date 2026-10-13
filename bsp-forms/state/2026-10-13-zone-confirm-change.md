# State — Zone attestation: confirm or change (bsp-forms 0.5.1)

Last touched: 2026-10-13
Branch: `bsp-forms-zone-confirm` (off `main`), committed, not pushed
State: engine 0.5.1 + form config. Harness suite green. **Dev live green
2026-10-13**: admin 23/23, non-admin 27/27 (incl. 403 on edit / lookup add).
Prod untouched.

## What changed

Each area is now a **card** showing its current zone (dot, name, a
description). The user ticks "Confirm this is the correct zone" or clicks
**Change zone**. Change shows the dropdown, which leaves the current zone out,
plus **Keep current zone** to undo, which sets the row back to unconfirmed.
Once a new zone is picked, the old one greys out and is struck through, and
the description switches to the new zone's. An area with no current zone gets
the dropdown straight away. The card wears the zone's colour: a thick stripe,
a tinted head and a big dot. Everything is a generic engine option (docs:
CONFIG-REFERENCE *Assignments*).

## Decisions (user, 2026-10-13)

- Five zones, named, never called by colour. Saved values (English, short):
  `Public` (lime, a light green chosen for colour blindness), `Public Plus`
  (yellow), `Standards` (berry/purple), `Secure Restricted` (orange),
  `High Security` (red). Labels are the full names.
- New columns: Assignments `CurrentZone` (same values; empty = none);
  Responses `PreviousZone` (text) and `ZoneChanged` (Yes/No; true when no
  current zone).
- Stacked cards were picked over table rows and 2-up cards (mockup, since
  deleted).
- The ¾ / ¼ layout is the **SharePoint page's own section layout**, not the
  engine. The right column (resources) is the user's.
- Keep the bottom attestation checkbox and the submit warning dialog.
- Descriptions are placeholders. French zone names were drafted by the agent;
  the user will replace them.
- The table header `rowLabel` is gone (ignored if present).

## Next

- [ ] Push + PR when the user asks.
- [ ] Merge into `bsp-forms-builder` later (that branch has engine 0.6.0; the
      version and the assignments markup will need reconciling).
- [ ] Real zone descriptions + official French names → form JSON only.
- [ ] Prod (docs/PROD-DEPLOY.md now lists the new columns).

## Landmines

- **Dev's deployed engine is the builder branch's 0.6.0**, and the builder's
  dev pages need it. The live run here backed up `<code>/bsp-forms/` (engine,
  `forms/*.json`) and `lib/intl.js`, uploaded 0.5.1, ran, then restored the
  backup (hash-checked). Do the same on any rerun, or the builder breaks.
  The dev lists keep the new columns and seeded `CurrentZone` values (harmless).
- A first admin run timed out once on the reload step's mount wait (slow page
  load); the rerun passed. If it recurs, look at `open()` in live-zone.js.
- The admin Playwright profile has leftover `*.CHROME_DELETE` folders from an
  old Chromium downgrade. The first headed re-login exited 33; the retry worked.
- Harness suite: `playwright` isn't installed in this repo. It ran with
  `NODE_PATH=C:/dev/repos/sp-traffic-analytics/node_modules`.
- `forms/ps-zone-attestation.json` must keep its hand formatting:
  `live-setup.ps1` swaps exact lines. Never re-serialize it with a JSON
  dumper.
