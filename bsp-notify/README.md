# bsp-notify — shared email-notification service for BSP parts

Last update: 2026-08-31

A **tenant service**: pages don't include it as UI; other parts call it. Parts
that need to send email (e.g. `bsp-forms`) queue one item on a SharePoint
list via `window.bspNotify(...)`; a Power Automate flow (**"BSP Notify"**,
standard connectors only) polls the list on a clock and sends the email from a
shared mailbox. Callers never know the transport — the flow could be replaced
without touching any caller.

This file is the CONTRACT. If the wrapper, the list, or the flow changes
behavior, this file changes with it.

## Why this design (decided; don't relitigate)

Prod has no Graph access and no Entra app registrations.
`SP.Utilities.Utility.SendEmail` was rejected (fixed no-reply sender,
internal-only recipients, unreliable CC). HTTP-trigger flows were rejected
(premium licensing, exposed endpoint, downtime = lost notifications).
Item-created triggers were rejected (observed to die silently; trigger
conditions suppress runs invisibly). The **queue list + recurrence flow**
converts flow downtime into latency instead of data loss: every run drains the
whole backlog regardless of when items arrived.

## Caller API (the wrapper)

`bsp-notify.js` is a page library (no boot contract, no Alpine, no UI). The
page must load the self-hosted pnpjs v2 bundle (`window.pnp2`) — the wrapper
waits up to 10 s for it.

```js
window.bspNotify({
  subject: 'DCS intake received',        // required → Title (email subject)
  body:    '<p>HTML allowed</p>',        // required → Body (sent as HTML)
  to:      'a@x.com' | ['a@x.com', …],   // required → To (external OK)
  source:  'bsp-forms/intake',           // required → Source (calling app)
  cc:      …,                            // optional, same shapes as `to`
  bcc:     …,                            // optional
  from:    'shared-mb@…',                // optional; MUST be a shared mailbox
                                         // when given; blank ⇒ the flow's
                                         // configured default shared mailbox
  type:    'DCS intake notice'           // optional → NotifyType (reason)
}).then(r => { /* r.id = queue item id, r.mock = false */ });
```

- Addresses are validated and normalized to semicolon-joined strings; a bad
  address **rejects** the promise before anything is written.
