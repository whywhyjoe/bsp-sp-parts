# State — admin-script-runner v1 (runner + sp-list-to-markdown)

Last touched: 2026-10-01
Mode: Joe
Branch: admin-script-runner, not pushed
State: built, dev-deployed and dev-verified; not merged; prod untouched

## What this is

A page library in bsp-sp-parts that runs small admin tasks on page visit (at
most once per local-hour slot, 8–18 every two hours) behind a bottom-of-screen
status panel, replacing the old per-site `admin-autos.js`. The first task,
`sp-list-to-markdown`, writes a list to a `.md` file in a library because
Copilot cannot reliably read list content.

## Done

- Runner, panel, task, stub template, deploy generation, docs, fast + full tests.
- Dev: deployed (`-DirectUpload`, parity match), provisioned, verify zero drift.
- 0.1.2 panel redesign (slim blue header, task list, bottom-right dock) deployed
  to dev and checked on the live demo page. The bokeh-art header was tried and
  rejected by the user as too much (see docs/00-overview.md decisions).
- Codex review round 1 (xo turn 1) fixed in 0.1.3: re-export on mid-export
  change, gate before any request, stamp before the config fetch, no-storage
  guard, late task registration, `/` root site, Close after Cancel, end hour
  (`schedule.until`), docs. Accepted-not-fixed items are in docs/00-overview.md.
  Dev-deployed and verified live. Committed as 203b99a.
- Codex round 2 (xo turn 3) fixed in 0.1.4: source watermark on the output
  file's Title replaces the re-export loop (plus a ≤2 s settle for one-second
  timestamps); fresh clock after the config fetch and before each task starts;
  second storage write checked; docs. Dev-deployed and verified live.

## Next

- [ ] Codex round 3 (xo turn 4, on 203b99a..8fd750d): round-2 items 3, 4 and
      all doc items closed; two left, user to decide whether to fix:
      (1) no parsable watermark falls back to the save time, so a first export
      whose Title write fails can hide a mid-export edit — proposed: treat a
      missing/invalid watermark as due at the next slot (`needsExport`);
      (2) a job whose due() or predecessor runs past a slot boundary keeps the
      old slot's stamp (costs one extra check) — proposed: re-stamp before start.
- [ ] With the user: the intake list's real config (fields, group/subgroup,
      filter, output library whose readers match the list's). Write it as a
      JSON in the prod site's SiteAssets, not in the repo.
- [ ] Merge the branch (user's call), then prod: `deploy.ps1` on the prod
      machine and the manual gates in `../STATE.md`.

## Companion documents

- `docs/00-overview.md` … `03-sp-list-to-markdown.md` — **live**, the durable
  reference; nothing in this file duplicates them.

## Landmines

- The repo's `admin-script-runner.webpart.html` holds `__TOKENS__` — never paste
  it; paste the deployed, generated one.
- `-DirectUpload` can hit a one-off SharePoint "resubmit your changes" conflict
  while OneDrive syncs the same file; rerun until parity matches.
- A just-deployed runtime change is invisible to pages until `version=` in
  `VERSION` is bumped and the stub re-pasted (24-hour library cache).
