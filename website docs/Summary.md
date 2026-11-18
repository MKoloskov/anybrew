# AnyBrew Campaign Manager — Summary

Last updated: 2026-11-18, after U3 (the focused character sheet). A commit is offered after each Summary update.
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
| `anybrew\server\data` | The database `anybrew.db`, uploaded pictures in `uploads`, backups in `backups` (database copies, and their pictures in `backups\uploads`). |
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
- **Change log:** every field edit is recorded with who, when, old and new value, and the DM can undo it.
- **Bilingual:** English is the source. A Russian reader sees "English (Russian)" for names and labels, and full Russian translations of long texts. The app's own buttons stay English.
- **Login:** invite link plus password, no email service. The DM resets passwords.
- **Stack:** TypeScript everywhere. React, Vite and Tailwind in the browser; Node.js with Fastify, tRPC and Zod on the server; SQLite in one file with Drizzle; Vitest and Playwright for tests. Planned hosting: one VPS with Docker and Caddy.

## What is done

**Phase 0, Foundation — built, runs on the owner's PC.**
Accounts by invite link, Systems with a switcher, roles, campaigns with their wall, parties, entity and link storage, change log with undo, the server-side visibility filter with tests, export and import of a whole System, a backup command.
- **Pictures in the backup and the export (F3, 2026-11-18).** `npm run backup` copies the database and every new picture into one shared `backups\uploads` folder that is never pruned, so every database copy finds its pictures. The Data tab exports a ZIP file with the System and all its pictures (replaced ones too, so an undo still finds them), or a plain JSON file with "Include pictures" unticked. Importing a ZIP creates a new System with its pictures under new ids; old JSON files still import, without pictures. Only the DM can export.
Missing: deployment to the VPS and the scheduled nightly backup with an off-server copy. Both wait for the server account and the domain.

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

**Look and theme, Slate & Brass — built 2026-11-18** (`PLAN.md` section 11, tasks V1, V2, V9).
- A Light / Dark / System switch in the header, kept per device; the page opens in the right mode without a flash.
- Slate greys with a brass accent, as named colours for both modes; a dark top bar with a brass line and a brass underline on the active tab; a brass line on sheet groups; small corners.
- Fonts served from our own server: Source Sans 3 for text, Marcellus SC for names and headings, Spectral SC for the Russian letters in headings.
- Read and Edit modes on every entity page: a page opens for reading (plain text, empty fields hidden); the Edit button opens the full editor and becomes Done. Counters (tick boxes, pips, pools, talent picks) stay usable while reading. A new page opens in Edit.

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

**Focused character sheet (U3) — built 2026-11-18, waits for the owner's check (U3c).**
- Inside a sheet the site navigation gives way to one "← Characters" button. A menu on the right (a drop-down on a phone) switches between the 16 pages; each page has its own address (`/s/<system>/characters/<id>/<page>`), so reload, Back and a shared link land on the same page.
- The sheet opens on Home for the owner and the DM, and on Preview for another player, who has no other page unless the DM opened a part to them. A new character opens on Basic Info, in Edit. Every page opens in Read mode, also after Edit was on for the page before.
- A header above every page: the main portrait in its brass frame (or the first letter), the name, the kind, campaign and owner line, and a d20 divider.
- Home (first version): class and level, tiles for Level, Armor Class, Hit Points, Initiative and Proficiency, the six abilities, the tags. Preview (first version): the main portrait large, Allegiance, Race, Open Character History.
- Features are split onto Class, Subclass and Hero Abilities (a feature naming a subclass goes to Subclass, another class feature to Class, everything else to Hero); items are on Inventory, spells on Spells Known. Each "+ Add" offers only what belongs on its page.
- "Sheet settings" at the bottom of Basic Info: who can see the sheet, owner, kind, campaigns, sheet modules, custom sections, History, Delete.
- The search works across pages: the open page shows its matches, and the menu shows the count of every other page.
- The portrait gallery on Basic Info: framed pictures with the main one marked, a large view with arrow keys, "Make main" and "Remove", several pictures at once or dropped, up to 30.
- Browser test `e2e/u3-sheet-pages.spec.ts` (DM, owner on a phone, another player); the older sheet tests were rewritten for the pages.

**Chronica import — run once on 2026-11-16.**
14 characters (6 filled in, 8 nearly empty), 88 features, 32 spells, 67 items, 3 notes, 193 links. Typed totals that differ from the computed ones are kept as a Bonus on the row. Details are in `Chronica Exports\Import report.md`.

## What is next

**Character UX rework and Player Requests — decided 2026-11-17, U1 to U3 built** (`PLAN.md` section 10, tasks U3c to U10).
- U3c: the owner checks the focused sheet on PC and phone (the list of what to check is in the task).
- U4: Player Requests: a player writes to the DM in a thread, the DM answers and resolves it; Open and Archive folders for both sides. Model: Fable 5.2.
- Later steps: the owner's design of the Preview page (U5) and Home (U6), Spells Known (U7), automatic Progression History (U8), Combat details (U9).

**Rest of the look** (`PLAN.md` section 11, tasks V3, V4, V7). The samples are on the "AnyBrew Look Book" page (https://claude.ai/artifact/1i94FWp71kWs5kvnB3wQur).
- First the owner checks the new look and Read / Edit modes on PC and phone, in both modes, with Russian reading on (V6).
- Then: tab icons, a thin d20 as logo mark and in empty lists, a login page with a stone texture (V3); a visible "DM only" style for the DM (V4); later an artwork carousel on the login page (V7). Portrait frames are on the character cards (U2) and the sheet header, with d20 dividers on the sheet (U3); spell school colours come with S1 and S2.
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

- The VPS account and the domain are not bought yet; the exact address is not chosen. Proposed: Hetzner Cloud, Helsinki.
- Imported characters have no owners and are visible to the DM only, because the export has no player names.
- 12 English item names in `Chronica Exports\English names - added at import.md` wait for approval.
- Picture files that were replaced or removed stay on disk (task F7); they are no longer served. The backup picture folder is never pruned either.
- Class table values are shown on the sheet but do not fill sheet fields such as spell slots.
- Home and Preview are first versions; their final design waits for the owner (U5, U6). On Home, empty values show as "–".
- Frozen: generating images on the site. It needs a paid OpenAI API key.
