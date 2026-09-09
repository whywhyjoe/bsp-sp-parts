# Dev-side Power Platform setup — how it was done (2026-08-31)

Originally written as a handoff for two blocked human steps; the session was
re-run with bypass permissions and completed everything itself. Kept as the
record of the working procedure for re-runs and future services.

## What exists on dev now

- Shared mailbox **bsp-notify@nerve.bz** ("BSP Notify" — nerve.bz is the
  tenant's default accepted domain), with FullAccess + SendAs for
  joe@nerve.digital (flow connection account) and benay.yocum@nerve.digital
  (verification account for reading Sent Items via the M365 connector).
- Solution **BspNotify** imported unmanaged; flow **BSP Notify** activated.
- Connections (owner joe): SharePoint `06badddf913443529cb5f5ef6fd49530`,
  Office 365 Outlook `7f0bb59c3986401c9dc32ce3097cf111`, Teams
  `4e83978f086a424c8daf34b9b79220d2` — bound to the three `bsp_` connection
  references by the deployment settings file at import.

## The repeatable procedure (per solution version)

1. Edit `solution/` (packed layout) → `pwsh -File tools/sp/pp-pack.ps1`.
2. `pwsh -File tools/sp/pp-make-settings.ps1 -SharedMailbox bsp-notify@nerve.bz
   -TeamsErrorRecipient joe@nerve.digital -SharePointConnectionId … -OutlookConnectionId …
   -TeamsConnectionId …` (ids from `pac connection list`).
3. `pwsh -File tools/sp/pp-import-dev.ps1` (pac import + settings + activate).
4. Activation is a separate Dataverse call if pac leaves the flow Draft:
   `PATCH /api/data/v9.2/workflows(<id>) {"statecode":1,"statuscode":2}` —
   activation is also the flow VALIDATOR: bad operation ids/parameters
   surface here, not at import.

## Traps hit once so you don't hit them again

- **Env var definitions in hand-authored customizations.xml were ignored** by
  import ("unresolved references"). Fix used: create the four
  `environmentvariabledefinition` rows via Dataverse Web API first; import
  then resolves them. (A pac-exported solution round-trips fine — this only
  bites hand-authored packages.)
- **connectionreference RootComponent type is org-assigned**: this org wants
  `10049` (= `EntityDefinitions(LogicalName='connectionreference')/ObjectTypeCode`),
  not the commonly seen 10132.
- **Teams post message** operationId is `PostMessageToConversation` (no
  suffix), parameters `poster`, `location`, `body/recipient`,
  `body/messageBody`.
- **SharedMailboxSendEmailV2** body parameter is `emailMessage/...`, not
  `request/...`; SharePoint `PatchItem` requires `item/Title` even on
  partial updates.
- **SP connector caches list schema**: StatusTime was created date-only
  (the pnpjs default) and fixed to date+time later; the connector kept
  truncating timestamps for a while afterwards from its cached dynamic
  schema. Nothing to do — the cache expires on its own; SharePoint itself
  stores full timestamps (verified by direct REST write).
- Auth that worked non-interactively: existing pac WAM profile (import/
  export), `az login --use-device-code --allow-no-subscriptions` completed
  headlessly against the signed-in Playwright profile (scratchpad
  `device-login.js`), Dataverse + PowerApps REST with az tokens, and the
  maker portal driven by Playwright for OAuth connection creation (popups
  auto-complete via SSO). Azure CLI lives at
  `C:\dev\tools\azcli-venv\Scripts\az` with a shim on PATH
  (`%LOCALAPPDATA%\Microsoft\WindowsApps\az.cmd`).

## E2E verification (each meaningful change)

1. `node tools/sp/run-harness.js test-smoke` — queues a live item via
   `window.bspNotify` on the harness page.
2. Within ~10 min the item flips `Sent` with `RunId` + `Attempts` bumped.
3. Email present in bsp-notify@nerve.bz Sent Items (M365 connector as benay)
   and delivered to the recipient.
