# STATE — admin-script-runner

**Rewritten, never appended.** History lives in `LOG.md`. Cap: 150 lines.

Threads of work in progress: [`state/`](state/), one file per thread, kept by
the `project-state` skill.

## Where things stand

| | |
| --- | --- |
| **Version** | 0.1.5 (`VERSION`: dev-build 6, prod-build 0) — after three Codex review rounds (xo turns 1, 3, 4); review closed by the user on 2026-10-01 |
| **Deployed** | **dev only** — `code` root `apps/admin-script-runner/`, verified live 2026-10-01 on 0.1.5 (test-smoke 10/10; demo page: forced run → Done → closed, reload `not-due`, third visit skipped with zero requests) |
| **Prod** | not deployed |
| **Last shipped** | nothing shipped to prod yet |
| **Branch** | `admin-script-runner` (not merged) |

Dev fixtures this part created: list library **ASR Test Output**, pages
`_harness-admin-script-runner.aspx` and `admin-script-runner-demo.aspx`. It
reads (never writes) the existing `Intake Test` list.

## Next committed step

Write the real config for the intake list (fields, group/subgroup, filter,
output folder Copilot reads) with the user, then deploy to prod.

## Blocking

- [ ] The intake list's real config: which fields, grouping, filter, and the
      output folder/library (whose readers must match the list's readers).

## Manual gates

- [ ] **Prod deploy + harness:** `deploy.ps1` on the prod machine, a human runs
      `verify.js` and `test-smoke.js` from the prod harness page (needs a
      `Intake Test`-named list there, or point `env.json` `sourceList` at a
      real one first).
- [ ] **Read-only visitor:** a user who can read the page but not edit the
      output file sees no panel and no error (`status()` says `not-due`).
      Needs a second account; not testable as a site admin.
- [ ] **Copilot reads it:** after the first real export and a crawl, Copilot
      answers a question only the file can answer, and cites an item link.
- [ ] **Prod design-system path:** the stub links `<code root>/bsp-design/styles.css`;
      confirm it resolves on prod (dev: verified).

## Deferred by design

- **Paging past 5,000 items** — `maxItems` is one request by design (the
  requirement is "recent items for Copilot", default 50).
- **Old `window.AdminAutoTasks` tasks** — not supported; none were in use.
- **Exporting on config change** — only list changes trigger; use
  `?adminTasks=force` after editing a config.

## Open questions

- Should the first export (file not yet there) also check folder permission, so
  a read-only first visitor is skipped instead of seeing a 403 panel? Settle it
  if that ever happens in practice; today the page author runs the first export.
