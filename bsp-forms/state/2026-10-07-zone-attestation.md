# State — Physical Security Zones Attestation (bsp-forms)

Last touched: 2026-10-07
Mode: Joe
Branch: `bsp-forms-zone-attestation`, merged to main 2026-10-07 and pushed (main is the branch now)
State: engine 0.5.0 + `forms/ps-zone-attestation.json` on main; harness 139/139; live on
dev cross-site (`?v=53`): 20/20 admin, 24/24 as a non-admin; **prod untouched**

## What this is

A bilingual (EN/FR) bsp-forms form. Each user sees the areas assigned to them
(list `PS_Zone-Attestation-Assignments`, filtered by their email or UPN). They
pick a physical security zone per area from a clearable color-dot dropdown,
tick an attestation checkbox and confirm in a warning dialog. The form saves
one item per area to `PS_Zone-Attestation-Responses`. In prod both lists live
on `/teams/FCUWebDatastores`; the page runs on `/sites/FCUPortal`. Every piece
is a generic engine feature switched on by the JSON; none of it is
form-specific code (docs/CONFIG-REFERENCE.md has the options;
`forms/ps-zone-attestation.json` is the reference config for them).

## Decisions (user, 2026-10-07)

- Everyone gets read on Assignments. Seeing others' assignments is
  acceptable, so there are no per-item permissions and no flow.
- Responses: a custom Add + View level, no Edit (fallback: Contribute
  without delete), plus "read own items". The form needs no more.
- **No list manifest for this form.** The user creates both prod lists by
  hand from docs/PROD-DEPLOY.md. Don't add an `env.json`-style manifest unless
  asked.
- Placeholder copy (description, confirm-checkbox text) stays for now.
- Accepted limits, documented and not built: rows past the first
  `source.top` can't be reached if those are all answered (raise `top`), and
  the same person submitting from two tabs at once can duplicate (only a
  uniqueness rule would stop that, and it would block re-running the
  attestation).
- Adding `pnp.Web(url)` to the pnp2 rollup is optional. Do it at the next
  rebuild for another reason; the engine already prefers it when present. If
  it lands, re-run the live tests (that code path has never run against a
  real bundle).

## Done

- Engine 0.5.0 on main: features in docs/CONFIG-REFERENCE.md, review fixes
  and gotchas in bsp-forms/CLAUDE.md. Two Codex review rounds (xo turns 5, 6)
  are resolved; the last round's leftovers are the accepted limits above.
- Dev fixtures:
  - The twin lists are on the tenant **root** site
    (`dev/live/live-zone-lists.js`), with permissions copied from the user's
    hand setup on the dev site (`live-zone-perms.js`).
  - The page is `SitePages/bsp-forms-zone-attestation-test.aspx` on the dev
    site, with `data-validate`.
  - The non-admin test account is in PSZoneTestGroup and has three rows
    (`live-zone-lists.js --user <email>`).
  - Its Playwright profile is `<sp-env>/auth/pw-profile-nonadmin`, run with
    `live-zone.js --as pw-profile-nonadmin`.

## Next

- [ ] **Prod, by the user, following docs/PROD-DEPLOY.md.** bsp-forms has
      never been deployed to prod, so its section 1 is a first install. That
      also unblocks the GSI and classic-link forms' pending prod steps (their
      own state files). Then section 2: lists, config, page, doctor, and one
      submit as an ordinary attester.
- [ ] Set `form.vars.jobAidUrl` once the job aid exists. A JSON edit, live on
      refresh. Then update `dev/live/live-setup.ps1`'s swap (see Landmines).
- [ ] Language detection: `bilingual/intl.js` still uses the `?lang=fr`
      placeholder (bilingual README). French users get French only via
      `?lang=fr` until real SharePoint detection lands there.

## Companion documents

- `docs/PROD-DEPLOY.md`: **live**. The prod runbook for engine updates and
  this form's install. Keep it current with every engine release.

## Landmines

- **Keep the same-titled lists on the dev site.** They are the regression
  fixture for the pnp entity-type cache collision (CLAUDE.md). Don't delete
  them.
- The non-admin profile must be signed in with **"Stay signed in?" = Yes**.
  Otherwise SharePoint keeps only session cookies, and headless runs stop at
  "Pick an account". The user signs in again in a visible window; the agent
  never picks the account.
- `live-setup.ps1` swaps the empty `"jobAidUrl": ""` and the two
  `/teams/FCUWebDatastores` lines on upload. It throws once either changes in
  the repo config.
- REST-created lists drop hyphens from the URL
  (`/Lists/PS_ZoneAttestationAssignments`). The form uses titles; don't
  switch it to `listUrl` without checking the real prod URLs.
- Dev Responses keep the live tests' items. `live-zone.js` recycles the test
  user's items (as admin) at the start of every run.
