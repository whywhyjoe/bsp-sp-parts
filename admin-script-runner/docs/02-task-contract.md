# The task contract

A task **type** is one script that registers itself; a task **instance** is a web
part host plus a JSON config. One type serves any number of lists and sites.

## Registering

```js
(window.adminScriptTasks = window.adminScriptTasks || []).push({
  type: 'my-task',                  // matches data-admin-task="my-task"
  label: 'Tidy vacation titles',    // panel label unless config.label overrides
  mockConfig: { … },                // used only in mock mode when no config loads
  due: function (ctx) { … },        // → boolean | Promise<boolean>
  run: function (ctx) { … }         // → any | Promise<any> (the result is logged)
});
```

Either load order works: the runner drains whatever was pushed before it
loaded and registers later pushes immediately. A host whose type has not
registered yet waits for it; if it still has not registered 10 s later, that is
logged as an error. (The stub loads tasks before the runner anyway.)

## What `ctx` gives a task

| Member | In `due` | In `run` | Meaning |
| --- | --- | --- | --- |
| `config` | ✓ | ✓ | The instance's JSON, untouched. Validate it yourself. |
| `mock` | ✓ | ✓ | `true` from disk (`file:`) or with `data-mock` on the host. Use your mock adapter. |
| `slotStart` | ✓ | ✓ | `Date` the current slot began; `null` when forced. |
| `force` | ✓ | ✓ | `?adminTasks=force` (then `due` is not called at all). |
| `host` | ✓ | ✓ | The instance's host element. Don't render into it. |
| `log(...)` | ✓ | ✓ | Prefixed `console.log`. |
| `setStatus(text)` | no-op | ✓ | The panel's status line. Short, present tense. |
| `setProgress(0..1 \| null)` | no-op | ✓ | This task's share of the bar; `null` = indeterminate. |
| `throwIfCancelled()` | — | ✓ | Call between steps; throws a cancellation the runner handles. |
| `isCancelled()` | — | ✓ | For tasks that need to clean up before stopping. |

## Rules for `due(ctx)`

- **Cheap:** at most a couple of small GETs. It runs on real page loads.
- **Silent:** no UI, no writes. Throwing is fine — the runner logs it, records
  `error` in `status()`, and the slot stamp (written before the config fetch)
  stops a retry until the next slot.
- **Permission-aware:** return `false` for a visitor who could not complete
  `run()`. Otherwise read-only visitors get an error panel.
- **Compare UTC only** (see Paid-for gotchas in `00-overview.md`).

## Rules for `run(ctx)`

- Call `throwIfCancelled()` before each step that writes. A write already in
  flight completes; say so in docs if that matters for your task.
- Throw an `Error` whose message leads with the step and the SharePoint fact —
  it is shown verbatim in the panel, e.g. `saving intake.md: [403] Access denied`.
- Keep SharePoint calls in one live adapter object with a mock twin of the same
  shape (repo rule), so the dev harness exercises the whole task from disk.

## Adding a type

1. `tasks/<type>/<type>.js` (+ a sample `<type>.config.json`).
2. The deploy picks up every `tasks/**/*.js` automatically (flat).
3. Add its `<script>` tag to `admin-script-runner.webpart.html`, before the
   runner's tag.
4. Pure logic exported on `window.<name>._pure` gets fast-tier tests in
   `tests/pure.test.mjs`; add a doc here and an index row.
