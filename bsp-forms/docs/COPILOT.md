# Building forms with Copilot Chat

Microsoft 365 Copilot Chat can draft a new BSP form. It interviews you, then
hands back the list columns, the config JSON, the web part snippet and a
go-live checklist. It can't load skills or read this whole repo, but it can
read a few files you link (or one small folder). This page says which files,
and how to set them up on prod.

The guide Copilot follows is
[`copilot/BSP-FORMS-COPILOT-GUIDE.md`](../copilot/BSP-FORMS-COPILOT-GUIDE.md).
Everything else it reads already exists in this repo.

## One-time setup on prod

1. Pick a folder Copilot users can read, e.g. a `BSP Forms - Copilot` folder in
   a document library. Keep it **out of** `Code/bsp-forms/forms/`, so the guide
   is never mistaken for a form config.
2. Upload these into it:

   | File | From the repo |
   | --- | --- |
   | `BSP-FORMS-COPILOT-GUIDE.md` | `bsp-forms/copilot/` |
   | `CONFIG-REFERENCE.md` | `bsp-forms/docs/` |
   | `example-it-request.json` | `bsp-forms/forms/` |
   | `gsi-digital-creative-intake.json` | `bsp-forms/forms/` |
   | `ps-zone-attestation.json` | `bsp-forms/forms/` |
   | `classic-url-request.json` | `bsp-forms/forms/` |

   Any of the configs already live on prod are in `Code/bsp-forms/forms/`. You
   can link to those copies instead of uploading them again. They stay current
   by themselves, but then the folder alone isn't the full set.
3. Edit the uploaded guide. In the **Files to read** table in section 1,
   replace each `PASTE-LINK` with that file's SharePoint link (… → Copy link).
   That table is the only place links appear.
4. Test it: start a chat with the starter prompt below and ask for a tiny
   form. If Copilot says it can't open a `.md` file, rename the uploaded copy
   to `.txt` and update the link. The content is plain text either way.

## Starter prompt

Paste this into Copilot Chat, with the guide's link (or the folder's link):

```text
Read the BSP Forms guide at <LINK TO BSP-FORMS-COPILOT-GUIDE> and the files
listed in its section 1 before answering. Follow it strictly. I want to build
a new BSP form. Interview me as section 3 describes, show me an outline to
approve, then give me everything section 6 lists. If I ask for something the
engine can't do, tell me rather than inventing config.
```

Then describe the form. Have the list's column internal names ready if the
list already exists (List settings → column → the `Field=` part of the
address).

## Reviewing what Copilot gives you

The guide makes Copilot run the doctor (`data-validate`) before go-live. It
catches wrong or missing columns, which are Copilot's most likely mistake.
What the doctor *can't* catch: misspelled keys (silently ignored), a rule
on the wrong field, and choice values that differ from the list's. Read the
JSON for those, or run it through the local harness before uploading:

```
http://localhost:8000/bsp-sp-parts/bsp-forms/dev/index.html?form=<name>
```

(save the file into `forms/` first; see the README, *Local development*).

## Keeping it current

The guide copies some facts out of `CONFIG-REFERENCE.md` and the engine: the
field types, the sprite icon names, the config error checks. When either one
changes in a way a form author would notice, update the guide in the same
commit and re-upload both. Because the guide's own links sit only in that one
table, re-uploading means pasting the links back in. Keep a copy of the table
with your links filled in.
