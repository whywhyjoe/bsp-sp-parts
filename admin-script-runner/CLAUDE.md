# admin-script-runner

Runs small admin tasks on page visit, at most once per schedule slot, behind a
bottom-of-screen status panel. First task: `sp-list-to-markdown` (list → `.md`
file for Copilot).

`docs/` is how it works and why (read `docs/README.md` first); `STATE.md` is
where things stand. The repo-level `../CLAUDE.md` still binds (buildless,
CDN-free, tokens only, pnp2 inside one adapter with a mock twin).

## Work in progress — read before anything else

`state/` holds one dated file per live thread of work. The procedure is the
**`project-state` skill** — read it at the start of any session in this repo. It
is not `xo-handoff` and `.xo-handoffs/`; don't cross-file them.

- **Read every file in `state/` before the first edit**, then ask: pick a thread
  up, or work on something else? Ask even if the user opened with a request.
- **Any session that changed anything updates its thread's file before
  reporting completion**, and commits it with the work.
- **Check `git log -3 -- state/` and re-read the file before editing it.** More
  than one session may be in this repo; a file that contradicts the user in chat
  is stale.
- **A finished thread's file is deleted** once what outlives it has been promoted.

## Hard rules

1. **Kind: page library.** Uses `dcsMountPart()` on purpose (host discovery,
   edit-mode placeholder, SPA re-mount). No Alpine, no four-artifact pattern —
   don't "upgrade" it.
2. **`due()` is cheap and silent.** At most two small GETs, never UI, never a
   write. Anything heavier belongs in `run()`.
3. **The slot stamp is written before the config fetch and `due()`.** A failing
   task — bad config included — waits for the next slot; it must never retry on
   every page load. No working storage → no automatic run.
4. **A visit in an already-checked slot makes no request.** The gate decides
   from the stamp plus the schedule cached from the last config load.
5. **Mock is opt-in only** (`file:` or `data-mock`). A live page never falls
   back to mock data or a sample config.
6. **No tenant URL in the repo.** The web part stub is generated per environment
   by `tools/sp/deploy.ps1` from `__TOKENS__`; the demo config is built at
   runtime from `resolved-env.json`.
7. **Dates from SharePoint:** compare only UTC values (`TimeLastModified`,
   `LastItemModifiedDate`). A list item's `Modified` is site-local with no zone.
   See `docs/00-overview.md` → Paid-for gotchas.
8. **Tasks are types, configs are instances.** Nothing list- or site-specific
   in a task script; it all comes from the instance's JSON.

## Layout

| Path | What it is |
| --- | --- |
| `admin-script-runner.js` / `.css` | The runner: registry, slot gate, panel |
| `admin-script-runner.webpart.html` | Stub template (`__TOKENS__`); deploy generates the real one |
| `tasks/<type>/<type>.js` | Task types. Deployed flat beside the runner |
| `tasks/<type>/<type>.config.json` | Sample instance config |
| `app/` | sp-env harness ops (provision/verify/test-smoke/upload) + demo `loader.js` |
| `tools/sp/` | sp-env tooling (deploy, bootstrap-dev, run-harness, resolver) |
| `env.json` | sp-env manifest (logical names only) |
| `../dev/admin-script-runner.dev.html` | From-disk harness (mock adapter) |
| `docs/` | Durable reference. Start at `docs/README.md` |
| `tests/` | See `tests/README.md` |

## Where things go

- **Generated documents** go in `.scratch/` (gitignored), never committed.
  `.scratch/admin-autos.original.js` is the old per-site runner this replaced.
- **What's left to do** → `STATE.md` (rewritten); a live thread → `state/`.
- **What shipped** → `LOG.md` (appended).
- **No `.md` at this part's root** beyond README, CLAUDE, STATE and LOG.

## Tests

```
node --test admin-script-runner/tests/pure.test.mjs   # fast tier, ~0.3s
node admin-script-runner/tests/smoke.mjs              # full tier, ~41s
node admin-script-runner/tools/sp/run-harness.js test-smoke   # live dev tenant
```

---

Scaffolded from [projects-standard](https://github.com/whywhyjoe/projects-standard)
0.2.0, profile `sp-app` (layout adapted to bsp-sp-parts), plus the sp-env
project stamp. This file wins over both for this part.
