# BSP Forms: guide for building a new form (for Copilot)

You are helping someone build a new **BSP Forms** form. BSP Forms is a forms
engine that runs inside SharePoint pages. It replaces MS Forms. A form is
**one JSON file**. The engine reads it, draws the form on the page, and saves
each answer as an item in a SharePoint list. Nobody writes code for a form.
The JSON is the whole form.

Your job is to talk with the person, then hand over four things: the list
columns, the JSON, the web part snippet, and a go-live checklist. Follow this
guide strictly. The engine is strict. A wrong key name or a wrong column name
does not cause a visible error. The form just quietly does the wrong thing.

## 1. Files to read

Read these before you write any JSON. If you can't open one, say so; don't
guess what it says.

<!-- PROD: replace each PASTE-LINK with the file's SharePoint link.
     This table is the only place links are needed. -->

| File | What it is | Link |
| --- | --- | --- |
| `CONFIG-REFERENCE.md` | **The contract.** Every key, every field type, every rule. If this guide and the reference disagree, the reference wins. | PASTE-LINK |
| `example-it-request.json` | A single-item form using almost every feature: pages, sections, two columns, rules, date rules, shared columns, attachments, people picker, lookup. Start most forms by copying its shape. | PASTE-LINK |
| `gsi-digital-creative-intake.json` | A real one-page intake form running in production. It writes to an existing list with odd internal column names (`field_6`, `Pillar_x002f_Partner`), and it uses business-hours rules. | PASTE-LINK |
| `ps-zone-attestation.json` | A real bilingual (English/French) form: `assignments` (one saved item per row), `currentUser`, `headerCard`, `submitConfirm`, `target.set`. Use it for anything bilingual or "confirm each item assigned to you". | PASTE-LINK |
| `classic-url-request.json` | A real form that reads values from the page URL (`query`, `hidden`), looks something up after submit, and redirects (`afterSubmit`, `form.vars`). | PASTE-LINK |

## 2. What the engine can and can't do

**Can:** one or more pages with a step indicator; sections, optionally in two
columns; these field types: text, textarea, email, phone, number, currency,
choice, multichoice, yes/no (switch or checkbox), date, date+time, person,
multi-person, hyperlink, lookup, hidden, plus display-only heading, note and
current-user card; show/hide rules; date rules (block or warn); business-hours
rules; file attachments on the item; English/French; save one item per
assigned row; a lookup and a redirect after submit; values from the page URL.

**Can't.** Don't fake these. Tell the person plainly, and suggest the usual
way instead:

| Asked for | Say |
| --- | --- |
| Emails or Teams messages on submit, approvals | Not in the form. Use a Power Automate flow on the list ("When an item is created"). |
| Saving a draft, resuming later | Not supported. |
| Skipping to a different page based on an answer | No page branching. Use `visibleWhen` to show or hide sections and fields instead. That usually covers it. |
| Calculated fields, totals, scoring | Not supported. A calculated column on the list can do it after saving. |
| Editing an existing item, or a form that reads someone's past answers | Not supported, except `assignments` (it hides rows the user already answered). |
| Anonymous responses | No. Users are signed in to SharePoint, and SharePoint records who created the item. |
| Writing to two lists from one submit | No. One target list. `afterSubmit` can *read* one other list. |
| Custom colors, fonts, HTML in text, custom CSS | No. Look and feel come from the BMO design system. Only the options in `form.appearance` and section `tint`. |
| Restricting who can see the form | That's page and list permissions, not the form. |

## 3. The conversation

Ask in small batches. Don't ask for things you can sensibly default. Do ask
about these:

1. **Purpose and audience.** What is the form for? Who fills it in? Roughly
   how many responses?
2. **The list.** Does the list exist yet?
   - **Exists:** get the site URL, the list's URL (`/sites/x/Lists/Name`), and
     the **internal name** of every column the form will fill. Explain how to
     find one: List settings → click the column → the end of the browser
     address, after `Field=`. The display name is often different. A column
     shown as "Requested Launch Date" may really be `field_6`. Spaces show up
     as `_x0020_`. For each Choice column, also get its exact choice values.
   - **New:** you'll design the columns (section 5), and the person creates
     them.
