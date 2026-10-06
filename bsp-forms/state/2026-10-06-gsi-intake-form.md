# State — GSI intake forms (bsp-forms)

Last touched: 2026-10-06
Mode: Joe
Branch: bsp-forms-team-classic, pushed (not merged); earlier work merged to main 2026-10-06 (31eecdc)
State: two configs, engine 0.4.0; both dev-deployed and verified live cross-site; prod untouched

## What this is

Two bsp-forms configs that replace the two built-in Microsoft Lists forms on
the prod intake list, `/sites/FCUCommunicationsSecurityAwareness/Lists/Creative
Services Intake`. The user gave its display name as "Creative Digital Solutions
Inake"; the configs address it by URL, so the name doesn't matter. Both are
straight submits from a page on another site.

- `forms/gsi-digital-initiatives-intake.json`: "FCU GSI Digital Initiatives
  Technology Intake". "Requested by" (`field_6`) appears only for Support… /
  Hard launch… under Support type (`Priority`).
- `forms/gsi-digital-creative-intake.json`: "FCU GSI Digital & Creative
  Solutions Intake". No branching. Priority is a switch that saves
  `Urgent`/`Standard`. A launch date within one business day opens the user's
  prompt: OK keeps the date and marks the request urgent; "Change to 48 hours"
  moves the date to 2 business days out. Urgent stays locked while the date is
  in the window.

## Done

- Both forms take `?Team=` (2026-10-06): a hidden `team` field writes the
  `Team` column. The value is letters and digits only, lower case, at most 40
  characters (`FCU Comms/Sec Awareness` → `fcucommssecawareness`). The
  parameter name matches in any case. `Team` is a **Choice** column on prod
  (the user confirmed this); a free-text value is accepted. Verified live on
  both forms.

- Both mappings came from the user's fiddles (`Jzapert1/74vj3qrk` v2, with the
  field JSON; `Jzapert1/ztu4x5s9` v0, HTML only, the same list per its logo
  URL). Every column, type and choice value was checked against the field JSON.
- **Business-time rule, as the user defined it on 2026-10-06:** working hours
  are Mon–Fri 9:00–17:00 Eastern (America/Toronto), with no holidays (too hard
  to keep current). One business day = 8 working hours = the user's "24
  hours"; "48 hours" = 16 working hours. Any time outside hours counts as the
  last close (6pm Tue = 5pm Tue). The boundary is inclusive (9:00 the next
  morning is still within).
- **Defaults chosen by the agent, all one-line config changes; the user hasn't
  confirmed them:**
  - A date-only launch date means 5pm ET that day (`businessHours.dateAt:
    "end"`). That matches the user's Fri 5pm → Tue 5pm = 48 example. The
    alternative, `"start"` (9am), makes every next-day launch urgent and pushes
    the 48-hour date a day further out.
  - Urgent is locked while the date is in the window (`lockWhen`).
  - Translation Required is a Yes/No dropdown that can be left blank (a switch
    would always save Yes or No).
- Engine history: 0.1.2 live-page fixes; 0.1.3 `richText`; 0.2.0 layout,
  links, `listUrl`, `attachments.section`; 0.3.0 `form.businessHours`, the
  `withinBusinessDays` op, the date `prompt` (design-system `.dialog` as an
  alertdialog, with focus trap, Escape = OK, and a re-ask on submit if
  unanswered), boolean `values`, and `lockWhen`/`lockValue`/`lockNote`. All are
  documented in docs/CONFIG-REFERENCE.md.
- Tests: `dev/smoke.spec.js` has 47 checks and pins the clock with
  `page.clock`. On dev, `live-submit.js` passes 34/34 and `live-creative.js`
  25/25. The creative test pins the engine clock to Fri 5pm ET through the
  `BSPForms.clock` hook. REST accepted `Urgent` in a Choice column that doesn't
  list it, as the user said it would.
- Dev fixtures:
  - The twin list on the dev tenant root site (`/Lists/Creative Services
    Intake`, now with the Partners, field_7 and TranslationRequired columns too).
  - Both configs plus the engine at `<code root>/bsp-forms/`.
  - Pages `bsp-forms-gsi-intake-test.aspx` and `bsp-forms-gsi-creative-test.aspx`,
    both built with `data-validate`.
  - **Unused:** the old same-site test list on the dev site
    (`Lists/CreativeServicesIntake`). Delete it only if the user asks.

## Next

- [ ] User: confirm or change the three defaults above.
- [ ] Prod deploy, run by a human on the prod machine: upload `bsp-forms.js`,
      `bsp-forms.css` and both configs to `Code/bsp-forms/` (the configs go in
      `forms/`). Make one page per form from `webpart/bsp-forms.webpart.html`,
      bumping `?v=` (engine is 0.4.0). Turn on `data-validate` for the first
      load: the doctor should show every row OK, then remove the attribute.
      Submit one test item per form and confirm the Requestor and (for the
      creative form) Priority land.
- [ ] Later, by the user: add `Urgent`/`Standard` as real Priority choices on
      the list. Nothing in the form needs to change.

## Open questions (for the user)

- The list's `Priority` default is `Standard`, which is not one of its choices.
  It now matches what the creative form writes. Add `Standard` and `Urgent`
  as choices at the same time?

## Companion documents

- `forms/creative-digital-solutions-intake.json`: an earlier draft for the
  same list. **Kept at the user's request (2026-10-05).** It is not deployed.
  Don't delete it.

## Landmines

- Initiatives form: if a `Priority` choice is renamed, update the choice entry
  **and** the `requestedBy` `visibleWhen` list.
- Creative form: the prompt's `confirm.set` names `priority`, and Priority's
  `lockWhen` names `launchDate`. Renaming either field id breaks the pair; the
  config validator catches an unknown id.
- `dev/live/live-setup.ps1` swaps the prod `siteUrl` line in both configs on
  upload. If that line changes, the script throws.
- On dev, `Add-PnPPageWebPart -Component <SEWP guid>` saves an empty web part.
  Make pages with `dev/live/live-page.ps1`.
- The fiddles include the user's corporate name and email. Never commit
  fiddle content.
