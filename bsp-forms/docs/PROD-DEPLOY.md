# BSP Forms — deploying to prod

The prod deploy is done by hand on the prod machine: `git pull` this repo, then
put files into the portal's `Code` library, either by uploading in the browser
or by copying into the OneDrive-synced folder for that library. Nothing under
`dev/`, `docs/`, `state/` or `webpart/` is ever deployed. (`copilot/` goes to a
separate reference folder for Copilot Chat, not to `Code`; see
[COPILOT.md](COPILOT.md).)

Sections: 1 engine updates, 2 zone attestation, 3 classic link request.

Paths below use the standard layout, `/sites/FCUPortal/Code/`. The engine finds
`bsp-design/` and `lib/` as siblings of its own folder, so `bsp-forms/` must sit
in the **same** library as those two. Use whatever path your existing
`bsp-design/` lives at.

## 1. Updating the engine (any form)

Do this whenever `bsp-forms.js` or `bsp-forms.css` changes on main. The engine
version is the `VERSION` line near the top of `bsp-forms.js` (now `0.6.0`).

1. Keep a copy of the deployed `bsp-forms.js` and `bsp-forms.css` (for
   rollback).
2. Upload both from `bsp-forms/` to `Code/bsp-forms/`, overwriting. If the
   folder doesn't exist yet, this is the first install: create it, plus
   `Code/bsp-forms/forms/` for the configs.
3. If any form on prod is bilingual (`form.languages`, e.g. the zone
   attestation), upload `bilingual/intl.js` to `Code/lib/`. It's harmless for
   the other forms; they never load it.
4. **Bump `?v=` on every page that embeds a form.** It's the `?v=…` at the end
   of the `bsp-forms.js` script URL in each page's web part snippet; use the
   engine version, e.g. `?v=0.6.0`. The same stamp cache-busts
   `bsp-forms.css`. A page left on its old `?v=` can keep running the cached
   old engine.
5. Open each form page once and check that it renders and that devtools shows
   no `[BSP Forms]` errors.

Config JSON files (`forms/*.json`) are fetched uncached, so editing one never
needs a `?v=` bump: it's live on the next page load.

**What 0.6.0 changes for existing forms:** what they save is unchanged (an
empty field is still left out unless a form opts into `target.sendEmpty`).
What they show changes in one way: an **optional** single choice, lookup,
date, number or link field now has a **×** to clear it, and choice menus start
with "Clear selection". Everything else in 0.6.0 is new config (branching,
`choicesWhen`, number dropdown/slider, business-day date rules,
`confirmation.redirect`, person `"@me"`) and the API the form builder uses —
see docs/CONFIG-REFERENCE.md. One config check got stricter: a date rule's
`op` must be a known one (a typo used to be ignored silently).

**What 0.5.0 changed for existing forms:** nothing in how they look or what
they save. Inputs (attachments included) are locked while a submit is saving.
The save sends the list's item type explicitly, which fixes a pnp cache clash
between same-titled lists on different sites. The doctor now accepts a Text
column for a yes/no field that saves words.

**Rollback:** put the saved copies back and set `?v=` back on the pages.

## 2. Installing the Physical Security Zones Attestation

Needs engine 0.5.0 or later (section 1) and `intl.js` in `Code/lib/`.

### a. The two lists (by hand), on `/teams/FCUWebDatastores`

Create each column with **exactly** this name first. The name you type
becomes the internal name the form uses. You can change the display name
afterwards.

**PS_Zone-Attestation-Assignments** (the lookup):

| Column | Type | Notes |
| --- | --- | --- |
| `UserEmail` | Single line of text | **Indexed.** The assignee's email, in any case. |
| `UserDescription` | Single line of text | Copied into each response. |
| `AreaName` | Single line of text | **Enforce unique values** (this indexes it). Shown as the row label. |

`Title` isn't used by the form. Make it optional (List settings → Title →
Required: No) or put the area name in it.

**PS_Zone-Attestation-Responses** (the save-back):

| Column | Type | Notes |
| --- | --- | --- |
| `LookupID` | Number, 0 decimals | The assignment item's ID. |
| `UserName` | Single line of text | |
| `UserEmail` | Single line of text | **Indexed.** |
| `UserDescription` | Single line of text | |
| `AreaName` | Single line of text | |
| `ZoneSelection` | Single line of text (or Choice) | Always the English value: Green / Yellow / Orange / Red. |
| `Attestation` | Single line of text | `Confirmed`. |
| `AttestationTime` | Date and Time, **include time** | Shown in the site's regional time zone. |

The form fills `Title` itself (`<area> — <email>`).

**Permissions:**

- Assignments: **Read** for everyone who takes the attestation.
- Responses: stop inheriting permissions. Give attesters a custom level with
  **View Items, Add Items, Open, View Pages**, and no Edit or Delete (dev
  calls it "View and Add"; Contribute without delete also works). Then in List
  settings → Advanced settings set **Read access: Read items that were
  created by the user** and **Create and Edit access: Create items and edit
  items that were created by the user**.
