# classic-referrer-redirects — second-hop redirects for a classic SP migration

For one hyperspecific job: a classic SharePoint site
(`/sites/TandO-Classic/FCU/…`) has been migrated to a modern one
(`/sites/TandO-FCU/…`) and SharePoint bulk-redirects **every** old URL to a
single landing page on the new site. The pages don't map 1:1, so this
project does the second hop: a script on that landing page reads
`document.referrer` (which still holds the original old-site URL), looks it
up in a JSON mapping table, and forwards the visitor to the right new page
— tagging the URL so the destination can show a "you've been redirected"
box.

```
old page ──(SharePoint's own redirect)──► landing page ──(this script)──► real destination
                                          reads referrer                  gets ?classicRedirect=1
```

No dependencies, no build step, ES5-safe.

## Files

| File | What it is |
|---|---|
| `classic-redirect.js` | The script. Upload to the new site's SiteAssets. |
| `redirects.config.json` | The config, as plain JSON — the single source of truth. Edit here, paste into the web part snippet (`node test.js` fails if the two drift apart). |
| `webpart-snippet.html` | What goes in the custom script web part on the landing page. |
| `destination-notice-snippet.html` | Optional snippet for destination pages: shows a notice box when the visitor arrived via this redirect, then cleans the URL. |
| `test.js` | `node test.js` — stdlib-only tests: matching logic, config validation, snippet/config drift, and the browser wiring (run in a `vm` sandbox). |

## Config

```json
{
  "oldSiteFragment": "/sites/TandO-Classic/FCU",
  "newSiteBase": "/sites/TandO-FCU",
  "signalParam": "classicRedirect",
  "fallback": "SitePages/Migration-Info.aspx",
  "redirects": {
    "": "SitePages/Home.aspx",
    "NWWSH": "SitePages/NWWSH.aspx",
    "NWWSH/blah.aspx": "SitePages/NWWSH-Blah.aspx"
  }
}
```

- **`oldSiteFragment`** — the referrer is only acted on if its path contains
  this fragment (as whole segments — `/FCU-other/` won't match `/FCU`).
  Anything else, including normal navigation inside the new site, is
  ignored and the landing page just renders.
- **`redirects`** — keys are the old path *after* the fragment; values are
  the destination. Matching is case-insensitive and ignores leading/trailing
  slashes and the referrer's query string/hash.
  - `"NWWSH"` matches `…/FCU/NWWSH` and `…/FCU/NWWSH/` — the
    section-without-a-page-name case. `…/NWWSH/default.aspx` also folds
    into this key (a classic welcome page is its folder), unless you map
    `"NWWSH/default.aspx"` explicitly, which always wins.
  - `"NWWSH/blah.aspx"` matches only that page — so the section root and a
    page inside it can go to different destinations.
  - `""` matches the old site root itself.
  - Values are relative to **`newSiteBase`**, or absolute (`https://…`) to
    point anywhere else.
- **`fallback`** *(optional)* — destination for old-site referrers with no
  mapping. Omit it and unmapped visitors simply stay on the landing page.
- **`signalParam`** *(optional, default `classicRedirect`)* — name of the
  query param appended to destinations. Letters/digits/`_`/`-` only,
  starting with a letter (the notice snippet builds a RegExp from it).

The config is validated before anything runs: a structurally bad config
(missing `oldSiteFragment`, non-string destination, two keys that collide
after case/slash normalization, bad `signalParam`, …) logs a precise
`classic-redirect: bad config — …` error to the console and performs **no**
redirect, rather than silently misrouting people to the fallback.

## Signalling the destination page

Every redirect appends two query params:

```
?classicRedirect=1&classicRedirectFrom=%2Fsites%2FTandO-Classic%2FFCU%2FNWWSH%2Fblah.aspx
```

`destination-notice-snippet.html` reads them, un-hides an explanation box
(filling in the old path the visitor came from), and then strips the params
from the address bar with `history.replaceState` so reloads and bookmarks
stay clean.

## Setup

1. Upload `classic-redirect.js` to the new site's SiteAssets (or any
   library everyone can read).
2. Edit `redirects.config.json` with the real mappings and run
   `node test.js`.
3. Paste `webpart-snippet.html` into the custom script web part on the
   landing page, with the current config JSON in the `application/json`
   block and the `src` pointing at step 1's file. The config block must
   sit above the script tag. Keep the pasted JSON identical to
   `redirects.config.json` — the tests fail on any drift, so run them
   before each deploy.
4. Optionally paste `destination-notice-snippet.html` into each
   destination page (same web part type).

**Hosting requirement:** this assumes the custom script web part already
in use on these sites (any SPFx script-editor-style web part). Stock
modern web parts can't host it — the modern Embed web part only accepts
iframe embed code and strips `<script>` tags, and the classic Script
Editor web part doesn't exist on modern pages.

The script uses `location.replace()`, so the landing page never enters
Back-button history and there's no bounce loop. It also refuses to redirect
the landing page to itself (same path *and* same origin — an absolute
destination on a different site that happens to share the path still
redirects), so the landing page can safely appear as a destination or
fallback.

## Caveats

- The whole scheme rides on `document.referrer`. Same-tenant SharePoint →
  SharePoint navigation keeps the full path, but if the old site were on a
  different domain, the default browser referrer policy
  (`strict-origin-when-cross-origin`) would strip the path and nothing
  would match. This project assumes same tenant.
- Visitors who land on the landing page any other way (bookmark, direct
  link, no referrer) just see the landing page — by design.
