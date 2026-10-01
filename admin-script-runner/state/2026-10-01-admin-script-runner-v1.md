# State — admin-script-runner v1 (runner + sp-list-to-markdown)

Last touched: 2026-10-01
Mode: Joe
Branch: merged to main (fe0a624) and pushed; branch admin-script-runner kept on origin
State: 0.1.5 on main, dev-deployed and dev-verified; prod untouched

## What this is

A page library in bsp-sp-parts that runs small admin tasks on page visit (at
most once per local-hour slot, 8–18 every two hours) behind a bottom-of-screen
status panel, replacing the old per-site `admin-autos.js`. The first task,
`sp-list-to-markdown`, writes a list to a `.md` file in a library because
Copilot cannot reliably read list content.

## Done

- Runner, panel, `sp-list-to-markdown` task, stub generation, docs, tests.
- Panel redesign (slim design-system-blue header, task list, bottom-right
  dock); the bokeh-art header was tried and rejected by the user.
- Three Codex review rounds (xo turns 1, 3, 4; turn 2 died on a Codex service
  error), all fixes in 0.1.5. The user closed the review after round 3's two
  findings were fixed — no round-4 review was run. Accepted-not-fixed items and
  the reasons are in docs/00-overview.md.
- 0.1.5 deployed to dev and verified live (test-smoke 10/10, demo page).

## Next

- [ ] With the user: the intake list's real config (fields, group/subgroup,
      filter, output library whose readers match the list's). Write it as a
      JSON in the prod site's SiteAssets, not in the repo.
- [ ] Prod: `git pull` + `deploy.ps1` on the prod machine, then the manual
      gates in `../STATE.md`.

## Companion documents

- `docs/00-overview.md` … `03-sp-list-to-markdown.md` — **live**, the durable
  reference; nothing in this file duplicates them.

## Landmines

- The repo's `admin-script-runner.webpart.html` holds `__TOKENS__` — never paste
  it; paste the deployed, generated one.
- `-DirectUpload` can hit a one-off SharePoint error ("resubmit your changes", "trouble with SharePoint storage")
  while OneDrive syncs the same file; rerun until parity matches.
- A just-deployed runtime change is invisible to pages until `version=` in
  `VERSION` is bumped and the stub re-pasted (24-hour library cache).
