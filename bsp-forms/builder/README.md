# BSP Forms builder

A web page for building a bsp-forms form against a real SharePoint list. You
pick the list, add controls, map each one to a column, and download two
files: the form JSON and the web part snippet that shows it. You upload and
paste those yourself; **the builder never writes to SharePoint**.

**Kind:** part of the `bsp-forms` page library (see the repo README's kinds
table). Page-library rules apply: buildless, CDN-free, its own boot (no
`dcsMountPart`, no four-artifact pattern). This README is its contract. The
build plan, with every decision, is [`../docs/BUILDER-PLAN.md`](../docs/BUILDER-PLAN.md).

## What it needs

- **Engine 0.6.0 or later**, loaded first on the same page. The builder:
  - validates with `BSPForms.normalize`: the exact check a form page runs;
  - reads lists and columns through `BSPForms.lists()`, which is read-only by
    construction;
  - loads its UI (design system CSS, icon sprite, Alpine) with
    `BSPForms.loadUi()`.
  
  Without the engine, or with an older one, it shows an error and stops.
- Read access to the lists you build forms for. The builder can read lists on
  any site you can open; type the site in the list picker.

## Deploy

```
Code/bsp-forms/
├─ bsp-forms.js / .css          the engine (0.6.0+)
├─ forms/*.json                 form configs (what the builder downloads)
└─ builder/
   ├─ bsp-forms-builder.js      the builder
   └─ bsp-forms-builder.css     its styles (loaded by the builder itself)
```

Make one page for it, e.g. `SitePages/bsp-forms-builder.aspx`, ideally with a
full-width section, and put [`builder.webpart.html`](builder.webpart.html) in
its custom-script web part. Bump both `?v=` stamps whenever either file
changes. The builder also has a **Full screen** button.

## Using it

1. **Pick the list.** Leave the site empty for this site, or type one, e.g.
   `/sites/FCUPortal`. The **List columns** card (select the form at the top
   of the outline) shows every column:
   - **Mappable:** its type and limits.
   - **Excluded, with the reason:** lookups, managed metadata, calculated and
     read-only columns, percent numbers, picture links, and columns whose REST
     name doesn't follow their internal name.
2. **Add controls** with **Add control** in a section: single-line text,
   multi-line text, number, yes/no, choice, multi-choice, date, person, URL,
   heading, note, current-user card.
3. **Map each value control to a column** under **Saves to**. Only compatible
   columns are offered. Mapping adapts the control to the column:
   - a required column makes the control required;
   - a Choice column's own choices are used (you pick which to show);
   - limits come from the column: text length, number range, date only, one
     or several people, rich text;
   - the column's default becomes the control's starting value.

   A control that only drives other questions can be marked **Not saved
   (logic only)**. Any other unmapped control is a problem.
4. **Lay it out.** Use pages, sections (one or two columns, icon,
   background), and drag or the ↑/↓ buttons to order pages, sections and
   controls.
5. **Add rules** (in the properties of the thing they apply to):
   - **Show when** — on a control, a section or a page. Conditions on
     earlier questions, joined by all or any. A page can only depend on
     earlier pages, and the first page always shows. A hidden control isn't
     checked or saved, and answers on a skipped page count as empty.
   - **End the form after this page when** — Submit replaces Next.
   - **Limit the choices** — on a choice: for each answer to an earlier
     Choice or Yes / No, tick which choices show. Picks that stop fitting are
     removed.
   - **Date rules** — not in the past; at least N business days ahead (whole
     days, Eastern, Mon–Fri, no holidays — it always comes with a blocking
     "weekdays only"); weekdays only; compared with an earlier date. Each one
     blocks or warns and has an optional message.

   Renaming a choice or a control updates every rule that uses it. Deleting
   a control is refused while a rule still uses it.
6. **Form settings** (select the form at the top of the outline):
   - look: card or plain frame, header band, tint, brand icon;
   - **"are you sure?"** before saving, with Yes / No buttons;
   - the success message, "Submit another", and an optional redirect to a
     page after N seconds;
   - **attachments**: at most 5 files of 10 MB each, on the list item. Only
     for a list with attachments on, and only in a section every answer path
     reaches.
7. **Preview** — the real form engine, beside the editor on a wide screen
   or in place of the properties on a narrow one:
   - It reloads a moment after each change.
   - People search and the signed-in user are live.
   - **Nothing is saved**: adds, attachments and people lookups are
     simulated, and a redirect is only described.
   - Submit it, then choose **What would be saved** to see the exact item
     it would send.
8. **Fix the problems.** The header shows the count, and the list says where
   each one comes from:
   - **Schema** problems are about the list: will the save work and store
     what the form shows? This includes "every path fills each required
     column", since SharePoint's API doesn't enforce Required.
   - **Engine** problems are what a form page would refuse to load.
   - Warnings, such as a unique or validated column, don't block the
     download.
9. **Download.** You get two files:
   - `<name>.json` — upload it to `Code/bsp-forms/forms/`.
   - `<name>.webpart.html` — paste it into the form page's custom-script web
     part. Leave `data-validate` on for the first load, check that every row
     is OK, then remove it.

Undo and redo are the ‹ › buttons, or Ctrl+Z and Ctrl+Y outside text boxes.
Every change is kept as a draft in this browser, and reopening the builder
offers to restore it.

## What it writes

The JSON is the engine's own config, in a fixed key order, plus `$builder`
keys the engine ignores:

- top level: `version`, the list (`siteUrl`, `listId`, `listTitle`, `listUrl`), `savedAt`;
- per control: `kind`, `logicOnly`.

The target is `target.siteUrl` plus the list's server-relative URL. That
survives a list rename, and it's read from SharePoint, never built, because
lists made in the UI can drop characters from their URL. `target.sendEmpty`
is always on, so a cleared field saves empty instead of the column's
default. `sharedColumns` is maintained by the builder: a column mapped by
two controls is declared, and nothing else is.

## Not yet

Coming in Phase 4 of the plan: opening an existing JSON (round-trip of the
forms in `forms/`). Rules nested deeper than one all/any group, or using
"not", are kept read-only, with a "Replace it" button.

Out of scope for v1: bilingual editing, lookup controls, URL-parameter
fields, assignments, prompts and locks.

## Developing

Serve the folder that holds both `bsp-sp-parts/` and `bsp-design-system/`:

```
python -m http.server 8000
http://localhost:8000/bsp-sp-parts/bsp-forms/builder/dev/builder.dev.html   (?fresh clears the draft)
node bsp-forms/dev/builder.spec.js      # the builder suite (mock tenant)
```

The mock tenant (`../dev/mock-sp.js`) has three lists. One of them, **BSPF
Builder Test**, mirrors the dev list of the same name column for column.
Live on dev: `dev/live/live-builder.ps1` deploys the builder and its page,
and `live-builder.js` drives it against the real list, downloads, publishes
and submits.

`BSPFormsBuilder.core` exposes the pure parts for tests and devtools:
`buildCatalog`, `applyColumn`, `computeIssues`, `serialize`, `refsTo`,
`renameRefs`, …
