# AnyBrew Campaign Manager — TODOs

Last updated: 2026-11-18.
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
| A1 | Create the VPS account (proposed: Hetzner Cloud, Helsinki) and buy the domain; choose the exact address. Blocks F1 and F2. | P1 | 1 | Owner |
| A2 | Approve or correct the 12 item names in `Chronica Exports\English names - added at import.md` (3 are marked "?"). | P2 | 1 | Owner |
| A3 | Set the owner of each imported character once players have accounts (the player numbers are in `Import report.md`). | P2 | 1 | Owner |
| A4 | Look through the differences listed in `Import report.md` (for example Calissa's Armor Class has no number) and correct the sheets where needed. | P3 | 1 | Owner |
| A5 | Upload character portraits, item pictures and the 2 maps by hand: the Chronica export held no picture files. | P4 | 1 | Owner |
| A6 | Create the dedicated Obsidian folder that will be imported as the wiki. Blocks W6. | P3 | 1 | Owner |
| A7 | Resolve spell conflicts between Obsidian, Chronica and the Google Sheet in the review list, when S7 has produced it. | P3 | 2 | Owner |
| A10 | On the look book page (https://claude.ai/artifact/1i94FWp71kWs5kvnB3wQur): say whether the stone-texture login page is right for now (`PLAN.md` section 11.7, question 3). Not blocking V2. | P3 | 1 | Owner |

## F. Foundation (phase 0 leftovers and upkeep)

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| F1 | Deploy to the VPS with Docker and Caddy (HTTPS); a DM and a player log in on the live server. Waits for A1. | P1 | 3 | Opus 5.5 (medium) |
| F2 | Scheduled nightly backup of the database to storage off the server. Waits for A1. | P1 | 2 | Sonnet 5.5 |
| F3 | Include uploaded pictures (`server\data\uploads`) in the backup command and in the JSON export and import. | P1 | 3 | Opus 5.5 (medium) |
| F4 | Commit the current work to git: almost everything since the first commit is uncommitted. | P1 | 1 | Haiku 5.5 |
| F5 | Check that schema versioning exists (adding, renaming, removing fields on existing entities); the plan requires it from phase 1. Build it if missing. | P2 | 4 | Fable 5.2 |
| F6 | Security review of the visibility filter before the first real players join the live server: every endpoint, search, links, images, imports. | P2 | 4 | Fable 5.2 |
| F7 | Delete picture files that no field holds any more (replaced or removed pictures stay in `server\data\uploads`; they are no longer served). Keep the ones an undo in the change log could bring back, or delete only after a set time. | P4 | 2 | Sonnet 5.5 |

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
| U2 | Character list page: All / PC / NPC / Aux tabs, tag filter, campaign filter, name search, cards (portrait, name, allegiance) with further card fields chosen by the DM for everyone; tab, tags, campaign and search remembered per viewer in their browser. Removes the folder list. The server part is done (U1): `entity.list` sends a `card` per character, `system.get` the chosen fields and the options, `system.setCardFields` stores the choice. | P2 | 3 | Opus 5.5 (medium) |
| U3 | Focused character sheet: "← Characters" instead of the site navigation, right-hand page menu (drop-down on a phone), a page address per page, search with match counts per page, feature panel split into class / subclass / hero, first versions of Home and Preview, DM controls under "Sheet settings"; the gallery screen in place of the small one added to the old sheet in U1; rewrite the browser tests of the sheet. Pages and their "shows" lists arrive in the schema of each character (U1). | P2 | 4 | Opus 5.5 (medium) |
| U4 | Player Requests: `requests` and `request_messages` tables, endpoints, Open and Archive folders, count in the navigation, part of the JSON export and import, server and browser tests. | P2 | 3 | Fable 5.2 |
| U5 | Preview page by the owner's design: which fields other players receive beyond the first version, and how the page looks. The server rule itself is built in U1. Needs the owner's design. | P3 | 2 | Fable 5.2 |
| U6 | Home page of the sheet: the owner's design of the summary. | P3 | 2 | Opus 5.5 (medium) |
| U7 | Spells Known page: spell slot allotments, spells per day rules, binding memorized spells for the day. Designed and built together with S4. | P3 | 4 | Opus 5.5 (medium) |
| U8 | Progression History recorded automatically from level-ups, added features and spells, with the level and the session. | P3 | 4 | Fable 5.2 |
| U9 | Combat page: the owner's full list of combat stats and modifiers beyond AC, HP, hit dice, initiative, death saves and the Attacks table. | P3 | 2 | Opus 5.5 (medium) |
| U10 | Apply the two-level layout (list, then focused page) to other sections, if the owner asks for it. | P4 | 3 | Opus 5.5 (medium) |

## V. Look and theme: Slate & Brass (PLAN.md section 11)

Build in this order. V1 and V2 are done; V1 shipped alone so the owner can compare light and dark on today's look.

| ID | Task | Priority | Complexity | Model |
|---|---|---|---|---|
| V3 | Section icons on the tabs (labels drop on phones), d20 logo mark and d20 empty lists, login page with stone texture and framed card. | P3 | 2 | Sonnet 5.5 |
| V4 | DM-only style: tint, dashed outline and "who can see it" chip on entities, groups, fields and list rows, for the DM only; send the visibility setting with list rows to the DM if needed; browser test for DM and player. Also moves the amber "DM only" eye button onto the new style. | P3 | 3 | Fable 5.2 |
| V6 | Owner check after V2 and V9: PC and phone, light and dark, Russian reading on; read a spell, a feature and a character in Read mode, then change something in Edit. | P2 | 1 | Owner |
| V7 | Login page artwork carousel: the DM uploads pictures and marks them for the login page, each with a title; they change every few seconds. They are the only pictures served without a login, kept apart from other uploads; browser test that other uploads stay closed. Waits for V3. | P3 | 3 | Fable 5.2 |

Also in other tasks: portrait frames on cards (U2) and in the sheet header (U3), d20 dividers on the sheet (U3), spell School field (S1) and school colour dots (S2).

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
| S2 | Spell table: sortable columns, filters on every structured field, text search, saved views taken from `Spell Compendium.base`. | P2 | 3 | Opus 5.5 (medium) |
| S3 | Spell lists as entities (class lists, homebrew lists). | P3 | 2 | Sonnet 5.5 |
| S4 | Known and memorized marks with the source on the character's spells; slot tracking on the sheet. | P2 | 3 | Opus 5.5 (medium) |
| S5 | Fill the 12 spell pages that were imported by name only (Command, Hex, Misty Step…). | P3 | 1 | Haiku 5.5 |
| S6 | Obsidian re-import on demand: update what changed, imported rules read-only in the app. | P2 | 4 | Fable 5.2 |
| S7 | Review list for spell conflicts between Obsidian, Chronica and the Google Sheet. | P3 | 3 | Opus 5.5 (medium) |
| S8 | Glossary terms recognised and highlighted inside long texts, definition on hover or tap, aliases for word forms. | P2 | 3 | Opus 5.5 (medium) |
| S9 | Bulk translation: export untranslated and outdated texts with the Glossary to a file, import the translated file back. | P2 | 3 | Opus 5.5 (medium) |
| S10 | Translate the exported texts into Russian in a session (repeats after each export). | P3 | 2 | Sonnet 5.5 |

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
| U1 | Server side of the character UX rework: 16 sheet pages in the schema, groups filed onto them with unchanged field ids, Background, Tags (DM edits), Allegiance label, Progression History, Attacks and Combat modifiers, portrait gallery with a main portrait, card field choice on the System, card values in the character list, everything except the Preview closed to other players (sheet, links, class details, "who has this"); a picture is served only while a visible field holds it; 18 new server tests in `server/test/character-ux.test.ts`. | 2026-11-18 |
| A8 | Answer the 9 open questions on the character UX rework (PLAN.md section 10.7). | 2026-11-17 |
| A11 | Choose the font for Russian headings: Spectral SC (PLAN.md section 11.3). | 2026-11-18 |
| V9 | Read and Edit modes on every entity page (PLAN.md section 11.8): Read by default with plain text and empty fields hidden, Edit / Done button, counters usable while reading, a new page opens in Edit; browser test `e2e/read-mode.spec.ts`. | 2026-11-18 |
| V2 | Slate & Brass restyle: colour tokens for both modes in `web/src/index.css`, every component off raw `stone` / `sky` colours, Source Sans 3, Marcellus SC and Spectral SC (Russian letters) served from our server, 3 / 4 px corners, dark top bar with brass tab underline, brass line on sheet groups, icon on the "translation outdated" mark; browser tests in `e2e/theme.spec.ts`. | 2026-11-18 |
| V8 | Owner check of V1: the drop-down switch is fine. | 2026-11-18 |
| V1 | Light / dark switch: System, Light, Dark in the header, kept per device; mode set before the app loads; Tailwind `dark:` driven by `data-theme`; browser test `e2e/theme.spec.ts`. | 2026-11-18 |
| A9 | Choose a design direction: Slate & Brass, with every small touch except a colour per System (PLAN.md section 11). | 2026-11-17 |
