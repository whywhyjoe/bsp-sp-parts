# State — classic-link request form (bsp-forms)

Last touched: 2026-10-06
Mode: Joe
Branch: bsp-forms-team-classic, pushed (not merged)
State: config + engine 0.4.0 on the branch; dev-deployed and verified live (15/15); prod untouched; converter URL still empty

## What this is

`forms/classic-url-request.json`. People who follow an old (classic) FCU link
land on this form with `?Link=<encoded original URL>&ResourceName=<encoded
name, optional>`.

- The resource name is shown decoded and can't be edited. The Link is hidden.
- They describe where the link was (Source description, required) and press
  **Get new link**.
- The form saves the request to `/sites/FCUPortal` **Classic-URL-Requests**. A
  failed save is ignored silently, as the user asked.
- It then looks the ResourceName up in **Classic-URL-Redirects**. A hit shows
  the URL, linked with the resource name.
- No hit, or no ResourceName: the original link goes to the clipboard and a
  countdown sends the user to the SharePoint link converter.
- A missing or bad Link skips the form: a message, then the converter, without
  mentioning the clipboard.

## Done

- The user's answers (2026-10-06):
  - Both lists are on `/sites/FCUPortal`, though the form page may be on
    another site.
  - Source description is required.
  - No ResourceName means the converter path.
  - The converter URL and countdown live in the form JSON as generic named
    values (`form.vars`), not in the page URL. This was the agent's
    open-redirect concern.
  - Clipboard fallback: a Copy box, with the countdown paused.
  - Header: "The link you followed has changed." (the user's text had "you
    you").
- Engine 0.4.0 adds `hidden` fields, `query`/`normalize`, `readOnly` text,
  `form.vars` with `{var:}` tokens, `afterSubmit` (lookup through the existing
  adapter: `listOf` + `odataStr`), the found/notFound result screens with copy
  and redirect, and `queryError`. All are documented in
  docs/CONFIG-REFERENCE.md.
- There's no shared, deployed list library elsewhere in the BSP projects (an
  Explore agent checked), so the lookup lives in the bsp-forms adapter, the
  repo's one-adapter-per-tool rule.
- Tests: `dev/smoke.spec.js` (73 checks) covers the real config. On dev,
  `dev/live/live-classic.js` passes 15/15: found (including names with `&`,
  `/`, `()` and an apostrophe), not found with the clipboard check and a real
  redirect, and a missing Link.
- Dev fixtures: the lists **Classic-URL-Requests** and
  **Classic-URL-Redirects** on the dev site (`dev/live/live-classic-lists.ps1`,
  two seeded rows). The page is `SitePages/bsp-forms-classic-url-test.aspx`.
  The dev upload swaps in the dev site path, with the dev site's home page as
  a stand-in converter.

## Next

- [ ] **User: the link converter's URL.** Put it in
      `form.vars.converterUrl`. While it's empty, the not-found and bad-link
      screens show their message but don't redirect (a console warning
      explains why).
- [ ] User: confirm the assumed internal column names, or let the doctor do
      it. Requests: `Link` (Text), `ResourceName` (Text), `SourceDescription`
      (Note, plain). Redirects: `ResourceName` (Text), `URL` (Hyperlink or
      Text). Also confirm the lists' URLs are `Lists/Classic-URL-Requests` and
      `Lists/Classic-URL-Redirects`.
- [ ] Defaults the user may want changed: the field label "Source
      description", the result titles "Here's your new link" and "Let's get
      your new link", the 5-second countdown, and the brand icon.
- [ ] Merge `bsp-forms-team-classic` when the user says so.
- [ ] Prod: upload the engine and config, and make the page from the web part
      stub with `?v=` bumped and `data-validate` for the first load. The doctor
      checks both lists. Everyone needs **read** access to
      Classic-URL-Redirects and **add** access to Classic-URL-Requests.

## Landmines

- Never let the page URL choose a redirect target. The `safeHref` check and
  config-only `vars` are what stop this page from being an open redirect.
- `Link` is capped at 255 characters (a Text column). A longer link triggers
  `queryError`; it is never truncated.