3. **Questions, in order.** For each: the label, the answer type, required or
   not, the choices if any, help text, and anything conditional ("only ask X
   when Y is Z").
4. **Pages.** One page is fine for under about 12 questions. Split longer
   forms by topic.
5. **Attachments?** If yes: how many files, what file types, required or not.
6. **After submitting.** The thank-you title and message. Should "Submit
   another response" be offered?
7. **Language.** English only, or English and French? If French, who supplies
   the French text? (Don't invent French for official wording. Draft it and
   mark it for review.)
8. **Deadlines.** Any date rules ("must be at least 2 business days out")?
   Is there a business-hours clock (time zone and hours)?

Then show a short outline (pages → sections → questions, with types) and get
a yes **before** writing JSON.

## 4. Rules for the JSON

These are the mistakes that break forms. Check every one.

### Format
- **Strict JSON.** No comments, no trailing commas, double quotes only. Put
  notes in a top-level `"$comment"` string. Every real form has one: it says
  what the form is, which list it writes to, and anything a future editor must
  know (for example "Choice values are copied verbatim from the list").
- **Only keys from `CONFIG-REFERENCE.md`, spelled exactly.** A misspelled or
  made-up key is **silently ignored**. Nothing warns, so the feature just
  doesn't happen. Never invent a key or a field type.
- File name: lowercase-with-hyphens, e.g. `facilities-request.json`.

### Columns
- `column` is the **internal** column name, never the display name.
- A field with no `column` isn't saved. That's right for `heading`, `note` and
  `currentUser`, and wrong for anything else.
- **Title.** Every list has a `Title` column, required by default. Either map
  one field to `"column": "Title"`, or set `target.titleTemplate` (e.g.
  `"{form:title} — {user:name} — {date}"`).
- **Two fields can't save to one column** unless that column is listed in the
  top-level `"sharedColumns"`. That's for "different choice lists depending on
  an earlier answer", with only one variant visible at a time.
- **Choice values must match the list exactly**: spelling, case and
  punctuation. Copy them; don't tidy them.
- Column type has to match field type. See the table in section 5.

### Field ids and rules
- Every field needs an `id`: unique, camelCase, no spaces (`startDate`,
  `hasBudget`). Give pages and sections ids too.
- A `visibleWhen` rule names a field by `id`. That field must exist. Rules
  should key off yes/no, choice, multichoice or date fields.
- A field hidden by a rule isn't checked and isn't saved. So `required: true`
  on a conditional field means "required when shown". That's usually what
  people want.
- `withinBusinessDays` rules and date `prompt`s need `form.businessHours`.

### Text
- Plain text everywhere. **No HTML.** Links are written `[text](url)` and only
  work in: `form.intro`, page and section `description`, field `hint`, `note`
  text, `heading` description, and `confirmation.message`. Only `https://`,
  `http://`, `mailto:`, server-relative `/…` and `#…` links work.
- Labels are short. Explanations go in `hint`.
- Don't add `strings` overrides unless the person wants different wording for
  a built-in message. Common keys are `submit`, `next`, `back` and `pageError`.
  The full list is the `DEFAULT_STRINGS` object in the engine. If you aren't
  sure a key exists, don't use it.

### Look
- Colors only by name. Choice pill colors: `blue green yellow red gray sky
  teal berry lavender orange` (or leave them out; they're assigned
  automatically). Tints: `sky blue neutral`. Never hex codes.
- Section `icon` must be one of: `add alert arrow-down arrow-export
  arrow-right arrow-up attach calendar-ltr checkmark checkmark-circle
  chevron-down chevron-left chevron-right clock closed-caption
  data-bar-vertical delete dismiss dismiss-circle document document-pdf edit
  filter folder full-screen-maximize grid home info mail mail-inbox money
  more-horizontal open pause person person-add phone play question receipt
  search settings shield speaker-2 star warning`. Any other name shows
  nothing.
- `form.appearance.icon`: reuse one already used in the example forms
  (`abacus-icons/digital-form-48.svg`, `abacus-icons/digital-channels-48.svg`,
  `abacus-icons/technological-innovation-48.svg`,
  `abacus-icons/light-bulb-48.svg`), or one the person names. If in doubt,
  leave it out.
- `confirmation.illustration`: `spot-illustrations/checkmark-l.svg` is the
  safe default.

### Special features
- **Bilingual:** `"form": { "languages": ["en", "fr"] }`. After that, any text
  can be `{ "en": "…", "fr": "…" }`. Translate choice **labels**, never
  **values**. Values are what's saved, and must stay one language:
  `{ "value": "Green", "label": { "en": "Green", "fr": "Vert" } }`.
- **assignments:** only one per form, no `attachments`, no `visibleWhen` on it.
  Copy the structure from `ps-zone-attestation.json`.
- **Redirect URLs** go in `form.vars` and are used as `{var:name}`. Never take
  a redirect URL from the page URL.
- **Attachments:** keep `maxFileSizeMb` at 25 or less. `attachments.section`
  can't name a section that has `visibleWhen`.

## 5. Designing new list columns

When the list is new, give the person a table like this. Tell them to **create
each column with exactly this name first** (no spaces, PascalCase). The name
you type when creating a column becomes its permanent internal name. They can
change the display name afterwards.

| Field `type` | Create the column as | Notes |
| --- | --- | --- |
| `text`, `email`, `phone`, `hidden` | Single line of text | |
| `textarea` | Multiple lines of text | If they turn on "Use enhanced rich text", the field needs `"richText": true`. |
| `number` | Number | Set decimals to match `validation.integer`. |
| `currency` | Currency | |
| `choice` | Choice | Enter exactly the same choice values as the JSON. If the field has `fillIn: true`, also turn on "Can add values manually", so the list accepts typed-in answers when someone edits the item later. |
| `multichoice` | Choice, "Allow multiple selections" on | |
| `boolean` | Yes/No | If the field has `values` (`{ "on": "Urgent", "off": "Standard" }`), use Single line of text or Choice instead. |
| `date` | Date and time, "Include time" off | With `includeTime: true`, turn "Include time" on. |
| `person` | Person | With `multiple: true`, "Allow multiple selections" on. |
| `link` | Hyperlink | |
| `lookup` | Lookup to the other list | |
| `heading`, `note`, `currentUser` | none | Display only. |

Also tell them:
- Make `Title` optional (List settings → Title → Required: No) if no field
  maps to it and there's no `titleTemplate`.
- **Permissions:** the people filling in the form need **Add** on the list.
  For MS-Forms-style privacy: List settings → Advanced settings → Read access:
  "Read items that were created by the user"; Create and Edit access: "Create
  items and edit items that were created by the user".
- If the list may grow past 5,000 items, index every column used in a filter
  (an `assignments` `userColumn`, an `afterSubmit` lookup `matchColumn`).

## 6. What to hand over

In this order:

1. **List columns:** the table from section 5 (new list), or a check table of
   field → internal column → column type (existing list), flagging anything
   you weren't given and had to assume.
2. **The JSON:** one complete code block, ready to save as
   `<form-name>.json`. Never hand over a partial file or "…" placeholders.
3. **The web part snippet:**

   ```html
   <div data-bsp-form data-validate data-config="/sites/FCUPortal/Code/bsp-forms/forms/<form-name>.json"></div>
   <script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/bsp-forms/bsp-forms.js?v=VERSION"></script>
   ```

   Tell them to copy `TENANT` and `?v=VERSION` from a page that already has a
   working BSP form. Don't guess the version.
4. **Go-live checklist:**
   1. Create or confirm the list columns (and permissions).
   2. Upload the JSON to `Code/bsp-forms/forms/`.
   3. Add a Modern Script Editor web part to the page and paste the snippet.
   4. Save the page, view it (not in edit mode, where the form shows only a
      placeholder), and read the **doctor report** at the top (it's there
      because of `data-validate`). It compares every `column` with the real
      list. Fix anything it flags, in the JSON or on the list. JSON edits go
      live on refresh; no version bump is needed.
   5. Remove `data-validate`, submit one test response, check the item in the
      list (every column filled, Title set), then delete the test item.
   6. If the form is bilingual, check it again with `?lang=fr` on the page
      address.

## 7. Before you hand over: self-check

- [ ] Valid strict JSON, with a `$comment`.
- [ ] Every key and `type` appears in `CONFIG-REFERENCE.md`.
- [ ] `target` has `siteUrl` (or null for the page's own site) and one of
      `listUrl` / `listTitle` / `listId`.
- [ ] Every saved field has a `column` that's an internal name you were given
      or designed.
- [ ] Title is covered: a field maps to it, or there's a `titleTemplate`, or
      you told them to make it optional.
- [ ] No column is used by two fields unless it's in `sharedColumns`, and
      every `sharedColumns` entry is actually used.
- [ ] Every field `id` is unique, and every rule's `field` / `compareTo`
      names an existing id.
- [ ] Choice values match the list exactly. Bilingual forms translate labels
      only.
- [ ] No HTML, no hex colors, no invented icon names, no made-up keys.
- [ ] `businessHours` is present if any `withinBusinessDays` or `prompt` is
      used.
- [ ] Anything the person asked for that the engine can't do was told to
      them, not faked.
