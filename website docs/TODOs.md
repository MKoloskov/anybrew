# AnyBrew Campaign Manager — TODOs

Last updated: 2026-11-18 (U4a done: Player Requests, the threads; U4b, pictures in messages, is next. Before it: F5 done, F9 and F10 added).
The single list of open work for this project. Every new task goes here, not into other files.
First filled from `PLAN.md`, the README and the Chronica import documents; the code itself was not audited, so a task marked "check" may turn out to be done.

## How to read the ratings

**Priority**
- **P1** — do next: blocks other work or risks losing data.
- **P2** — the planned next steps.
- **P3** — wanted, can wait.
- **P4** — later or optional.

**Complexity**
- **1** — minutes, one small change.
- **2** — one short session, one part of the app.
- **3** — one full session, several parts of the app, new tests.
- **4** — several sessions, a new mechanism.
- **5** — a new subsystem or a change of architecture.

**Model**
- **Fable 5.2** — architecture, anything that touches the visibility filter or the storage model, and the hardest tasks (complexity 4 to 5).
- **Opus 5.5 (medium)** — general feature work (complexity 3, some 2).
- **Sonnet 5.5** — small, well-described changes (complexity 2).
- **Haiku 5.5** — mechanical work: renames, list edits, simple data entry (complexity 1).
- **Owner** — only the owner can do it; no model.

A new task gets the next free number in its section. A finished task is moved to "Done" at the bottom with its date.

