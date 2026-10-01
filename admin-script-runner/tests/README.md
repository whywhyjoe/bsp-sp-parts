# admin-script-runner — tests

Tiers and budgets per
[projects-standard `docs/03-test-policy.md`](https://github.com/whywhyjoe/projects-standard/blob/main/docs/03-test-policy.md).

**A check that does not need the DOM does not get a browser.**

## Suites

| Suite | Tier | Runtime | Checks | What it proves |
| --- | --- | --- | --- | --- |
| `node --test admin-script-runner/tests/pure.test.mjs` | fast | 0.3s | 18 | Slot maths, the end hour (no overnight runs), task registration in either load order, config validation (incl. `/` as the root site), query building, value rendering (dates, people, rich and plain multi-line text, URLs), grouping, permission bits, and the Markdown shape. |
| `node admin-script-runner/tests/smoke.mjs` | full | 41s | 20 | In a real browser against the dev harness (two task instances): a forced run finishes and closes itself; a same-slot visit is skipped **without any request**; Cancel mid-run saves nothing and closes itself; a failure landing after Cancel still gets a working Close; a mid-export list change triggers one re-export; a task script loaded after the runner still runs; with storage blocked nothing runs. |
| `node admin-script-runner/tools/sp/run-harness.js test-smoke` | full (dev tenant) | ~30s | 9 | The live pnp2 adapter against the dev `Intake Test` list: export, file read-back (groups, links, emails, no object leaks, date-only dates), then `due()` saying "not due" twice — once from file freshness, once from the unchanged-list comparison alone. Posts a correlated `TestRuns` row. |

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
