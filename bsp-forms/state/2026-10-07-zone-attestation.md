# State — Physical Security Zones Attestation (bsp-forms)

Last touched: 2026-10-07
Mode: Joe
Branch: `bsp-forms-zone-attestation`, merged to main 2026-10-07 (not pushed; the user asked
for commit + merge only)
State: engine 0.5.0 + `forms/ps-zone-attestation.json`; two Codex review rounds (xo turns 5, 6)
addressed; harness suite 139/139; dev-deployed **cross-site** (`?v=53`) and verified live 20/20
(EN + FR); GSI 35/35 and classic 15/15 live regressions pass; prod untouched

## What this is

A bilingual (EN/FR) form. Users confirm a physical security zone for each
area assigned to them, attest, and confirm.

- **Prod layout (user, 2026-10-07):** both lists on
  `bmo.sharepoint.com/teams/FCUWebDatastores`. The page runs on
  `/sites/FCUPortal`. The config sets `siteUrl: "/teams/FCUWebDatastores"` on
  `target` and `source`, and addresses both lists by title.
- **Lookup:** `PS_Zone-Attestation-Assignments` (ID, UserEmail, UserDescription,
  AreaName — unique). Filtered to the signed-in user's email or UPN, ignoring case.
- **Save-back:** `PS_Zone-Attestation-Responses`, one item per area: LookupID
  (= assignment ID), UserName, UserEmail, UserDescription, AreaName,
  ZoneSelection, Attestation (`Confirmed`), AttestationTime (`{now}`, one ISO
  instant per submit).
- UI follows the user's spec. Job aid URL in `form.vars.jobAidUrl` (the card
  is hidden while it's empty). The confirm dialog uses the user's wording.
- Zone **values** are saved in English whatever the language; only the labels
  are translated.

## Decisions (user, 2026-10-07)

- **Assignments list:** everyone gets read. Seeing other people's
  assignments is acceptable. No per-item permissions and no flow.
- **Responses list:** a custom **Add + View** permission level, no Edit (the
  fallback is Contribute without delete), plus "read only their own items".
  The form needs only those: it adds items, and reads the user's own items to
  skip areas already done.
- Placeholder copy (description, confirm-checkbox text) stays for now.

## Done

- Engine 0.5.0 adds these, all generic and documented in
  docs/CONFIG-REFERENCE.md: `form.languages` with `{en, fr}` pairs and
  `DEFAULT_STRINGS_FR`; live re-render on `intl.setLang()` that keeps state;
  `assignments` (source filter, `responses` skip, per-row save, partial-save
  retry, empty and allDone screens); `currentUser`; `form.headerCard`;
  `submitConfirm`; `target.set`; `{now}` and `{row:Col}`; choice `label`;
  section `tint`; doctor checks for all of these.
- **Bug fixed on the way (affects every form):** `addItem` now passes the
  list's item type to `items.add`. pnp v2's 5-day localStorage cache is keyed
  by relative URL, so same-titled lists on two webs collided tenant-wide, and
  the cross-site save 400'd. Recorded in CLAUDE.md.
- **Codex review (xo turns 5 → 6), fixed:**
  - Answers freeze at Confirm. Payloads come from `store.snap`, a
    `fieldset.bspf__lock` is disabled while busy, and the pickers and file
    add/drop/remove have `busy` guards. That last one also protects the GSI
    forms' attachments.
  - A failed save marks the rows uncertain. The retry first asks the list
    about exactly the unsaved rows (`getRowKeysFor`, no read cap) and skips
    any already there. Verified live against the real list.
  - The 500-row source and 5,000-key reads report a cut-off (warning) instead
    of failing silently, and never claim "already submitted" on a cut-off read.
  - Error copy says "confirmed saved" and never promises "nothing was saved"
    for rows.
- **Accepted limits (documented, not built):** if the first `source.top`
  rows are all answered, later rows can't be reached (raise `top`). The same
  person submitting from two tabs at the same moment can duplicate; only a
  uniqueness rule would stop it, and that would block re-running the
  attestation.
- Fixed a time-of-day bug in `dev/live/live-submit.js` (`ymd()` used the UTC
  date, so it failed after 8pm Eastern).
- Dev fixtures: twin lists on the tenant **root** site
  (`dev/live/live-zone-lists.js`). The page is on the dev site,
  `SitePages/bsp-forms-zone-attestation-test.aspx` (`?v=53`, `data-validate`).
  `live-setup.ps1` swaps both `/teams/FCUWebDatastores` lines to `/` and fills
  in a stand-in job aid URL. The earlier same-titled lists on the dev site are
  kept **on purpose** as the regression fixture for the cache collision. Don't
  delete them.

## Next

- [ ] Push main when the user says so.
- [ ] Prod, done by a human:
  1. On `/teams/FCUWebDatastores`, create both lists. Columns are named
     exactly as above (create each column with that name first so the
     internal name matches). Index `UserEmail` on both; `LookupID` is Number;
     `AttestationTime` is Date and Time.
  2. Permissions: Assignments → read for all form users. Responses → break
     inheritance, give users the Add + View level, and in Advanced settings set
     Read access to "Read items that were created by the user".
  3. Upload `bsp-forms.js` and `bsp-forms.css` to `/sites/FCUPortal/Code/bsp-forms/`
     (bump `?v=`), the config to `…/bsp-forms/forms/`, and
     `bilingual/intl.js` to `/sites/FCUPortal/Code/lib/`.
  4. Set `form.vars.jobAidUrl` when the job aid exists (a JSON edit, live on
     refresh).
  5. Make the page from the web part snippet with `data-validate` for the
     first load. Every doctor row should read OK, both lists included. Then
     remove `data-validate`.
  6. Test with an ordinary (non-owner) account, which dev can't simulate. The
     form should load, submit, and on reload show "already submitted".
- [ ] Language detection: `intl.js` still uses the `?lang=fr` placeholder (see
      bilingual README). French users get French only via `?lang=fr` until the
      real SharePoint detection lands there.

## Landmines

- `live-setup.ps1` swaps the empty `"jobAidUrl": ""` and the two
  `/teams/FCUWebDatastores` lines. Once the real URL is in the repo config,
  or the site path changes, the script throws. Update it then.
- REST-created lists drop hyphens from the URL
  (`/Lists/PS_ZoneAttestationAssignments`). The form uses titles, so it
  doesn't care. Don't switch the config to `listUrl` without checking the
  real prod URLs.
- Responses on the dev root keep the live test's items (the user's own
  account). `live-zone.js` recycles them at the start of every run.
