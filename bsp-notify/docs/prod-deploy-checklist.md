# bsp-notify — prod deploy checklist

The full, ordered procedure for putting bsp-notify on the prod tenant. A human
runs it; prod has no `pac`, no PnP PowerShell and no git push. The dated
tickets in `copilot-handoffs/` track individual imports.

Do the steps in order. The list must exist before the flow is turned on, or
every run fails and alerts.

No tenant URLs or addresses go in the repo. They live in `env.local.json`
(gitignored) and in the solution's environment variables.

## 1. Prerequisites

- [ ] IT has created a **shared mailbox**. The account that will own the
      flow's connections has **Send As** on it.
- [ ] That account can create SharePoint, Office 365 Outlook and Teams
      connections in the prod Power Platform environment.
- [ ] The target site has the Script Editor web part, and its code library
      syncs to this machine through OneDrive.

## 2. Machine setup (once per machine)

- [ ] `git pull`
- [ ] Copy `env.local.example.json` to `env.local.json`. Set `"env": "prod"`
      and fill in `siteUrl`, `roots` and `mirrors`.

## 3. Deploy the site files

- [ ] Run `pwsh -File tools/sp/deploy.ps1`. It copies `app/`, `bsp-notify.js`
      and a fresh `resolved-env.json` into the OneDrive mirror.
- [ ] Wait for OneDrive to sync. Confirm `bsp-notify.js` is in the library.

## 4. Harness page (once per site)

- [ ] Create the modern page `SitePages/_app-template.aspx`. Add a Script
      Editor web part containing `app/sewp-snippet.html`, token left as is.
- [ ] Copy that page to `SitePages/_harness-bsp-notify.aspx`. Replace
      `__SP_ENV_SCRIPT__` with the URL of the deployed `harness.js` (the
      `scripts` library URL in `resolved-env.json`, plus `/harness.js`).

## 5. Create the lists

- [ ] Open the harness page and click **run provision.js**. It creates
      `Notifications` and `TestRuns` from `env.json`.
- [ ] Click **run verify.js**. It must report zero drift.

If prod forces a different list shape, stop. Change `env.json`, re-test on dev,
then start again. Dev conforms to prod, never the reverse.

## 6. Import the flow

In make.powerautomate.com, in the prod environment:

- [ ] **Solutions → Import solution** → `packages/BspNotify_<version>.zip`.
- [ ] **Connections page.** Bind each reference to a connection of the same
      type, creating it if missing:
  - BSP Notify - SharePoint
  - BSP Notify - Office 365 Outlook (the account with Send As)
  - BSP Notify - Microsoft Teams
- [ ] **Environment variables page.** Fill in:
  - `BSP Notify Site URL` — the site that holds the list
  - `BSP Notify List Name` — `Notifications`
  - `BSP Notify Shared Mailbox` — the shared mailbox address
  - `BSP Notify Teams Error Recipient` — who gets failure alerts
- [ ] Import, and wait for the success banner.
- [ ] Open the flow **BSP Notify** and confirm it is **On**. If it will not
      turn on, re-check the solution's connection references.

## 7. Verify end to end

- [ ] On the harness page click **run test-smoke.js**. It queues a real email
      to you through `window.bspNotify`. It must pass.
- [ ] Within 10 minutes the item in `Notifications` flips to `Sent` and gets a
      `RunId`.
- [ ] The email arrives, **from the shared mailbox**.

If it fails:

| Symptom | Meaning |
| --- | --- |
| Item is `Failed` | The send failed. The error is in `Detail`, and the Teams bot has messaged the error recipient. |
| Item is `Queued` for over 30 minutes | The flow is not running: it is Off, or a connection is dead. |
| Item is stuck on `Sending` | A run crashed mid-send. Check the run named in `RunId` before re-queuing, so nothing sends twice. |

## 8. Report back

- [ ] Click **copy results JSON** on the harness page. Send it, with the
      `RunId`, over the JSFiddle bridge.
- [ ] On dev: set `prod-build` and `solution-prod` in `VERSION`, and close the
      handoff in `copilot-handoffs/`.

## Later updates

| Change | Do |
| --- | --- |
| Wrapper (`bsp-notify.js`) only | Steps 3 and 7 |
| Flow (new solution version) | Steps 6 to 8. Re-check both wizard pages, and that the flow is still On |
| List schema | Step 3, then steps 5 and 7 |
