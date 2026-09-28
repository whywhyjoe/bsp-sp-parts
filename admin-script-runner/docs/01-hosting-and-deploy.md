# Hosting, boot and deploy

## Where it lives

One tenant-wide copy in the `code` root's `apps/admin-script-runner/` folder
(resolved per environment by sp-env; see `../env.json`). Pages on any site in
the tenant load it from there. Everything deploys **flat** into that folder:

| File | From |
| --- | --- |
| `admin-script-runner.js`, `.css` | part root |
| `dcs-part-boot.js` | `../_shared/` (a copy; identical re-loads are harmless) |
| `sp-list-to-markdown.js` (every task) | `tasks/<type>/` |
| `admin-script-runner.webpart.html` | **generated** from the part-root template |
| harness ops, `loader.js`, `resolved-env.json` | `app/` (dev/verification only) |

## Deploy

```
pwsh admin-script-runner/tools/sp/deploy.ps1                 # copy → OneDrive mirror
pwsh admin-script-runner/tools/sp/deploy.ps1 -DirectUpload   # dev: also upload + SHA256 parity
```

The deploy fills the stub template's tokens — `__ASR__`, `__PNP2__`,
`__DESIGN__`, `__VERSION__`, `__ENV__` — and refuses to write a stub with any
token left. **Bump `version=` in `../VERSION` on every runtime change:** it is
the `?v=` cache buster, and SharePoint serves library files with a 24-hour
cache. Pages keep the stub they were given, so a version bump needs the stub
re-pasted on each page (or the old `?v=` stays cached up to 24 hours).

Verify after a dev deploy (sp-env §0 — the agent does this, not a human):

```
node admin-script-runner/tools/sp/run-harness.js verify       # zero drift
node admin-script-runner/tools/sp/run-harness.js test-smoke   # live export + due() round trip
```

Prod: `deploy.ps1` (copy mode) on the prod machine; a human runs `verify.js` and
`test-smoke.js` from the harness page and pastes the results JSON back.

## Putting it on a page

Paste the **deployed** `admin-script-runner.webpart.html` into a Script Editor
web part and change only `data-config`. Several tasks on one page: repeat the
`<div data-admin-task>` line; keep the `<link>`/`<script>` tags once.

Literal `<script src>` tags in the Script Editor markup run early enough to
avoid the AMD trap. Anything that injects `pnp2.bundle.js` late (like the dev
demo `loader.js`) must hide `define.amd` while it loads — see sp-env.

## Boot

`dcsMountPart({ id: 'admin-script-runner', selector: '[data-admin-task]',
editMode: 'placeholder' })`. Hosts render nothing in view mode; in edit mode
authors see "Admin tasks — paused while you edit this page". After SharePoint
SPA navigation the new host is re-mounted and re-checked (the slot gate usually
skips it).

## "Nothing ran"

In order: is it before the first slot, or already checked this slot
(`adminScriptRunner.status()` says `skipped`)? Did `due()` say `not-due` (file
fresh, list unchanged, or no edit permission)? Is there an `error` entry (bad
config URL, missing `pnp2`, unknown task type)? `?adminTasks=force` bypasses the
slot gate and `due()` entirely.

## Dev verification pages (dev tenant only)

- `_harness-admin-script-runner.aspx` — sp-env harness (provision/verify/test-smoke).
- `admin-script-runner-demo.aspx` — `loader.js` injects the generated stub with a
  config built from `resolved-env.json`, exporting the `Intake Test` list to
  `ASR Test Output/asr-demo.md`.