- Owners keep Full Control. Granting on the lists gives users Limited Access
  to the site automatically.

### b. The config

1. In `bsp-forms/forms/ps-zone-attestation.json`, set `form.vars.jobAidUrl`
   once the job aid exists. The card stays hidden while it's empty. You can
   also do this later in the deployed copy.
2. Upload it to `Code/bsp-forms/forms/`.
3. The icon and illustration it uses come from the design system:
   `bsp-design/abacus-icons/light-bulb-48.svg` and
   `bsp-design/spot-illustrations/shield-checkmark-xs.svg`. Check that both
   exist on prod; if not, the card icon and thank-you art show as broken
   images.

### c. The page (on `/sites/FCUPortal`)

Add a Modern Script Editor web part with this snippet. `TENANT` is the prod
tenant host; keep the path matching where `Code/` really is:

```html
<div data-bsp-form data-validate
     data-config="/sites/FCUPortal/Code/bsp-forms/forms/ps-zone-attestation.json"></div>
<script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/bsp-forms/bsp-forms.js?v=0.5.0"></script>
```

That's all the page needs: the engine loads the design system, Alpine, pnp
and `intl.js` itself.

### d. Check it

1. Publish and load the page as yourself. With `data-validate`, a
   *Form configuration check* table shows above the form. Every row should
   say **OK**: the Responses columns, the `target.set` and row columns, and
   the Assignments (source) columns. A **Problem** row names the column to
   fix.
2. Remove `data-validate` and republish.
3. Add a few assignment rows (one for yourself, one for a test user).
4. Sign in as an ordinary attester and submit. Check that one Responses item
   appears per area, with the zone, Attestation = `Confirmed` and the time.
   Reload: the page should say the attestation is already submitted.
5. French: add `?lang=fr` to the page URL. Language detection is still that
   placeholder (see `bilingual/README.md`), so French users get French only
   through `?lang=fr` until real detection lands in `intl.js`.

### Changing it later

- Wording, zone options, job aid link: edit the deployed JSON; it's live on
  refresh. Keep each zone's `value` in English and translate only `label`.
- A new attestation round: clear or archive the Responses list. Areas with a
  response for that user are treated as done and aren't shown again.

## 3. Installing the classic link request form

Needs engine 0.4.0 or later (section 1). No `intl.js`.

### a. The two lists (by hand), on `/sites/FCUPortal`

Create each column with **exactly** this name first, as in section 2. Both
lists live on `/sites/FCUPortal` even if the form page is elsewhere.

**Classic-URL-Requests** (the save):

| Column | Type | Notes |
| --- | --- | --- |
| `Link` | Single line of text, 255 | The old link. Longer links aren't truncated; they get the error screen. |
| `ResourceName` | Single line of text, 255 | |
| `SourceDescription` | Multiple lines of text, **plain text** | Where the user found the link. |

The form fills `Title` itself (`Classic link: <resource name>`).

**Classic-URL-Redirects** (the lookup):

| Column | Type | Notes |
| --- | --- | --- |
| `ResourceName` | Single line of text | Matched exactly against `?ResourceName=`. |
| `URL` | Hyperlink | The new link. |

**Permissions:** everyone who follows old links needs **Read** on
Classic-URL-Redirects and **Add** on Classic-URL-Requests. A failed save is
ignored on purpose, so missing Add rights fail silently. Check that this is set.

### b. The config

1. In `bsp-forms/forms/classic-url-request.json`, set
   `form.vars.converterUrl` to the SharePoint link converter's URL. While it's
   empty, the not-found and bad-link screens show their message but go
   nowhere. It must be `http(s)://…` or server-relative; anything else is
   refused. You can also set it later in the deployed copy.
2. Upload it to `Code/bsp-forms/forms/`.
3. Check that `bsp-design/abacus-icons/digital-channels-48.svg` exists on prod
   (the header icon).

### c. The page

Add a Modern Script Editor web part with:

```html
<div data-bsp-form data-validate
     data-config="/sites/FCUPortal/Code/bsp-forms/forms/classic-url-request.json"></div>
<script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/bsp-forms/bsp-forms.js?v=0.5.0"></script>
```

Whatever sends old links here must open the page as
`…/<page>.aspx?Link=<encoded old URL>&ResourceName=<encoded name>`.
`ResourceName` is optional; without it the user always gets the converter.

### d. Check it

1. Load the page with a test `?Link=…&ResourceName=…`. The *Form
   configuration check* table should be all **OK**, including both lists.
   Remove `data-validate` and republish.
2. Add one row to Classic-URL-Redirects and open the page with its
   `ResourceName`: submit should show the new link and add a request item.
3. Open it with an unknown `ResourceName`: the old link is copied and the
   countdown goes to the converter.
4. Open it with no `?Link=`: it skips the form and goes to the converter.

### Changing it later

Wording, the countdown (`form.vars.redirectSeconds`) and the converter URL:
edit the deployed JSON; it's live on refresh. New redirects are just new rows
in Classic-URL-Redirects.