- Delivery is **asynchronous**: a resolved promise means *queued*, not *sent*.
  Expect **0–10 minutes** latency (the flow's recurrence interval), plus
  Exchange delivery time.
- Mock mode is **opt-in only**: `file:` protocol, or
  `window.BSP_NOTIFY_SETTINGS = { mock: true }`. Mock records the exact
  would-be item into `window.bspNotify.mockQueue` and resolves `{mock:true}`.
  On a live page a missing `pnp2` is a hard rejection with a console error —
  never a silent fallback.
- Overrides: `BSP_NOTIFY_SETTINGS.listTitle` (default `Notifications`),
  `.webUrl` (default: page context, falling back to pnp2's default).

## Notifications list schema

Provisioned from [env.json](env.json) (single manifest for both tenants;
dev conforms to prod, never the reverse).

| Column | Type | Meaning |
| --- | --- | --- |
| `Title` | Text | Email subject |
| `Body` | Note | Email body, HTML allowed |
| `To` | Note | Semicolon-separated addresses (external allowed) |
| `From` | Text | Optional; always a shared mailbox when present; blank ⇒ flow default |
| `CC` / `BCC` | Note | Optional, semicolon-separated |
| `NotifyStatus` | Choice | `Queued` / `Sending` / `Sent` / `Failed` (wrapper writes `Queued`) |
| `StatusTime` | DateTime | Stamped on every status change |
| `Attempts` | Number | Send attempts so far (wrapper writes 0) |
| `Source` | Text | Calling app, e.g. `bsp-forms/intake` |
| `NotifyType` | Text | Reason for sending, e.g. `DCS intake notice` (`Type` is a reserved SP field name) |
| `RunId` | Text | Flow run that claimed the item |
| `Detail` | Note | Written ONCE at terminal state only (error text on Failed) — the flow run history (reachable via RunId) is the diagnostic trail, never this column |

## Flow behavior ("BSP Notify", identical name on both tenants)

- **Trigger:** Recurrence every 10 minutes, concurrency 1 (runs never overlap
  — double-sending is the one unacceptable failure mode).
- **Fetch:** `NotifyStatus eq 'Queued'` plus `Failed and Attempts lt 3`,
  oldest first, top 25. An empty result means the run does nothing more (a
  foreach over zero items) — an idle run costs ~3 actions, ≈20% of a
  6,000/day seeded-license budget at this cadence.
- **Per item, sequentially:** claim **before** send (`Sending` + `RunId` +
  `StatusTime`), then **"Send an email from a shared mailbox (V2)"** (real
  reply-able sender; To/CC/BCC; HTML body; From = item `From` or the
  `bsp_BspNotifySharedMailbox` environment variable), then resolve
  (`Sent`, or `Failed` + `Detail`; `StatusTime`; `Attempts`+1). Two list
  writes per email.
- **Crash semantics:** a mid-run crash leaves a visibly stuck `Sending` item
  — never a resend candidate. Stuck `Sending` items are NOT retried
  automatically; investigate the run named in `RunId`, then re-queue manually
  if the email truly didn't go out.
- **Retry:** a `Failed` item is retried on later runs until `Attempts` = 3,
  then left `Failed` for a human.
- **On any error:** the Workflow bot sends a Teams chat message to the
  address in the `bsp_BspNotifyTeamsErrorRecipient` environment variable —
  per failed item, and once more at run level. A run containing any failed
  send is itself marked Failed (verified live): maximum visibility in run
  history, and the item-level retry is unaffected — remaining items in the
  same run still get processed first.
- **Configuration** is 100% solution environment variables (`bsp_` prefix):
  `BspNotifySiteUrl`, `BspNotifyListName`, `BspNotifySharedMailbox`,
  `BspNotifyTeamsErrorRecipient`. No tenant URLs live in the flow or repo.

### Staleness rule

**Any item `Queued` for more than 30 minutes ⇒ the flow is dead.** Check, in
order: the flow is On (maker portal → Solutions → BSP Notify); its
connections are healthy (Connection references — expired credentials show
here); the run history for failures. Flow downtime is latency, not data loss:
once it's back On, the next run drains the backlog.

## Repo layout

| Path | What |
| --- | --- |
| `bsp-notify.js` | The wrapper (deployed once per site; also copied into the harness library by deploy.ps1 so the smoke test exercises it) |
| `env.json` | Manifest: Notifications list schema + harness pages (sneakernet scaffold format) |
| `solution/` | The **BspNotify** Dataverse solution in packed layout: flow definition, connection references, environment variables |
| `packages/BspNotify_<v>.zip` | The importable solution artifact (built by `tools/sp/pp-pack.ps1`) |
| `tools/sp/` | provision/verify/deploy/harness tooling (scaffold) + `pp-pack.ps1`, `pp-make-settings.ps1`, `pp-import-dev.ps1`, `pp-export.ps1` |
| `app/` | Harness ops; `test-smoke.js` queues a REAL item through `window.bspNotify` on the live harness page |
| `docs/` | Runbook notes + prod handoff checklist |

## Verifying a change (dev, closed loop)

1. `pwsh -File tools/sp/deploy.ps1` → wait for OneDrive sync.
2. `node tools/sp/run-harness.js verify` → zero drift.
3. `node tools/sp/run-harness.js test-smoke` → queues a live item to the
   signed-in user via the wrapper; confirm it flips to `Sent` with a `RunId`
   within ~10 minutes and the email arrives from the shared mailbox.

## Versioning

`VERSION` (repo-standard key=value) tracks the wrapper version and which
solution version is live on each tenant. Bump `version` + solution
`<Version>` together on flow changes; re-export with `tools/sp/pp-export.ps1`
after dev changes made in the portal.
