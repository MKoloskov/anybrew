# AnyBrew Campaign Manager — Summary

Last updated: 2026-11-18, after U4a (Player Requests: the threads). A commit is offered after each Summary update.
A short picture of the project as it stands. The full plan and every decision are in `PLAN.md`; open work is in `TODOs.md`; how to run the app is in `..\README.md`.

## What it is

A campaign manager for homebrew settings and custom rule systems, used in the browser on PCs, tablets and phones.
It is for the owner's own groups only (about 5 to 15 accounts), not a public product.
Claude writes the code. The owner tests behaviour and does not read code, so automated tests carry the review.

## Where things are

| Place | What is in it |
|---|---|
| `X:\Campaign Manager\anybrew` | The app: `server\` (API, database, visibility filter), `web\` (browser app), `e2e\` (browser tests). |
| `anybrew\website docs` | `PLAN.md`, this summary, `TODOs.md`. |
| `anybrew\server\data` | The database `anybrew.db`, uploaded pictures in `uploads`, backups in `backups` (database copies, their pictures in `backups\uploads`, and the copies made before a schema change, `before-schema-…`). |
| `X:\Campaign Manager\Chronica Exports` | The 15 Chronica JSON exports, the two English-name lists and the import report. |
| `X:\Campaign Manager\Rules imports` | Class files converted from PDF handbooks (now: `Alternate Wizard.class.json`). |
| `X:\Abyss\D&D Faerun Reboot` | The Obsidian vault: still the master copy for rules, spells and Elara's talent note. |

## How it is built

- **System** is the top-level container: one rule set with all its content. Nothing is shared between Systems.
- **Campaign** is a filter inside a System: a group of players and a tag on content. Content filed under a campaign is closed to players of other campaigns. Rules, items and spells belong to no campaign.
- **Roles:** DM (sees and edits everything in the System) and player (owns their characters).
- **Everything is an entity** of some type with a schema of groups and fields. Characters, NPCs, items, spells, features, rules and notes share the same storage, sheet, search and visibility code. Relations (owns, knows, has) are links, not copies.
- **Visibility** is set on an entity, a group or a field (DM only, chosen players, chosen parties, all) and is enforced on the server: hidden data is never sent to the browser.
- **A character is closed to other players except its Preview.** A player who may see someone else's character receives the main portrait, name, allegiance, race, Open Character History and the kind (PC, NPC, Aux). Everything else, including its features, spells, items and classes, goes to the owner and the DM. The DM can open a single section or field on one character.
- **Character list:** a page of cards with All / PC / NPC / Aux tabs, tag chips, the campaign filter and a name search; PCs first, then NPCs, then Aux, alphabetical inside each. A card opens the character's sheet on its own page.
- **Character sheet:** 16 pages with a menu on the right (a drop-down on a phone) and an address per page. Each viewer has only the pages they may see: the DM all 16, the owner all but DM Secrets, another player only the Preview. Inside a sheet the site navigation gives way to one "← Characters" button.
- **Player Requests** are not entities: a request is a thread between one player and the DMs of a System, in its own two tables. The server sends a request only to its player and to the DMs.
- **Change log:** every field edit is recorded with who, when, old and new value, and the DM can undo it.
- **Bilingual:** English is the source. A Russian reader sees "English (Russian)" for names and labels, and full Russian translations of long texts. The app's own buttons stay English.
- **Login:** invite link plus password, no email service. The DM resets passwords.
- **Stack:** TypeScript everywhere. React, Vite and Tailwind in the browser; Node.js with Fastify, tRPC and Zod on the server; SQLite in one file with Drizzle; Vitest and Playwright for tests. Planned hosting: one VPS with Docker and Caddy.

## What is done

**Phase 0, Foundation — built, runs on the owner's PC.**
Accounts by invite link, Systems with a switcher, roles, campaigns with their wall, parties, entity and link storage, change log with undo, the server-side visibility filter with tests, export and import of a whole System, a backup command.
- **Pictures in the backup and the export (F3, 2026-11-18).** `npm run backup` copies the database and every new picture into one shared `backups\uploads` folder that is never pruned, so every database copy finds its pictures. The Data tab exports a ZIP file with the System and all its pictures (replaced ones too, so an undo still finds them), or a plain JSON file with "Include pictures" unticked. Importing a ZIP creates a new System with its pictures under new ids; old JSON files still import, without pictures. Only the DM can export.
- **Schema versioning (F5, 2026-11-18).** Every System records the version of the schemas its data fits. A numbered list of schema changes (`server\src\schemas\versions.ts`) carries stored data along when a schema changes: values, audience overrides, translations, pictures and the change log follow a renamed, removed, moved or converted field. It runs on server start, after a full copy of the database to `backups\before-schema-v<n>-<time>.db`, and on import of an older export; data from a newer version of the app is refused. A schema change never shows a field to more people than before, and a change of who sees a field by default must be stated on purpose. A server test compares the schemas with an accepted snapshot of every id (`snapshot.json`) and fails, with the lines to write, when a schema changed without the matching entry. The live System is at version 0, the schemas of 2026-11-18.
Missing: deployment to the VPS and the scheduled nightly backup with an off-server copy. Both come after the structure of the app is built (see "Order of work" below). Until then a nightly backup on the owner's PC is planned (F8, not built).

**Phase 1, Character sheets — complete.**
- Character sheet built from the Chronica stat groups, with formulas, tick boxes, pools, lists and tables; sheet search; custom sections and fields on a single character.
- Characters are PC, NPC or Aux, listed by campaign and then by kind.
- Sheet modules: Spellcasting, Sorcery, Class stats, Masks, Supplies, Talent tree.
- Talent tree for Elara, loaded from the Obsidian note and shown as cards per tree with taken, available and locked talents and the points spent.
- Rules section. A rules table can feed the sheets: the Proficiency Bonus comes from its table.
- Classes: a rules document marked "Class" with hit die, proficiencies, subclasses and class table. A class is imported from a class file through a review screen, or made by hand. A character has a list of classes with subclass and level, which sets Level, Hit Dice and first-class proficiencies and lists the class features.
- Features section as a searchable, filterable table with a folder view.
- First small versions of the Spells and Items sections, and a panel on the sheet listing a character's features, spells and items.
- Russian reading language, translations written by the DM in the sheet, "not translated" and "outdated" marks.
- Glossary section with definitions on hover over sheet labels.
- Portrait upload, rich text with clean-up on the server.

**Look and theme, Slate & Brass — built 2026-11-18, checked by the owner (V6)** (`PLAN.md` section 11, tasks V1, V2, V3, V4, V9).
- A Light / Dark / System switch in the header, kept per device; the page opens in the right mode without a flash.
- Slate greys with a brass accent, as named colours for both modes; a dark top bar with a brass line and a brass underline on the active tab; a brass line on sheet groups; small corners.
- Fonts served from our own server: Source Sans 3 for text, Marcellus SC for names and headings, Spectral SC for the Russian letters in headings.
- Read and Edit modes on every entity page: a page opens for reading (plain text, empty fields hidden); the Edit button opens the full editor and becomes Done. Counters (tick boxes, pips, pools, talent picks) stay usable while reading. A new page opens in Edit.
- Section icons on the tabs (on a phone only the icons stay), a thin d20 as the logo mark and in empty lists, and a login page with a dark stone texture and a brass-framed card.
- DM-only style (V4, `PLAN.md` section 11.9), waits for the owner's check (V10). For the DM, what players cannot see has a faint brass tint, a dashed brass outline and a chip saying who can see it ("DM only", "Anna (owner)", "Party 2"): list rows, character cards, the name line of a page, sections and fields, and the rows of features, spells and items on a character sheet. On a character only what its own player cannot see is marked; a part opened to other players has a quiet "Also seen by" chip. While reading the chip is a label; in Edit it is the button that opens the choice. A player's browser receives no audience, so players see no chip and no tint.

**Character UX rework, server step (U1) — built 2026-11-18.**
- The character sheet is divided into 16 pages in its schema; every section is filed on a page, and field ids did not change. The Combat page shows AC, HP, hit dice and initiative, which stay stored in Secondary Stats.
- New fields: Background, Tags (only the DM edits them), a Progression History table, an Attacks table, Combat modifiers. Faction is now labelled Allegiance.
- Portrait gallery: up to 30 pictures per character, one of them the main portrait. A picture is served only while a field the viewer may see holds it.
- The DM's choice of card fields is stored on the System and travels with the export. The character list sends the card values of each character, only from fields the viewer may see.
- 18 server tests cover these rules as DM, owner and other player.

**Character list (U2) — built 2026-11-18.**
- "Characters" is a full-width page of cards: main portrait in a thin brass frame (or the first letter of the name), the name in both languages, allegiance, and the further fields the DM ticks under "Card fields…" (race, class, level, kind, status, disposition, owner, campaign, tags), one choice for everyone.
- Tabs All / PC / NPC / Aux with counts that follow the other filters; tag chips (a character must have every ticked tag); campaign filter; name search in English or Russian; "Reset filters". Each viewer's tab, tags, campaign and search are kept in their own browser.
- Order: PCs, then NPCs, then Aux, alphabetical inside each; on All each kind has a small heading. The old folders by campaign and kind are gone.
- A card opens the character's sheet (U3).
- Browser test `e2e/u2-character-list.spec.ts` covers the DM, the owner, another player of the campaign (Preview only, no tags) and a player of another campaign (sees nothing).

**Focused character sheet (U3) — built 2026-11-18, checked by the owner (U3c).**
- Inside a sheet the site navigation gives way to one "← Characters" button. A menu on the right (a drop-down on a phone) switches between the 16 pages; each page has its own address (`/s/<system>/characters/<id>/<page>`), so reload, Back and a shared link land on the same page.
- The sheet opens on Home for the owner and the DM, and on Preview for another player, who has no other page unless the DM opened a part to them. A new character opens on Basic Info, in Edit. Every page opens in Read mode, also after Edit was on for the page before.
- A header above every page: the main portrait in its brass frame (or the first letter), the name, the kind, campaign and owner line, and a d20 divider.
- Home (first version): class and level, tiles for Level, Armor Class, Hit Points, Initiative and Proficiency, the six abilities, the tags. Preview (first version): the main portrait large, Allegiance, Race, Open Character History.
- Features are split onto Class, Subclass and Hero Abilities (a feature naming a subclass goes to Subclass, another class feature to Class, everything else to Hero); items are on Inventory, spells on Spells Known. Each "+ Add" offers only what belongs on its page.
- "Sheet settings" at the bottom of Basic Info: who can see the sheet, owner, kind, campaigns, sheet modules, custom sections, History, Delete.
- The search works across pages: the open page shows its matches, and the menu shows the count of every other page.
- The portrait gallery on Basic Info: framed pictures with the main one marked, a large view with arrow keys, "Make main" and "Remove", several pictures at once or dropped, up to 30.
- Browser test `e2e/u3-sheet-pages.spec.ts` (DM, owner on a phone, another player); the older sheet tests were rewritten for the pages.

**Player Requests, the threads (U4a) — built 2026-11-18, waits for the owner's check (U4c).**
- "Requests" is a tab for everyone, between Notes and People, with the count of open requests that wait for the reader: for the DM those whose last message is from the player, for the player those whose last message is from the DM. On a phone the count sits on the icon.
- A player writes a request to the DM: a subject and a message in formatted text (bold, lists, headings, quotes, tables), cleaned on the server. The DM can also start a thread, addressed to one chosen player.
- Both sides write further messages while the request is open. Nothing is changed after sending. Only the DM marks a request resolved, reopens it, or deletes it for good.
- Two folders on both sides, Open and Archive (resolved), each with its count. A resolved request has no reply box.
- A player sees only their own requests; another player gets "does not exist", also by the direct address. Every DM sees and answers all of them.
- The requests of a player removed from the System stay for the DM, marked "former member", and no longer count as waiting; the player sees them again when added back.
- Requests are part of the JSON and ZIP export and import. A request whose player has no account on the importing server is left out.
- 14 server tests in `server/test/requests.test.ts`; browser test `e2e/u4-requests.spec.ts` (DM, a player on a phone, another player).
- Not built: pictures in messages (U4b).

**Chronica import — run once on 2026-11-16.**
14 characters (6 filled in, 8 nearly empty), 88 features, 32 spells, 67 items, 3 notes, 193 links. Typed totals that differ from the computed ones are kept as a Bonus on the row. Details are in `Chronica Exports\Import report.md`.

## What is next

**Order of work — decided 2026-11-18** (`PLAN.md` section 7): structure first, hosting after, players last.
- First the structure of the whole app is built on the owner's PC, every section in its working shape, and some content is put in.
- Then hosting: the VPS and domain (A1), deployment (F1) and the nightly off-server backup (F2).
- Then the security review of the visibility filter (F6), and only after it are players invited.
- Next on the foundation side: the nightly backup on the owner's PC (F8). Schema versioning (F5) is built.

**Character UX rework and Player Requests — decided 2026-11-17, U1 to U4a built** (`PLAN.md` section 10, tasks U4c to U10).
- U4c: the owner checks Player Requests as the DM and as a player, on PC and phone (the list of what to check is in the task).
- U4b: pictures in messages: up to 10 pictures attached to a message, shown under its text, seen only by the request's player and the DMs, carried by the ZIP export. Model: Fable 5.2.
- Later steps: the owner's design of the Preview page (U5) and Home (U6), Spells Known (U7), automatic Progression History (U8), Combat details (U9).

**Rest of the look** (`PLAN.md` section 11, tasks V10, V7). The samples are on the "AnyBrew Look Book" page (https://claude.ai/artifact/1i94FWp71kWs5kvnB3wQur).
- First the owner checks the DM-only style on PC and phone, in both modes, and says whether the tint is strong enough (V10).
- Later: an artwork carousel on the login page (V7). Portrait frames are on the character cards (U2) and the sheet header, with d20 dividers on the sheet (U3); spell school colours come with S1 and S2.
- Not now: rarity colours on items (on hold) and a separate colour per System.

**Spells section like Features — decided 2026-11-18, not built** (`PLAN.md` section 12, task S11).
- The Features list (search, filters, sortable table, folders) becomes one shared list set up per section. Spells get it with today's fields: columns Name, Circle, Casting, Characters; folders by circle; the full spell on the right in Read mode.
- When the 25 spell properties arrive (S1), School and class lists join as columns, filters and folders; the spell table task (S2) adds the remaining filters and saved views on top.

**Phases after that:**

| Phase | Content |
|---|---|
| 2 | Items and inventory: item library, quantity and equipped marks, side panel, weight totals. |
| 3 | Spellbook: the owner's 25 spell properties, spell table with filters, spell lists, known and memorized marks, glossary terms highlighted in long texts, bulk translation export and import. |
| 4 | Wiki and campaign: pages with mentions and backlinks, secret blocks, story beats, session logs, Obsidian import. |
| 5 | DM summary table with inline edits, bulk actions and live updates. |
| 6 | Import screen for JSON and CSV with field mapping. |
| 7 | Later: schema builder, crafting, VTT. |

## Open points

- Schema changes cannot yet remove or rename a whole entity type; the schema check refuses it until that is built (F10).
- The 88 features still store their old "Category" text from before the Type and Class split; nobody receives it (F9).
- The VPS account and the domain are not bought yet, on purpose: hosting comes after the structure is built. The exact address is not chosen. Proposed: Hetzner Cloud, Helsinki.
- Until hosting, the only copy of the data is on the owner's PC; the nightly backup to a second drive or a cloud folder (F8) is not set up yet and needs a target folder from the owner.
- Where the "structure" ends is not written down yet: which sections must exist before hosting.
- Imported characters have no owners and are visible to the DM only, because the export has no player names.
- 12 English item names in `Chronica Exports\English names - added at import.md` wait for approval.
- Picture files that were replaced or removed stay on disk (task F7); they are no longer served. The backup picture folder is never pruned either.
- Class table values are shown on the sheet but do not fill sheet fields such as spell slots.
- Home and Preview are first versions; their final design waits for the owner (U5, U6). On Home, empty values show as "–".
- A new message in a request shows up within 10 seconds, with the regular refresh; there is no other notice, and inside a character sheet the count is not shown.
- Frozen: generating images on the site. It needs a paid OpenAI API key.