## A. Owner actions

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| A1 | Create the VPS account (proposed: Hetzner Cloud, Helsinki) and buy the domain; choose the exact address. Blocks F1 and F2. Not before the structure of the app is built and some content is in (`PLAN.md` section 7, order of work). | P3 | 1 | Owner |
| A2 | Approve or correct the 12 item names in `Chronica Exports\English names - added at import.md` (3 are marked "?"). | P2 | 1 | Owner |
| A3 | Set the owner of each imported character once players have accounts (the player numbers are in `Import report.md`). | P2 | 1 | Owner |
| A4 | Look through the differences listed in `Import report.md` (for example Calissa's Armor Class has no number) and correct the sheets where needed. | P3 | 1 | Owner |
| A5 | Upload character portraits, item pictures and the 2 maps by hand: the Chronica export held no picture files. | P4 | 1 | Owner |
| A6 | Create the dedicated Obsidian folder that will be imported as the wiki. Blocks W6. | P3 | 1 | Owner |
| A7 | Resolve spell conflicts between Obsidian, Chronica and the Google Sheet in the review list, when S7 has produced it. | P3 | 2 | Owner |

## F. Foundation (phase 0 leftovers and upkeep)

Order of work (owner, 2026-11-18): structure first, hosting after, players last. F1 and F2 wait until the structure of the app is built and some content is in; F6 comes after them, before players are invited.

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| F1 | Deploy to the VPS with Docker and Caddy (HTTPS); a DM and a player log in on the live server. Waits for A1. | P3 | 3 | Opus 5.5 (medium) |
| F2 | Scheduled nightly backup (`npm run backup`) and a copy of the result to storage off the server: the database copies and the shared `backups\uploads` picture folder (copy only new files). Waits for A1. | P3 | 2 | Sonnet 5.5 |
| F9 | Delete the 88 old "Category" values on features: the field was replaced by Type and Class on 2026-11-16 and its values stayed in the database. They are sent to nobody; they only travel in the export. The id `category` is already marked as never to be used again. | P4 | 1 | Haiku 5.5 |
| F10 | Schema migrations for removing or renaming a whole entity type. The schema check refuses such a change until this exists; build it when a type first has to go or change its key. | P4 | 3 | Fable 5.2 |
| F6 | Security review of the visibility filter before the first real players join the live server: every endpoint, search, links, images, imports, the ZIP export and import routes (`/api/export`, `/api/import`). After F1, before players are invited. | P3 | 4 | Fable 5.2 |
| F8 | Backup on the owner's PC until hosting exists: a Windows scheduled task that runs `npm run backup` every night and copies the result (database copies and `backups\uploads`) to a second drive or a cloud-synced folder. The owner names the target folder. | P1 | 2 | Sonnet 5.5 |
| F7 | Delete picture files that no field holds any more (replaced or removed pictures stay in `server\data\uploads`; they are no longer served). The same for pictures of deleted requests, once U4b is built. Keep the ones an undo in the change log could bring back, or delete only after a set time. The backup folder `backups\uploads` is never pruned either; decide whether it follows. | P4 | 2 | Sonnet 5.5 |

## C. Character sheet leftovers (phase 1)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| C1 | Feed class table values into sheet fields (spell slots and other per-level numbers) instead of only showing the table line. | P2 | 3 | Opus 5.5 (medium) |
| C2 | Remove the free-text Class field on Identity, or fill it from the class list. | P3 | 2 | Sonnet 5.5 |
| C3 | Draw the talent tree as a graph with connecting lines instead of cards. | P3 | 3 | Opus 5.5 (medium) |
| C4 | Rename the items of A2 in the app after approval. | P3 | 1 | Haiku 5.5 |
| C5 | Convert further class handbooks from PDF to class files and import them (one PDF per session). | P3 | 2 | Opus 5.5 (medium) |

## U. Character UX rework and Player Requests (PLAN.md section 10)

Decisions are in `PLAN.md` section 10.7. Build in this order; each step leaves the app working.

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| U4c | Owner check of U4a: as a player, write a request on PC and phone and see the count beside "Requests"; as the DM, answer with formatted text, mark it resolved, find it in Archive, reopen it; write to a player from the DM's side; delete a request; log in as another player and see that the request is not there. | P2 | 1 | Owner |
| U4b | Player Requests, step 2, pictures in messages: up to 10 pictures attached to a message, shown under its text and opened large; `request_files` table and its own address, served only to the request's player and the DMs; part of the ZIP export and import; server tests that another player never receives them, browser test. U4a is built. | P2 | 3 | Fable 5.2 |
| U5 | Preview page by the owner's design: which fields other players receive beyond the first version, and how the page looks. The server rule itself is built in U1. Needs the owner's design. | P3 | 2 | Fable 5.2 |
| U6 | Home page of the sheet: the owner's design of the summary. | P3 | 2 | Opus 5.5 (medium) |
| U7 | Spells Known page: spell slot allotments, spells per day rules, binding memorized spells for the day. Designed and built together with S4. | P3 | 4 | Opus 5.5 (medium) |
| U8 | Progression History recorded automatically from level-ups, added features and spells, with the level and the session. | P3 | 4 | Fable 5.2 |
| U9 | Combat page: the owner's full list of combat stats and modifiers beyond AC, HP, hit dice, initiative, death saves and the Attacks table. | P3 | 2 | Opus 5.5 (medium) |
| U10 | Apply the two-level layout (list, then focused page) to other sections, if the owner asks for it. | P4 | 3 | Opus 5.5 (medium) |

## V. Look and theme: Slate & Brass (PLAN.md section 11)

Build in this order. V1, V2, V3 and V4 are done; V1 shipped alone so the owner can compare light and dark on today's look.

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| V10 | Owner check of V4 (DM-only style) on PC and phone, light and dark: the Notes and Features lists and the character cards (tinted rows and cards with their chip); a note and a character while reading and in Edit (the chip beside the name, on DM Secrets, on a section opened to other players); change who can see something through the chip in Edit; an item players cannot see in a character's inventory; log in as a player and see no chip and no tint. Say whether the tint is strong enough. | P2 | 1 | Owner |
| V7 | Login page artwork carousel: the DM uploads pictures and marks them for the login page, each with a title; they change every few seconds. They are the only pictures served without a login, kept apart from other uploads; browser test that other uploads stay closed. | P3 | 3 | Fable 5.2 |

Also in other tasks: portrait frames (cards in U2, sheet header in U3b), d20 dividers on the sheet (U3b, done), spell School field (S1) and school colour dots (S2).

## I. Items and inventory (phase 2)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| I1 | Inventory on the sheet: quantity, equipped and attuned marks, container, notes, per-copy overrides on the link. | P2 | 3 | Opus 5.5 (medium) |
| I2 | Inventory table with chosen item columns (weight, scarcity, price, type). | P2 | 2 | Opus 5.5 (medium) |
| I3 | Side panel: an item opens beside the character without leaving the sheet. Reused later for spells. | P2 | 3 | Opus 5.5 (medium) |
| I4 | Carried weight total with encumbrance thresholds. | P2 | 2 | Sonnet 5.5 |
| I5 | One-off custom items on a character. | P3 | 2 | Sonnet 5.5 |
| I6 | Enter the bag names that the Chronica export lost, once containers exist (I1). | P4 | 1 | Owner |

## S. Spellbook, glossary, translation (phase 3)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| S1 | Generate the Spell schema (25 properties) from the Obsidian `_Schema\Spell.md` note; do the same for Component and Quality. | P2 | 3 | Opus 5.5 (medium) |
| S2 | Spell table: filters on every structured field of S1, School and class lists as columns and folders, saved views taken from `Spell Compendium.base`. Builds on S11. | P2 | 3 | Opus 5.5 (medium) |
| S3 | Spell lists as entities (class lists, homebrew lists). | P3 | 2 | Sonnet 5.5 |
| S4 | Known and memorized marks with the source on the character's spells; slot tracking on the sheet. | P2 | 3 | Opus 5.5 (medium) |
| S5 | Fill the 12 spell pages that were imported by name only (Command, Hex, Misty Step…). | P3 | 1 | Haiku 5.5 |
| S6 | Obsidian re-import on demand: update what changed, imported rules read-only in the app. | P2 | 4 | Fable 5.2 |
| S7 | Review list for spell conflicts between Obsidian, Chronica and the Google Sheet. | P3 | 3 | Opus 5.5 (medium) |
| S8 | Glossary terms recognised and highlighted inside long texts, definition on hover or tap, aliases for word forms. | P2 | 3 | Opus 5.5 (medium) |
| S9 | Bulk translation: export untranslated and outdated texts with the Glossary to a file, import the translated file back. | P2 | 3 | Opus 5.5 (medium) |
| S10 | Translate the exported texts into Russian in a session (repeats after each export). | P3 | 2 | Sonnet 5.5 |
| S11 | Spells section like Features (PLAN.md section 12): the feature browser becomes one shared library browser set up per section; Spells get table and folders on the left (columns Name, Circle, Casting, Characters; filters Circle, Casting, Character; folders by circle), the spell on the right; Features unchanged; browser test. | P2 | 3 | Opus 5.5 (medium) |

## W. Wiki and campaign (phase 4)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| W1 | Wiki pages: rich text, categories, parent pages. | P3 | 3 | Opus 5.5 (medium) |
| W2 | `@mentions` of any entity and the "Mentioned in" list, without leaking hidden entities. | P3 | 4 | Fable 5.2 |
| W3 | Secret blocks: visibility per paragraph, removed on the server. | P3 | 4 | Fable 5.2 |
| W4 | Story beats: status, order, session number, links to involved entities. | P3 | 2 | Opus 5.5 (medium) |
| W5 | Campaign summary page and session logs. | P3 | 2 | Sonnet 5.5 |
| W6 | Markdown and Obsidian import: `[[links]]` become mentions, folders become the page hierarchy. Waits for A6. | P3 | 3 | Opus 5.5 (medium) |
| W7 | Global search across everything the user may see, in English and Russian, with a filter by type. In the plan (4.8) but in no phase. | P3 | 3 | Opus 5.5 (medium) |

## D. DM summary table and live updates (phase 5)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| D1 | Live updates over WebSocket from the change log, replacing the 10-second refresh; each viewer receives only what they may see. | P3 | 5 | Fable 5.2 |
| D2 | DM summary table: chosen rows and columns, each cell the real field editor. | P3 | 4 | Opus 5.5 (medium) |
| D3 | Saved views ("Combat", "Travel", "Downtime"). | P3 | 2 | Sonnet 5.5 |
| D4 | Bulk actions: a value or a delta applied to selected rows. | P3 | 2 | Opus 5.5 (medium) |

## M. Import screen (phase 6)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| M1 | JSON and CSV import: pick the type, map keys to fields with suggestions, preview, import; saved mappings. | P4 | 4 | Opus 5.5 (medium) |
| M2 | Duplicate detection by name and source, with merge or skip. | P4 | 2 | Sonnet 5.5 |
| M3 | Bundle D&D 5e SRD content (CC-BY-4.0) as starter data. | P4 | 2 | Sonnet 5.5 |

## L. Later (phase 7)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| L1 | Schema builder: fields and groups defined in the app instead of in code. | P4 | 5 | Fable 5.2 |
| L2 | Crafting: recipes as entities linking inputs to outputs; the screen for it. | P4 | 4 | Opus 5.5 (medium) |
| L3 | VTT for online combat: tokens linked to sheets, real-time sync. To be planned separately. | P4 | 5 | Fable 5.2 |
| L4 | Convert an NPC to a player character and back. Check whether it exists. | P4 | 2 | Sonnet 5.5 |

## Frozen

Not tasks until the owner asks:
- Generating images on the site and storing style documents (needs a paid OpenAI API key).
- Translating the app's own buttons and menus.
- PDF upload inside the app (the owner chose conversion in a session).
- A separate accent colour per System (PLAN.md section 11.5): not needed while the owner works with a single System.
- Rarity field and rarity colours on items (PLAN.md section 11.5): on hold; rarity differs from the Scarcity column in I2.

## Done

| ID | Task | Finished |
|---|---|---|
| U4a | Player Requests, step 1, the threads (`PLAN.md` 10.4): `requests` and `request_messages` tables (migration 0004); router `server/src/routers/request.ts` (list, waiting, get, create, reply, resolve, reopen, remove); rich-text messages cleaned on the server, nothing edited after sending; a player starts a request, the DM starts one addressed to a chosen player; only the DM resolves, reopens and deletes; a "Requests" tab for everyone with the count of requests that wait for the reader (on a phone the count sits on the icon); Open and Archive folders; another player gets "not found"; requests of a removed player stay for the DM as "former member" and no longer count; part of the JSON and ZIP export and import (left out when the player has no account on the server; message text cleaned again); 14 server tests in `server/test/requests.test.ts`, browser test `e2e/u4-requests.spec.ts`. | 2026-11-18 |
| V4 | DM-only style (`PLAN.md` section 11.9): for the DM, a faint brass tint, a dashed brass outline and a "who can see it" chip on what players cannot see: list rows (Notes, Spells, Items, Rules, Glossary, Features table and folders), character cards, the name line of a page, sections and fields, and the rows of features, spells and items on a character sheet. On a character only what its own player cannot see is marked; a part opened to other players gets the quiet "Also seen by" chip. While reading the chip is a label, in Edit it is the button that opens the choice (the amber eye button is gone). The server sends the audience with list rows, links and class features to the DM only; server test in `server/test/visibility.test.ts`, browser test `e2e/v4-dm-only.spec.ts` (DM, and a player on a phone who gets no chip, no tint and no audience). New files `web/src/components/Visibility.tsx`; styles `.chip`, `.secret`, `.secret-row` in `web/src/index.css`. | 2026-11-18 |
| V6 | Owner check after V2, V9 and V3 (look, Read / Edit modes, tab icons, login page): done by the owner. | 2026-11-18 |
| U3c | Owner check of U3, the focused character sheet (both steps): done by the owner. | 2026-11-18 |
| F5 | Schema versioning: it did not exist, so it was built (`PLAN.md` section 6). A schema version per System; a list of schema changes in `server/src/schemas/versions.ts` (rename, remove, move, convert, modules, stated change of default audience) that carries values, audience overrides, translations, pictures and the change log along; run on server start after a safety copy of the database, and on import of an older export; newer data is refused. A snapshot of all ids (`snapshot.json`) and a guard test that fails when a schema changes without the matching entry; commands `schema:check`, `schema:accept`, `schema:audit`. A change that a removed field made can no longer be undone from the history. Found and fixed: group and field both named `progression`. 20 server tests in `server/test/schema-versioning.test.ts`. | 2026-11-18 |
| U3b | Focused character sheet, step 2: compact header above every page (main portrait in its brass frame or the first letter, name, the quiet line, a d20 divider); Home first version in Read mode (class and level, tiles for Level, AC, HP, Initiative, Proficiency, the six abilities, tags; Home is left out of the search counts); Preview first version (main portrait large, Allegiance, Race, Open Character History); the gallery screen on Basic Info (framed grid, main marked, large view with arrows and Escape, make main and remove in the view, several pictures at once or dropped, "n of 30"); numbers in the text font because Marcellus SC draws 0 like O; browser test `e2e/u3-sheet-pages.spec.ts` extended. | 2026-11-18 |
| U3a | Focused character sheet, step 1: "← Characters" in place of the site navigation inside a sheet; right-hand page menu (a drop-down on a phone) with only the pages the viewer has (another player: Preview only); an address per page (`/s/<system>/characters/<id>/<page>`), unknown or hidden pages fall back to Home or Preview; every page opens in Read; features split onto Class / Subclass / Hero Abilities, items on Inventory, spells on Spells Known, each "+ Add" offering only what belongs on that page; "Sheet settings" (who can see it, owner, kind, campaigns, modules, custom sections, history, delete) at the bottom of Basic Info; search counts per page in the menu; a new character opens on Basic Info; browser tests rewritten, new `e2e/u3-sheet-pages.spec.ts`. | 2026-11-18 |
| F3 | Pictures in the backup and the export: `npm run backup` also copies new pictures into one shared `backups\uploads` folder (never pruned, so every database copy finds its pictures); the Data tab exports a ZIP (`export.json` plus `pictures/`) with every picture of the System, replaced ones included for undo, or a plain JSON file with "Include pictures" unticked; a ZIP import gives pictures new ids and writes them to disk, old JSON files still import; routes in `server/src/archive.ts`; 10 server tests in `server/test/archive.test.ts`, browser test `e2e/x-export-pictures.spec.ts`. | 2026-11-18 |
| F4 | Commit the work to git: done by the owner; only fresh changes are uncommitted. From now on a commit is offered after each Summary update (`CLAUDE.md`, Rule 3). | 2026-11-18 |
| A10 | Stone-texture login page: fine for now (`PLAN.md` section 11.7, question 3). | 2026-11-18 |
| V3 | Section icons on the nine tabs, from the Lucide icon package `lucide-react` (`web/src/components/Icons.tsx`); on a phone the labels drop, the icons stay on one line and the label is the tooltip; d20 beside the System name and above empty lists (section lists and the character list); login, setup and invite pages on a dark stone texture, same in both modes, with a brass-framed card and the d20 logo; browser test `e2e/v3-look.spec.ts`. | 2026-11-18 |
| U2 | Character list page: full-width cards (main portrait in a brass frame or the first letter, bilingual name, allegiance, the DM's card fields), All / PC / NPC / Aux tabs with counts that follow the other filters, tag chips (all ticked tags must match), campaign filter, name search, "Reset filters"; PC, then NPC, then Aux, alphabetical inside each; tab, tags, campaign and search kept per viewer in the browser; "Card fields…" panel for the DM on the list; folders removed; a card opens the sheet on its own page with "← Characters"; browser test `e2e/u2-character-list.spec.ts` (DM, owner, other player, other campaign). | 2026-11-18 |
| U1 | Server side of the character UX rework: 16 sheet pages in the schema, groups filed onto them with unchanged field ids, Background, Tags (DM edits), Allegiance label, Progression History, Attacks and Combat modifiers, portrait gallery with a main portrait, card field choice on the System, card values in the character list, everything except the Preview closed to other players (sheet, links, class details, "who has this"); a picture is served only while a visible field holds it; 18 new server tests in `server/test/character-ux.test.ts`. | 2026-11-18 |
| A8 | Answer the 9 open questions on the character UX rework (PLAN.md section 10.7). | 2026-11-17 |
| A11 | Choose the font for Russian headings: Spectral SC (PLAN.md section 11.3). | 2026-11-18 |
| V9 | Read and Edit modes on every entity page (PLAN.md section 11.8): Read by default with plain text and empty fields hidden, Edit / Done button, counters usable while reading, a new page opens in Edit; browser test `e2e/read-mode.spec.ts`. | 2026-11-18 |
| V2 | Slate & Brass restyle: colour tokens for both modes in `web/src/index.css`, every component off raw `stone` / `sky` colours, Source Sans 3, Marcellus SC and Spectral SC (Russian letters) served from our server, 3 / 4 px corners, dark top bar with brass tab underline, brass line on sheet groups, icon on the "translation outdated" mark; browser tests in `e2e/theme.spec.ts`. | 2026-11-18 |
| V8 | Owner check of V1: the drop-down switch is fine. | 2026-11-18 |
| V1 | Light / dark switch: System, Light, Dark in the header, kept per device; mode set before the app loads; Tailwind `dark:` driven by `data-theme`; browser test `e2e/theme.spec.ts`. | 2026-11-18 |
| A9 | Choose a design direction: Slate & Brass, with every small touch except a colour per System (PLAN.md section 11). | 2026-11-17 |
