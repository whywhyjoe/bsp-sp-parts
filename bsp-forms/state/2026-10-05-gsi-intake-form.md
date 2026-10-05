# State — GSI Digital Initiatives intake form (bsp-forms)

Last touched: 2026-10-05
Mode: Joe
Branch: bsp-forms-gsi-intake, pushed
State: config + engine 0.1.2 on the branch; dev-deployed and verified live (28/28); prod untouched

## What this is

A bsp-forms config, `forms/gsi-digital-initiatives-intake.json`, that replaces
the built-in Microsoft Lists form ("FCU GSI Digital Initiatives Technology
Intake") on the prod Creative Digital Solutions intake list. It is a straight
submit to that list. "Requested by" (column `field_6`, list display name
"Requested Launch Date") shows only when "Support type and level" (`Priority`)
is one of the three "Support…" choices or "Hard launch…".

## Done

- Mapping came from the user's private fiddle (`Jzapert1/74vj3qrk` v2, the
  built-in form's HTML plus the list's field JSON). The HTML keys inputs by
  internal name (`data-automationid="clientFormField-<InternalName>"`), so no
  display-name map was needed. Every column, type, required flag and choice
  value in the config was checked against that JSON.
- Engine 0.1.2 has two fixes found on the first live run: the AMD-hidden pnp
  load, and page-web resolution over REST when `_spPageContextInfo` is missing
  (see CLAUDE.md, Paid-for gotchas). The regression suite `dev/smoke.spec.js`
  passes.
- Dev: the test list `Creative Digital Solutions Intake` (form columns only),
  the engine and config at `<code root>/bsp-forms/`, and the page
  `SitePages/bsp-forms-gsi-intake-test.aspx` (built with `data-validate`).
  The doctor reports all rows OK. `dev/live/live-submit.js` passes 28/28: the
  conditional on all 7 choices, the past-date block, people resolution,
  multichoice, attachments, Title from `titleTemplate`, and a hidden `field_6`
  not submitted. That last item saves even though `field_6` is list-required,
  because REST `items.add` does not enforce required columns.
- The dev test list holds about 3 test items. Two broken copies of the test
  page are in the dev recycle bin.

## Next

- [ ] User: answer the open questions below. Then set `target.listTitle` and
      `target.siteUrl` in the config.
- [ ] Prod deploy, run by a human on the prod machine: upload `bsp-forms.js`,
      `bsp-forms.css` and the config to `Code/bsp-forms/` (`forms/` subfolder
      for the JSON). Make a page from `webpart/bsp-forms.webpart.html` with
      `data-config` pointed at the config, `?v=` bumped, and `data-validate` on
      for the first load. Read the doctor, then remove `data-validate`.
- [ ] After prod is live, delete `forms/creative-digital-solutions-intake.json`
      (see Companion documents) if the user agrees.

## Open questions (for the user)

- What is the prod list's display **title**? The config guesses `Creative
  Digital Solutions Intake`. The list URL segment is `Creative Services
  Intake`, which may be the original name. The doctor names it on first load.
- Is the list on a **different site** from the form page? The built-in form's
  logo URL points at a security-awareness comms site, not FCUPortal. If so, set
  `target.siteUrl` to that site's server-relative URL.
- `field_9` (Description) is a **rich-text** column. The form writes plain
  text, so line breaks will collapse when the item is viewed in the list. If
  that matters, add an engine option that escapes the text and turns newlines
  into `<br>`. It has not been built.
- The intro shows the GSI intake address as plain text, because `form.intro`
  is escaped and links are not supported. Should it become a link (an engine
  change)?
- The list's `Priority` default is `Standard`, which is not one of its choices.
  The form ignores it, since the field is required with no default. Clean it
  up on the list?

## Companion documents

- `forms/creative-digital-solutions-intake.json`: **superseded** by
  `forms/gsi-digital-initiatives-intake.json`. It is an earlier draft for the
  same list, with placeholder choices and column names the list doesn't have.
  Delete it once the user confirms.

## Landmines

- If a `Priority` choice is renamed on the list, update the choice entry **and**
  the `requestedBy` `visibleWhen` list. The rule engine has no "contains"
  operator, so the four values are spelled out.
- The list's `----`/`-----` divider choices are left out of the config on
  purpose. They are real choice values, not separators.
- On dev, `Add-PnPPageWebPart -Component <SEWP guid>` saves an empty web part
  (null `webPartId`). Make pages by copying `_app-template.aspx`, as
  `dev/live/live-page.ps1` does.
- The fiddle includes the user's corporate name and email. Never commit fiddle
  content.
