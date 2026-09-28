# State — admin-script-runner v1 (runner + sp-list-to-markdown)

Last touched: 2026-09-28
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
- Dev: deployed (`-DirectUpload`, parity match), provisioned, verify zero drift,
  test-smoke 8/8, demo page ran end to end and the reload was slot-gated.
- 0.1.2 panel redesign (slim blue header, task list, bottom-right dock) deployed
  to dev and checked on the live demo page. The bokeh-art header was tried and
  rejected by the user as too much (see docs/00-overview.md decisions).

## Next

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
