# State — GSI Digital Initiatives intake form (bsp-forms)

Last touched: 2026-10-05
Mode: Joe
Branch: bsp-forms-gsi-intake, pushed
State: config + engine 0.2.0 on the branch; dev-deployed and verified live, cross-site (34/34); prod untouched

## What this is

A bsp-forms config, `forms/gsi-digital-initiatives-intake.json`, that replaces
the built-in Microsoft Lists form ("FCU GSI Digital Initiatives Technology
Intake") on the prod intake list. That list is at
`/sites/FCUCommunicationsSecurityAwareness/Lists/Creative Services Intake`; the
user gave its display name as "Creative Digital Solutions Inake". The form is a
straight submit to that list, which is on a different site from the form page.
"Requested by" (column `field_6`, list display name "Requested Launch Date")
shows only when "Support type and level" (`Priority`) is one of the three
"Support…" choices or "Hard launch…".

## Done

- Mapping came from the user's private fiddle (`Jzapert1/74vj3qrk` v2, the
  built-in form's HTML plus the list's field JSON). The HTML keys inputs by
  internal name, and every column, type, required flag and choice value was
  checked against the JSON.
- The config targets the list by URL (`target.siteUrl` + `target.listUrl`), so
  the title typo doesn't matter.
- Engine 0.1.2 fixes the two live-page bugs (the AMD-hidden pnp load, and
  page-web resolution without `_spPageContextInfo`). 0.1.3 adds `richText` for
  textareas, used by Description.
- Engine 0.2.0 is the visual pass, all opt-in config, documented in
  docs/CONFIG-REFERENCE.md: section icon-tile heads (`icon`), two-column
  sections (`columns: 2`, field `span: "full"`, keyed to the form's own width
  by container queries), `[text](url)` links in prose, `target.listUrl`, and
  `attachments.section`. On a narrow form the brand icon stacks above the
  title.
- The GSI form now has three sections: About you (2 columns), Your request
  (2 columns, with "Requested by" appearing beside Support type), and Details
  (with the attachments). It has the Abacus technological-innovation brand icon
  and a linked intro.
- Tests: `dev/smoke.spec.js` passes (36 checks, including link safety,
  layout, and the attachments placement). On dev, `dev/live/live-submit.js`
  passes 34/34 with the page on the dev site and the list on the tenant root
  site (cross-site collection, as on prod). Screenshots were checked at desktop
  (1124px form) and phone (358px form) widths.
- Dev fixtures: the cross-site twin list at `/Lists/Creative Services Intake` on
  the dev tenant root site (created as that title, then renamed, like prod);
  the engine and config at `<code root>/bsp-forms/`; the page
  `SitePages/bsp-forms-gsi-intake-test.aspx` (with `data-validate`). **Unused
  now:** the first same-site test list `Creative Digital Solutions Intake` on
  the dev site (`Lists/CreativeServicesIntake`, about 5 test items). Delete it
  only if the user asks.

## Next

- [ ] Prod deploy, run by a human on the prod machine: upload `bsp-forms.js`,
      `bsp-forms.css` and the config to `Code/bsp-forms/` (the config goes in
      `forms/`). Make a page from `webpart/bsp-forms.webpart.html` with
      `data-config` pointed at the config, `?v=` bumped (engine is 0.2.0), and
      `data-validate` on for the first load. The doctor heading should read
      `Lists/Creative Services Intake` with every row OK. Then remove
      `data-validate`.
- [ ] Prod check: submit one test item, and confirm it lands in the list with
      the Requestor resolved, since `ensureUser` runs on the list's site
      collection.

## Open questions (for the user)

- The list's `Priority` default is `Standard`, which is not one of its choices.
  The form ignores it. Clean it up on the list?

## Companion documents

- `forms/creative-digital-solutions-intake.json`: an earlier draft for the
  same list, with placeholder choices and column names the list doesn't have.
  **Kept at the user's request (2026-10-05).** It is not deployed and is not
  the live form. Don't delete it.

## Landmines

- If a `Priority` choice is renamed on the list, update the choice entry **and**
  the `requestedBy` `visibleWhen` list. The four values are spelled out.
- The list's `----`/`-----` divider choices are left out on purpose.
- `dev/live/live-setup.ps1` swaps the config's prod `siteUrl` for `/` on
  upload. If the config's `siteUrl` line changes, that script throws until it
  is updated.
- On dev, `Add-PnPPageWebPart -Component <SEWP guid>` saves an empty web part.
  Make pages by copying `_app-template.aspx`, as `dev/live/live-page.ps1` does.
- The fiddle includes the user's corporate name and email. Never commit fiddle
  content.
