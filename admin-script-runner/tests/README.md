# admin-script-runner — tests

Tiers and budgets per
[projects-standard `docs/03-test-policy.md`](https://github.com/whywhyjoe/projects-standard/blob/main/docs/03-test-policy.md).

**A check that does not need the DOM does not get a browser.**

## Suites

| Suite | Tier | Runtime | Checks | What it proves |
| --- | --- | --- | --- | --- |
| `node --test admin-script-runner/tests/pure.test.mjs` | fast | 0.6s | 23 | Slot maths, the end hour (no overnight runs), task registration in either load order, config validation (incl. `/` as the root site), query building, value rendering (dates, people, rich and plain multi-line text, URLs), grouping, permission bits, the Markdown shape, the source-watermark decision and settle delay — and the task run end to end on its mock, proving an edit made mid-export is exported at the next check; and the shipped sample config is valid and annotated for every key. |
| `node admin-script-runner/tests/smoke.mjs` | full | 58s | 23 | In a real browser against the dev harness (two task instances): a forced run finishes and closes itself; a same-slot visit is skipped **without any request**; Cancel mid-run saves nothing and closes itself; a failure landing after Cancel still gets a working Close; every export records its source watermark; a task script loaded after the runner still runs; with storage blocked — or only the schedule write failing — nothing runs; a config download that finishes after the closing hour does not run (clock set to 19:59:54); a task whose check finishes in the next slot is stamped in that slot (clock set to 09:59:54). |
| `node admin-script-runner/tools/sp/run-harness.js test-smoke` | full (dev tenant) | ~30s | 10 | The live pnp2 adapter against the dev `Intake Test` list: export, file read-back (groups, links, emails, no object leaks, date-only dates), the watermark on the file's Title, then `due()` saying "not due" twice — once from file freshness, once from the unchanged-list comparison alone. Posts a correlated `TestRuns` row. |

**Fast tier budget: 30s.**

`smoke.mjs` serves the bsp-sp-parts root itself and resolves Playwright from the
sp-env skill (`~/.claude/skills/sp-env/scripts/node_modules`), or
`PLAYWRIGHT_PATH`. `CHROMIUM=<path>` pins the browser.

## Browser-suite rules

- **No `waitUntil: 'networkidle'`**, **no `waitForTimeout`** — wait on the real
  condition (`.asr-panel` attached/detached, the label text).

## Not tested here

Behaviour for a visitor **without** edit rights on the output file (skipped
silently) and prod-tenant paths — both are manual gates in `../STATE.md`.
