# admin-script-runner

Runs small admin tasks when a SharePoint page is visited — at most once per
schedule slot — and shows their progress in a status panel pinned to the bottom
of the screen. Ships with one task, **sp-list-to-markdown**, which exports a
list to a Markdown file in a library so Copilot can read list content.

**Kind:** page library (bsp-sp-parts kinds table). It adopts `dcsMountPart()`
deliberately — for host discovery, the edit-mode placeholder and SPA re-mount —
but has no Alpine and no four-artifact web part pattern.

## Using it on a page

1. Write a config JSON for the instance and upload it anywhere the page's
   visitors can read (e.g. the site's `SiteAssets/admin-tasks/`). Reference:
   [`docs/03-sp-list-to-markdown.md`](docs/03-sp-list-to-markdown.md); sample:
   [`tasks/sp-list-to-markdown/sp-list-to-markdown.config.json`](tasks/sp-list-to-markdown/sp-list-to-markdown.config.json).
2. Add a Script Editor web part and paste the **deployed**
   `admin-script-runner.webpart.html` (generated per environment by the deploy —
   never the repo copy, which holds `__TOKENS__`). Edit only `data-config`.
3. Visit the page with `?adminTasks=force` once to run it immediately and check
   the file.

Everyone who can open the page can trigger a run; only visitors who can edit the
output file actually export (others are skipped silently). See
[`docs/00-overview.md`](docs/00-overview.md) for who sees what.

## Scheduling (the whole rule)

Slots are local hours, default `8, 10, 12, 14, 16, 18`. On each page visit, per
task instance:

1. **This browser already checked in the current slot?** Stop — no network.
2. **Output file written since the slot started?** Stop.
3. **List unchanged since the file was written?** Stop.
4. Otherwise the panel appears and the export runs.

So: at most one export per slot, only when the list changed, never overnight.

## Running it locally

```
node --test admin-script-runner/tests/pure.test.mjs      # fast tier, ~0.3s
node admin-script-runner/tests/smoke.mjs                 # full tier, ~12s, headless Chromium
python -m http.server 8646                               # then open /dev/admin-script-runner.dev.html
```

Dev tenant loop (sp-env): `pwsh admin-script-runner/tools/sp/deploy.ps1 -DirectUpload`,
then `node admin-script-runner/tools/sp/run-harness.js test-smoke`.

## Where to look

| | |
| --- | --- |
| How it works | [`docs/README.md`](docs/README.md) |
| Where things stand | [`STATE.md`](STATE.md) |
| What shipped when | [`LOG.md`](LOG.md) |
| Rules for agents | [`CLAUDE.md`](CLAUDE.md) |
