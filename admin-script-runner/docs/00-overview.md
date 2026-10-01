# admin-script-runner — overview

## What this is

A page library that runs small admin tasks when a SharePoint page is visited, at
most once per schedule slot, with progress shown in a status panel pinned to the
bottom of the screen. It replaces the old per-site `admin-autos.js` controller
(kept, uncommitted, in `.scratch/` for reference).

The first task, `sp-list-to-markdown`, exists because Copilot cannot reliably
read SharePoint list content: it writes the list to one Markdown file in a
library, which Copilot can read.

## The non-negotiables

- **A visit must cost nothing when there is nothing to do.** In an
  already-checked slot the gate decides from `localStorage` alone (stamp +
  cached schedule) — no request, not even the config. `due()` is at most two
  small GETs. Anything heavier on every load defeats the point.
- **The attempt is stamped before anything can fail** — before the config
  fetch and `due()`. Without that, a broken task (bad config, missing
  permission, a 500) retries — and shows its error panel — on every page load.
  If the stamp cannot be stored, the runner does not run automatically at all.
- **Mock data is opt-in.** A live page that silently exported demo rows over a
  real file is the worst failure available here.
- **Visitors without edit rights on the output file never see the panel.**
  `due()` reads `EffectiveBasePermissions` in the same GET as the file's age and
  says "not due" for them. (First export only: the file does not exist yet, so
  there is nothing to check — whoever triggers it needs write access. Run the
  first export yourself with `?adminTasks=force`.)
- **The Markdown file carries the output library's permissions, not the list's.**
  Put it where the list's readers — and only they — can read it. Copilot honours
  the file's permissions.

## How the pieces fit

```
page ── Script Editor web part = generated stub
          <div data-admin-task="sp-list-to-markdown" data-config="…json">
          pnp2.bundle.js → dcs-part-boot.js → task scripts → admin-script-runner.js

admin-script-runner.js
  registry     window.adminScriptTasks — a push-queue; tasks register in any order
  discovery    dcsMountPart('[data-admin-task]'): every host, edit-mode placeholder,
               SPA re-mount; hosts that mount together are checked as one batch
  per host     memory gate (stamp + cached schedule, no network) → stamp →
               load config → slot gate with its schedule → type.due(ctx)
               (a type not registered yet: the host waits up to 10 s for it)
  if any due   open panel (task list) → type.run(ctx) one after another → All done
               (closes in 3 s) | Cancelled (closes in 3 s) | Needs attention (stays, Close)

tasks/sp-list-to-markdown
  due          GET file (TimeLastModified + edit permission) → GET list LastItemModifiedDate
  run          list → fields → items (one request, ≤ maxItems) → Markdown → upload (overwrite)
               → re-read the list's timestamp; changed meanwhile → export again (≤ 3 attempts)
  adapters     makeLiveAdapter (pnp2, the only SharePoint code) / makeMockAdapter (twin)
```

The panel is plain DOM built from bsp-design: a flush `.card` with a slim
design-system-blue header (eyebrow, title, a wrench icon tile that turns while
working), a task list with per-task glyphs (clock → spinner →
check / warning), a `.progress--thick` bar, and a footer holding the live status
line and the one button. Docked bottom-right on wide screens, a full-width sheet
at the bottom on narrow ones. `admin-script-runner.css` is layout only. Console surface on any page:
`adminScriptRunner.status()`, `.run()`, `.clearSchedule()`, `.types()`.

## Decisions

### Rewrite, not adapt, the old admin-autos controller — 2026-09-28

The old controller was ~1,900 lines copied per site, with one all-or-nothing
daily guard per browser, hex-coded dialog styling, and dependency polling.
**Rejected:** trimming it — the copy-per-site model and the single guard were the
problems. **Costs:** tasks written for `window.AdminAutoTasks` do not run here
(none were in use).

### Per-task `due()` instead of runner-level scheduling — 2026-09-28

Only the task knows whether there is work (has the list changed?). The runner
owns *when to ask* (slots), the task owns *whether to act*. **Rejected:** a
runner-wide daily guard — it cannot express "every two hours, only if changed".

### Fixed local-hour slots, not a rolling interval — 2026-09-28

Same cost as rolling. Default 8–18 every two hours; the day closes at
`schedule.until` (default two hours after the last slot, so 20:00) — without an
end the last slot would stretch to midnight. Per-instance `schedule` overrides.

### Accepted, not fixed (Codex review, 2026-09-30)

- **Two tabs in one browser can both run an instance in the same slot** —
  `localStorage` has no atomic read-and-stamp. Worst case: one duplicate export
  with identical content. Locking was judged not worth it.
- **Date-only values assume a site zone within ±11 h of UTC** (see Paid-for
  gotchas). The portal's sites are North American.
- **The panel's status glyphs contain `#fff` strokes** — copied verbatim from
  the design-system sprite, per the "copy, never invent" icon rule.

### Runner and tasks in one part — 2026-09-28

Tasks live in `tasks/<type>/` and deploy flat beside the runner, one deploy for
everything. **Rejected:** a separate part per task — more deploys and version
drift for a handful of scripts.

### Instance config by URL (`data-config`), not inline JSON — 2026-09-28

Matches the repo's other parts and avoids depending on how the Script Editor
web part treats non-JS `<script>` tags. **Costs:** one extra small file per
instance.

### A slim design-system-blue header, no brand artwork — 2026-09-28

The plain card read as generic, so the panel gained a blue header, a task list
with per-task glyphs and a thick bar. The header is solid `--accent-rest`, one
line (eyebrow + title), text only — the action stays on white.
**Rejected:** editorial.css's BMO bokeh artwork — tried, and judged one step too
far for a utility panel; it also cost an extra stylesheet on every page.
Glyphs are inlined (copied from the sprite and bsp-fluent-icon-library), so pages
need no sprite.

### Due-phase failures log to the console only — 2026-09-28

A missing `pnp2`, a bad config or a 403 during `due()` is logged
(`console.error`, `adminScriptRunner.status()`), not shown: every visitor would
otherwise see it. Failures during `run()` — reached only by visitors who can
write — show in the panel.

## Paid-for gotchas

- **A list item's `Modified` is site-local time with no zone.** REST returns
  `"2026-09-28T09:31:54"` (site regional time) while the file's
  `TimeLastModified` is `"2026-09-28T16:31:54Z"`. `new Date()` reads the first
  as *browser*-local, so a just-written file looked hours old and `due()` kept
  saying yes. Use `TimeLastModified`. (Found by the live smoke test.)
- **`_api` without an `Accept` header answers in XML.** Every raw `fetch` sends
  `application/json;odata=nometadata`.
- **`LastItemModifiedDate` moves for more than item edits** — on dev it moved
  at the moment the provision op ensured the (unchanged) source list. The cost
  is an occasional extra export, which is harmless; don't try to make it exact.
- **An edit landing mid-export would otherwise be lost for good**: the upload
  finishes after the edit, so the file looks newer than the list and `due()`
  says no until the next edit. `run()` re-reads `LastItemModifiedDate` after
  saving and exports again if it moved (Codex review finding).
- **Date-only columns are stored as site-local midnight in UTC** (Eastern:
  `T04:00:00Z`). Rendering them rounds to the nearest UTC midnight, which is
  correct for any site zone within ±11 h (a UTC+12/+13 site would show the
  previous day). Never format them in a time zone.
