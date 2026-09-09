# Copilot handoff — bsp-notify prod import
Date: 2026-08-31
Status: open

## Context

bsp-notify is the shared email-notification service for BSP parts: pages queue
an item on a `Notifications` SharePoint list via `bsp-notify.js`; the
**BSP Notify** Power Automate flow (recurrence, every 10 min, standard
connectors only) sends each item from a shared mailbox and stamps the item
`Sent`/`Failed`. Everything tenant-specific is an environment variable or an
import-time connection binding — nothing in the solution names any tenant.

Artifacts (in this repo):
- `packages/BspNotify_1.0.0.0.zip` — unmanaged solution: the flow, three
  connection references (SharePoint / Office 365 Outlook / Microsoft Teams),
  four environment variables (`bsp_BspNotifySiteUrl`, `bsp_BspNotifyListName`,
  `bsp_BspNotifySharedMailbox`, `bsp_BspNotifyTeamsErrorRecipient`).
- `env.json` — the Notifications list schema (identical on both tenants).
- `README.md` — the full contract (read the schema + flow-behavior sections).

## Prerequisites (before importing — corporate IT items)

- [ ] **Shared mailbox** exists on the prod tenant (IT provides; any address).
      The account whose connections you bind in step 3 must have **Send As**
      rights on it. This is the value for `bsp_BspNotifySharedMailbox`.
- [ ] The **Notifications list** exists on the target site with the exact
      schema in README.md / env.json (column names and types, including
      `NotifyStatus` choices Queued/Sending/Sent/Failed and defaults written
      by the wrapper). Provision it with the project's harness `provision` op
      (human-run on prod per the sneakernet pattern), or create it manually
      to match. Schema rule: **dev conforms to prod, never the reverse** — if
      prod forces a different shape, change env.json and re-test on dev.

## Requested actions

1. make.powerautomate.com (prod environment) → **Solutions → Import
   solution** → `packages/BspNotify_1.0.0.0.zip` → Next.
2. **Connections page:** bind the three connection references to prod
   connections of the same connector type (create them here if missing;
   consent prompts are normal on first use):
   - BSP Notify - SharePoint → SharePoint connection
   - BSP Notify - Office 365 Outlook → Office 365 Outlook connection
     (the account needs Send As on the shared mailbox)
   - BSP Notify - Microsoft Teams → Microsoft Teams connection
3. **Environment variables page:** fill prod values:
   - `BSP Notify Site URL` → the prod site URL that holds the list
   - `BSP Notify List Name` → `Notifications`
   - `BSP Notify Shared Mailbox` → the IT-provided shared mailbox address
   - `BSP Notify Teams Error Recipient` → joseph.zapert@bmo.com
4. Import → wait for the success banner. Open the flow **BSP Notify** →
   confirm it is **On**; turn it on if not. (If turning on fails, re-check
   the connection bindings in the solution's Connection references.)
5. **Verify closed-loop:** add a test item to the Notifications list (Title,
   Body, To = yourself, Source = `prod-import-test`, NotifyStatus = Queued,
   Attempts = 0). Within 10 minutes the item must flip to `Sent` with a
   `RunId`, and the email must arrive **from the shared mailbox**. Then
   report the outcome (including the RunId) back — do not assume.
6. If anything fails: the item goes `Failed` with error text in `Detail`, and
   the Teams Workflow bot messages the error recipient. An item stuck
   `Queued` > 30 min means the flow is not running (Off, or a dead
   connection) — see the staleness rule in README.md.

## Closing note

(Appended when done.)
