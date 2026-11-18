# AnyBrew Campaign Manager — Plan

A campaign manager for homebrew settings and custom rule systems: "build your own world and system".
Claude writes the code. The owner does not read code and tests behaviour only, so automated tests carry the review.
The stack is approved (section 8). The existing data and what it changes are in section 9.

## 0. Decisions made (2026-11-16)

- **Name (official, 2026-11-16):** AnyBrew Campaign Manager. Code folder `anybrew`. The domain will use this name; the exact address is not chosen yet.
- **Audience:** the owner's own group(s) only, roughly 5 to 15 accounts. Not a public product.
- **System is the top-level container (decided 2026-11-16).** A System is one rule set with all its content, for example the D&D homebrew, or LANCER. Switching System is the only switch in the app: nothing from one System is visible in another.
- **A campaign is a filter, not a container.** Inside a System the DM sees and reaches all content at once, with no switching between campaigns. A campaign is a group of players and a tag on content: what is filed under a campaign (characters, party notes, story) is closed to players of other campaigns. Rules, items and spells are filed under no campaign, so their visibility has nothing to do with campaigns.
- **DM is a role of the whole System.** A DM sees and edits everything in it, across all campaigns. Everyone else is a player of the campaigns they were added to.
- **Each party belongs to one campaign** and holds only that campaign's players.
- **Rules section (2026-11-16).** Rules are their own section and entity type: a document with text and an optional table. A table with a formula name feeds the sheets: the document "Proficiency Bonus from Level" (D&D 5e 2014 table, levels 1 to 20) gives every character sheet its Proficiency Bonus from its Level, and editing the table changes all sheets at once. Other rule tables can be wired the same way with `lookup(name, value)`.
- **All names are bilingual (2026-11-16).** Every name, characters included, is stored as an English name plus its Russian form. The 58 Russian-only Chronica names use the approved English list in `Chronica Exports`.
- **Hosting:** one cheap VPS, always online, from phase 0.
- **Devices:** laptops, desktops, tablets and phones, all in the browser. Every player-facing screen gets a narrow layout. The DM summary table may stay desktop-only.
- **Live updates:** wanted, not required in the first version. The change log (below) is built so they can be switched on without a rewrite.
- **Rules:** D&D 5e homebrewed so far that it is its own system. Schema changes are rare, but characters differ a lot from each other (see 2, Sheet modules).
- **Automation level:** smart form. Formulas compute modifiers, totals and weight. No automatic item bonuses. Changed 2026-11-16: a class chosen on the sheet does bring its features by level, hit dice, proficiencies and class table line (see the status in section 5).
- **Login:** invite link + password. The DM resets passwords. No email service.
- **History:** every field edit is logged (who, when, old value, new value) and the DM can revert it.
- **Dice:** out of scope until the VTT. The dice expression field only displays text such as `2d6+3`.
- **Migration:** existing data comes from Chronica JSON exports, Markdown/Obsidian notes and Google Sheets.
- **PDF import (decided 2026-11-16):** Claude converts a PDF in a coding session into a file, and the app imports that file through a review screen. No LLM API inside the app. Built for class handbooks first.

## 1. Goals

- Character sheets with custom fields, collapsible groups, sheet-wide substring search, and per-group visibility.
- NPCs built exactly like characters and stored in the same place.
- Per-character inventory with an inline item view and item stats (weight, scarcity, price…).
- Spellbook: full spell descriptions, a filterable spell table, custom spell lists per character, known/memorized marks for casters.
- World wiki and a campaign section (story beats, summary).
- DM summary table: the DM picks fields, sees them for all characters, and edits flow back into the sheets.
- Visibility on all content: a specific player, a specific party, all players, or DM only.
- Import of spells, items, classes etc. from uploaded JSON and PDF files.
- A Glossary of game terms, with definitions shown on hover wherever a term appears.
- Two reading languages, English (source) and Russian: names and labels as "English (Russian)", long texts fully translated.
- Uploaded images on entities (portraits, item pictures, spell icons).

**Later:** a visual schema builder (fields defined in the UI instead of code), crafting, a VTT for online combat in the style of Owlbear Rodeo.

**Non-goals for now:** mobile apps, offline mode, a marketplace, sharing or copying content between Systems.

## 2. Core concept: everything is an entity

Every piece of content is an **entity** of some **type**. Each type has a **schema** (groups → fields).
Characters, NPCs, items, spells, classes, wiki pages and story beats all use the same storage, sheet renderer, search and visibility code.

```
System             one rule set; the only thing the user switches between
 ├─ Members        user + role (DM | player), for the whole System
 ├─ Campaigns      a group of players; a tag on content, not a container
 │   └─ Parties    smaller named groups of that campaign's players
 ├─ EntityTypes    Character, Item, Spell, SpellList, Class, WikiPage, StoryBeat…  → schema
 ├─ Entities       type + values (document) + owner + visibility + campaign tags (none = campaign-agnostic)
 └─ Links          from-entity –kind→ to-entity + link data
                   e.g. Thorin –owns→ Longsword {qty: 1, notes}
                        Thorin –knows→ Fireball {memorized: true, source: "Wizard"}
```

- Accounts are shared by all Systems: one login, and a list of the Systems the user is a member of.
- The Glossary, translations, schemas and the item, spell and rule libraries belong to a System.
- An entity can be filed under several campaigns (a recurring NPC), under one, or under none.

### Schema
- A schema is a tree: **groups** (collapsible, nestable) contain **fields**.
- Every group and field has a stable `id`, a `label`, an optional `visibility` and an order.
- **Field types:** text, rich text, number, dice expression, boolean, select/multi-select, list, table (columns are fields), reference (to one or many entities of a given type), computed (a read-only formula over other fields).
- **Phase 1–6:** schemas are written in code, in the same shape the database will later store. The future builder only edits this data, so nothing has to be rewritten.

### Sheet modules (per-character differences)
- A character's sheet is not one fixed schema. It is the **base schema** plus the **modules** attached to that character plus its own **custom fields**.
- A module is a reusable piece of schema: "Standard class progression", "Talent tree", "Spellcasting", "Pact magic"… The DM attaches or removes modules per character.
- Custom fields and groups can be added to a single character without touching any shared schema.
- The DM summary table shows an empty cell where a character lacks the field of a column.
- **Talent tree** is a module with its own view: Talent entities, `requires` links between them, and Character –has→ Talent links with the points spent. It is drawn as a tree, with locked, available and bought states.

### Change log
- Every edit is saved as one field-level change: entity, field id, old value, new value, user, time. The entity document is the result of its changes.
- This one mechanism gives history and undo, safe simultaneous editing (two people editing different fields never overwrite each other), and later live updates (each change is sent to the open sheets).

### Values
- One document per entity, keyed by field id.
- References and many-to-many relations (inventory, known spells) are **Links**, not copies, so editing an item updates it everywhere.
- Per-copy differences, such as an enchanted longsword, are overrides stored on the link.

## 3. Roles and visibility

- **Roles:** DM (owner, can be more than one) and player, both per System. A player owns their own characters.
- **Audiences:** `dm` · `players: [ids]` · `parties: [ids]` · `all`.
- **Campaign wall:** an entity filed under campaigns is closed to every player outside those campaigns, whatever its audience says. For it, `all` means all players of those campaigns. For an entity filed under no campaign, `all` means all players of the System.
- A player is told only about their own campaigns: not the names of the others, nor who plays in them.
- A campaign cannot be deleted while content is filed under it, so that content never falls open by accident.
- An invite link joins the System and, optionally, one campaign. A person who already has an account uses a link to join another campaign.
- Visibility can be set on an **entity**, a **group** or a **field**. A lower level inherits from its parent unless it overrides it, and may only narrow the audience, never widen it.
- Edit rights are separate from view rights. Defaults: the DM edits everything, and a player edits their own characters except fields marked DM-editable only.
- **Hard rule:** visibility is enforced on the server. Hidden data is removed before it is sent. The client never receives content it is not allowed to see. This applies to the sheet, search, the DM table, links, mentions and imports.

## 4. Features

### 4.1 Character sheets (and NPCs)
- The sheet is rendered from the schema: groups collapse and their state is remembered per user.
- **Sheet-wide search:** case-insensitive substring match over all visible labels and values, including rich text and table cells, with incomplete words matching ("fir" → "Fireball", "Wildfire").
  Results are highlighted, the view jumps to the first match, collapsed groups containing a match open, and the user can step through the matches.
- An NPC is a Character entity with `kind: npc` and the DM as its owner. Same sheet and same storage. It can be converted to and from a player character.
- **D&D 5e base schema:**
  - Identity (name, race/species, class & level, background, alignment, XP)
  - Abilities (STR–CHA with computed modifiers)
  - Saves & Skills (proficiency, expertise, computed totals)
  - Combat (AC, initiative, speed, HP current/max/temp, hit dice, death saves)
  - Attacks (table)
  - Features & Traits (list)
  - Proficiencies & Languages
  - Inventory (see 4.2)
  - Spellcasting (see 4.3)
  - Personality (traits, ideals, bonds, flaws)
  - Backstory & Notes
  - DM Notes (visibility: dm)

### 4.2 Inventory
- Character –owns→ Item links with quantity, equipped/attuned flags, container, notes and overrides.
- The inventory table shows the item fields you choose: weight, scarcity, price, type…
- Clicking an item opens its full sheet in a side panel within the same window, without leaving the character.
- Computed totals: carried weight, with optional encumbrance thresholds from the schema.
- Items come from a shared item library (entities of type Item), and one-off custom items are allowed.

### 4.3 Spellbook
- **Spell** entity with the full description and structured fields: level, school, casting time, range, components, duration, concentration, ritual, classes, source.
- **Spell table:** sortable columns, filters on any structured field, text search.
- **SpellList** entities hold custom lists (class lists, a homebrew "Spellplague-touched" list…).
- Character –knows→ Spell links store `known`, `prepared/memorized` and the source (class or feature). Slots are tracked on the sheet.
- Clicking a spell opens its description in the side panel, as with items.

### 4.4 World wiki
- WikiPage entities: rich text, categories/tags, hierarchy (parent page), `@mentions` of any entity, a "Mentioned in" backlink list.
- Visibility works per page and per block. Secret paragraphs are visible only to the audience they are set for.

### 4.5 Campaign
- Every list in the app (characters, notes, story) has a campaign filter: everything, one campaign, or outside campaigns. The filter only narrows what is shown; it is never a mode the DM has to switch.
- StoryBeat entities: title, summary, status (planned / in play / done / dropped), order, session number, links to involved entities.
- Campaign summary page, plus session logs (date, summary, beats touched).

### 4.6 DM summary table
- A saved view = the rows (all characters, a party, chosen NPCs) + the columns (field paths, e.g. `combat.hp.current`, `conditions`, `spell slots`).
- Each cell is the real field editor bound to the entity, so an edit there is the same edit as on the sheet. There is no copy to sync.
- Bulk actions: apply a value or delta to selected rows (e.g. −8 HP to the whole party, add the condition "Poisoned").
- Multiple saved views per DM ("Combat", "Travel", "Downtime").
- Open sheets update live when the table edits them, and the reverse.

### 4.7 Import
- **JSON:** upload → pick the target type → map source keys to schema fields (with automatic suggestions) → preview → import. Mappings are saved for reuse.
- **PDF:** text extraction → LLM-assisted structuring into the target schema → review screen where each record is approved, edited or rejected → import.
- Duplicate detection by name + source, with merge or skip.
- Imported content is DM-only by default.
- **Content note:** D&D 5e SRD content is available under CC-BY-4.0 and can be bundled as starter data. Other books should only be imported from PDFs the owner holds, for private campaign use.

### 4.8 Search (global)
- Substring and partial-word search across all entity names and text the user is allowed to see, with filters by type.
- Search matches both the English text and its Russian translation, whichever language the user reads in.

### 4.9 Glossary
- GlossaryTerm entities: the English term, its Russian translation, a definition, optional aliases (plural and other word forms).
- A field label, a select option or an entity name can point to a glossary term, so "Perception" is defined and translated in one place.
- In long texts, glossary terms are recognised automatically and shown highlighted. Hovering (or tapping on a phone) shows the definition, and for a Russian reader also the Russian translation.
- Inside a translated Russian text the term stays in English, with the Russian on hover.

### 4.10 Languages and translation
- Each user picks a reading language. Two are supported: English and Russian. English is always the source: all rules are written in English.
- **Short texts** (entity names, group and field labels, select options, glossary terms): a Russian reader sees the English with the Russian after it, "Perception (Наблюдательность)". An English reader sees only the English.
- **Long texts** (descriptions, wiki pages, story text): a Russian reader sees the full Russian translation instead of the English, with a switch to view the original.
- **Missing translation:** the English is shown with a small "not translated" mark.
- **Outdated translation:** when the English changes, its Russian is marked outdated until it is confirmed or updated.
- **Who translates:** the DM, in the app. For bulk work the app exports all untranslated and outdated texts with the Glossary to a file, Claude translates them in a session, and the file is imported back. Nothing is translated automatically.
- A translation has the same visibility as its source text.
- Text written by players (backstory, notes) is not translated and is shown as written.
- Buttons and menus of the app itself stay English for every reader, for now (decided 2026-11-16). Only content is bilingual.

### 4.11 Images
- An **image** field type with upload: portraits, item pictures, spell icons. Images are made outside the app (the owner generates them in ChatGPT) and uploaded.
- **Frozen:** generating images on the site and storing style documents with reference images. A ChatGPT subscription cannot be linked to another site; this would need a separate OpenAI API key billed per image. Revisit on the owner's request.

## 5. Phases

| # | Phase | Done when |
|---|---|---|
| 0 | **Foundation**: invite-link accounts, systems, members & roles, campaigns as a filter, parties, entity/link storage, change log, server-side visibility filter, full JSON export, nightly backup, deployed on the VPS | A DM and a player log in on the live server. The player cannot receive DM-only data through any endpoint (verified by tests). A player of one campaign cannot receive another campaign's content. An export can be re-imported as a new System. |
| 1 | **Character sheets**: base schema in code, all field types, groups, sheet modules and per-character custom fields, sheet search, NPCs, history and undo, phone layout, Chronica character import, image upload, language setting with translations of names, labels and long texts, Glossary terms on labels | A Russian reader sees "Perception (Наблюдательность)" on the sheet. The owner's real characters are imported from Chronica. The Warlock shows a talent tree where others show class progression. Search finds partial words and opens their groups. An edit can be reverted. |
| 2 | **Items & inventory**: item library, owns-links, side panel, weight totals | A character carries items, item stats show in the inventory, and items open in the side panel. |
| 3 | **Spellbook**: spells, spell table with filters, spell lists, known/memorized, glossary terms highlighted in long texts, translation batch export and import | A spell description reads in Russian with glossary terms on hover. A caster has a custom list with spells marked known and memorized. The table filters on level, school and class. |
| 4 | **Wiki & campaign**: rich text, mentions, backlinks, story beats, session logs, Markdown/Obsidian import (`[[links]]` become mentions, folders become the page hierarchy) | The owner's existing notes are imported. Pages link to each other and to characters. Secret blocks are hidden from players. |
| 5 | **DM summary table**: saved views, inline edits, bulk actions, live updates | An HP change in the table shows on the open sheet without a reload, and the reverse. |
| 6 | **Import UI**: JSON and CSV (Google Sheets) mapping screen; PDF if decided | The SRD spell list imports from JSON through the mapping screen. |
| 7 | **Later**: schema builder, crafting, VTT | Planned separately. |

**Status, 2026-11-16:** phase 0 is built in `X:\Campaign Manager\anybrew` and runs locally (see its README). Rebuilt the same day around Systems: the old top-level "campaign" became the System, and campaigns became a tag with a player group inside it. Done: invite-link accounts, Systems with a switcher, roles, campaigns with their wall, parties inside campaigns, entity and link storage, change log with undo, the server-side visibility filter with tests, JSON export and import, a backup command. Not done: deployment to the VPS and the scheduled nightly backup, both waiting for the server account and domain. The only entity type so far is a test "Note"; live updates are stood in for by a 10-second refresh until phase 5.

**Phase 1 progress, 2026-11-16.** Done:
- The Character type built from the Chronica stat groups, with formulas, tick boxes, pools, lists and tables; NPC as a kind of character; sheet search; sheet modules (Spellcasting, Sorcery, Class stats, Masks, Supplies, Talent tree).
- Rules section, with the proficiency bonus read from its rules table.
- Custom sections and fields on a single character (the home of limited abilities such as Bardic Inspiration).
- Talent tree: loaded by pasting the text of the Obsidian note (the note stays the master copy), shown per patron and tree with taken, can-be-taken and locked talents, PP spent against the total, prerequisite and same-Contract-level warnings; the player marks talents, balance notes stay DM-only. Drawn as cards per tree, not yet as a graph with connecting lines.
- Russian reading language per user: Russian names and labels after the English, long texts shown in their Russian translation with a switch to the original, "not translated" and "outdated" marks; the DM writes translations in the sheet.
- Glossary section: a term with its Russian form and definition; a sheet label that is a glossary term shows the definition on hover.
- Image upload (portrait), served only to people who may see the field.
- Rich text (headings, bold, lists, quotes, tables) for descriptions, secrets and rule texts, cleaned on the server.

- Chronica import, run once on 2026-11-16 by the conversion script (`npm run import:chronica -w server`, source in `server/src/import/chronica.ts`): 14 characters with their stats, 88 features, 32 spells, 67 items, 3 notes, and 193 links from characters to their features, spells and items; Elara's talent tree loaded from the note. The report of what was converted and how is `Import report.md` in `Chronica Exports`.
- To hold the imported library, the first small versions of three later types were added early: Features, Spells and Items sections, and a panel on the character sheet listing its features (by library section and level gained), spells (by circle) and items (with quantity), each opening its own page. Items get their inventory screen in phase 2 and spells their full 25 properties in phase 3.
- The character sheet gained Disposition, Money ($) and the kind of Hit Dice.

**Folder-like structure, 2026-11-16 (ordered by the owner after phase 1).** Done:
- Characters are PC, NPC or Aux (a barely-named background character), chosen at the top of the sheet next to the campaigns. The character list is filed by campaign, then by PC / NPC / Aux; a character of several campaigns is listed under each.
- A feature has a Type (free text: Class feature, Feat, Maneuver, Origin…) and a Class instead of the single Category. The 88 imported features were converted (`npm run convert:feature-types -w server`).
- The Features section is a table in the style of 5e.tools: search, filters by type, class and character, sorting by any column, the chosen feature open beside it. A "Folders" switch shows Class features → class → features, with every other type as its own folder. Characters are added to and removed from a feature on the feature's page.

- Classes from the Rules section. A rules document with the "Class" section attached is a class: hit die, saving throw, armor, weapon and tool proficiencies, skills, subclasses, and its Table as the class table (first column: level). Its features are the features of the library whose Type is "Class feature" and whose Class is the document's name; a feature may name a Subclass.
- A class arrives as a class file: Claude converts the PDF handbook to JSON in a session (format: `classFile` in `server/src/classes.ts`), and the DM brings it in with "Import a class file…" on the Rules tab. A review screen shows the hit die, saves, table size, subclasses and every feature before anything is saved; single features can be left out; importing the same file again updates instead of doubling. A class can also be made by hand: add a rule and tick "Class".
- A character has a list of classes, each with a subclass and a level. Choosing them sets the Level (the sum) and the Hit Dice every time, and fills the saving throw, armor, weapon and tool proficiencies of the first class once, when that class is chosen; each is a logged change that can be undone and edited afterwards. The sheet shows the line of the class table for the level, and lists the class features up to that level under Features, marked "from class".

Not built from this order: PDF upload inside the app (the owner chose conversion in a session); class table values are shown, not yet fed into sheet fields such as spell slots; the free-text Class field on Identity is still there next to the class list.

Phase 1 is complete. Open after the import: characters have no owners yet (the export has no player names; the owner sets them when players have accounts); items that belong to one character are DM-only until then; 12 English item names in `English names - added at import.md` wait for approval; the names of bags inside inventories were not in the export. Not built and not in phase 1: glossary terms highlighted inside long texts and the bulk translation export (both phase 3). Uploaded pictures were not part of the JSON export or the backup command; added 2026-11-18 (task F3, see the Backups row in section 8).

Phases 0 and 1 carry most of the technical risk. Everything after them reuses the same entity, link and visibility code.

## 6. Design constraints for the "later" features

- **Schema builder:** schemas are already data, so the builder needs no change to storage. Schema versioning (adding, renaming or removing fields on existing entities) is needed from phase 1.
- **Crafting:** recipes are entities linking inputs → outputs. This fits the Link model.
- **VTT:** tokens are links to entities, so HP and conditions on a token are the sheet values. This needs real-time sync (WebSockets), which phase 5's live updates should already introduce.

## 7. Open decisions

- **VPS and domain:** proposed Hetzner Cloud, Helsinki, smallest shared server; the domain will be based on the name AnyBrew, exact address still to be chosen. The owner pays with a Georgian card; players are in Georgia, Latvia, France and Russia. The player in Russia uses a VPN, so blocking of foreign hosts is not a concern. **Development starts local:** the app runs on the owner's PC until the owner creates the server account and buys the domain; deployment is the last step of phase 0 and does not block phase 1.

Answered 2026-11-16:
- `(+)` after a talent name means "taken".
- The talent trees belong to Elara only. Trees are stored per character, not as a shared library.
- The app replaces the published Obsidian site. No Obsidian folder is imported as the wiki for now; the owner will create a dedicated folder for it later.

## 9. Existing data (samples read 2026-11-16)

### Sources
- **Chronica:** `X:\Campaign Manager\Chronica Exports`, 15 JSON files, one per section. With content: 14 characters (6 filled in, 8 nearly empty), 8 players, 47 library items, about 80 abilities in 14 types, 14 stat groups, 1 note, 2 maps. Quests, places, shops, encounters and plots are empty.
- **Obsidian spells:** `X:\Abyss\D&D Faerun Reboot\Rules & Homebrew\Personal Homebrew\SpellCompendium`, 10 spells, schema in `_Schema\Spell.md` (25 properties). `_Schema` also holds Component and Quality, the crafting types.
- **Obsidian talents:** `X:\Abyss\D&D Faerun Reboot\Campaign-specific\Heart of Anauroch\Devil Contract\Elara - Talents.md`.
- **Google Sheet:** an older spell table, 4 rows, 16 columns.

### Decisions
- **Obsidian stays the master for rules for now.** The app re-imports a folder on demand and updates what changed; imported rules are read-only in the app until the owner switches the master to the app. Character data lives only in the app.
- **Chronica is imported once,** by a conversion script that Claude runs, with no import screen. The volume is too small to justify one.
- **Every name gets an English form,** characters included. `Light / Свет` is split into the English name and its Russian translation. For Russian-only names Claude proposes the English and the owner approves the list before import.
- **Spell conflicts** between Obsidian, Chronica and the Sheet are resolved by the owner one by one, in a review list.
- **Talent tree:** the player sees every tree with descriptions, types, prerequisites and PP costs. Balance notes stay DM-only.

### What the samples change
- **Spell schema** is the owner's 25 properties (circle, school, domain, available to, l33tness, scarcity, legality, access tier, casting time, drop effect, result template, caster check, dodge/parry, scroll cost, status…), not the standard 5e list in 4.3. The saved table views in `Spell Compendium.base` (All spells, By level, Drafts to assess) become the first saved views of the spell table.
- **Schemas import too.** Obsidian's Metadata Menu field types map one to one: Number, Select, Multi → multi-select, Boolean, Input → text, MultiFile → reference. The app's schemas for Spell, Component and Quality are generated from the `_Schema` notes, not retyped.
- **The base character schema** is taken from Chronica's 14 stat groups (Primary Stats, Equipment, Spells Known, Proficiencies, Class Stats…), not from the generic 5e list in 4.1.
- **Features are entities.** Chronica abilities are a shared library that characters link to, with a tier prefix (`[3]`) and tags. They become Feature entities with Character –has→ Feature links, not a list on the sheet.
- **Spells are scattered in Chronica:** as library items, as abilities, and as text typed into "Spells Known" stats. The conversion turns all three into Spell entities and `knows` links.
- **Per-player secret text is the main content.** `personal_secrets` holds up to 49,000 characters per character and maps to visibility "this player + DM". `gm_secrets` maps to DM-only.
- **Text clean-up.** Chronica text is HTML pasted from Google Docs with inline styling. The conversion keeps headings, bold, lists, tables and links and drops the rest.
- **Stats are typed text** ("16", "+3"). The conversion parses them to numbers and drops hand-typed modifiers where a formula computes them.
- **Talent tree needs:** trees grouped by patron; a talent has a type (Minor / Major / Milestone), a PP cost with halves, a tier, a description and a taken mark; prerequisites are "A", "A and B", or "any N talents of this tree"; the rule "an upgrade and its prerequisite cannot be taken on the same Contract level", so each taken talent records the Contract level; a points total (60). Next to the trees are levelled tracks (Protection Protocol, Communication Protocol).
- **Money** is a decimal amount in "$" (player wealth, party wealth, prices).
- **Crafting is already designed** in Obsidian (Components, Qualities, Crafting rules), so its entity types can be imported early even though the crafting screen stays in "later".

## 8. Stack (approved 2026-11-16)

One language, TypeScript, on the server and in the browser, because the owner does not read code and this gives the most ready-made parts and one set of tests.

| Part | Choice | Why |
|---|---|---|
| Browser UI | React + Vite, Tailwind CSS | Largest choice of ready parts; works on phones with a responsive layout. |
| Rich text | TipTap | Supports `@mentions` and a per-block attribute, which is what secret blocks need. |
| Tables | TanStack Table | Spell table, inventory and DM summary table: sorting, filters, editable cells. |
| Server | Node.js + Fastify, tRPC, Zod | One process. Every read passes through one visibility filter. Types are shared with the UI, so a renamed field fails the build instead of failing at the table. |
| Database | SQLite (one file) with Drizzle | Enough for 15 users. A backup is a copy of one file. Entity documents are stored as JSON. Substring search uses the built-in trigram index. |
| Live updates | WebSocket in the same server (phase 5) | Sends change-log entries to open sheets. The future VTT uses the same channel. |
| Login | Own invite links and sessions, argon2 password hashing | No third party and no email service. |
| Hosting | VPS with Docker and Caddy | Caddy provides HTTPS automatically. Needs a domain name. |
| Backups | Nightly copy of the database file to off-server storage, plus the export. Pictures (decided and built 2026-11-18, F3): the backup command copies each new picture once into one shared `backups/uploads` folder, never pruned, so every database copy finds its pictures. The export is a ZIP with `export.json` and every picture of the System, replaced ones included so an undo still finds them; a "without pictures" option gives the plain JSON file. Import gives pictures new ids. | Two independent ways back. |
| Tests | Vitest for the server, Playwright for the browser | The visibility tests log in as a player and check that hidden data never arrives. |

**Alternative considered:** PostgreSQL instead of SQLite. It handles many simultaneous writers better, but adds a second service to run and back up. Not needed at this size; moving later is possible because all database access goes through Drizzle.

## 10. Character UX rework and Player Requests (decided 2026-11-17; U1, U2 and U3 built 2026-11-18)

Ordered by the owner on 2026-11-17. The server step (U1), the character list (U2) and the focused sheet (U3, both steps: page menu, page addresses, feature split, Sheet settings, search counts per page, header with the framed portrait and a d20 divider, first versions of Home and Preview, the gallery screen) are built; Player Requests (U4) are not. The owner's check of U3 is task U3c. The owner's answers to the open questions are in 10.7; the tasks are U1 to U10 in `TODOs.md`.
It concerns characters only for now. Other sections (Features, Spells, Items…) keep the current list-beside-editor layout and may follow later.

### 10.1 Two levels: list, then sheet

- **Level 1, the character list.** "Characters" in the navigation opens a full-width page of cards. Nothing is opened beside it.
  - Tabs: **All, PC, NPC, Aux**, each with its count. A character with no kind counts as PC when a player owns it, otherwise as NPC (the rule of today).
  - **Tag filter:** every character has free-text tags ("Cormyr"). The page shows the tags in use as chips; ticking chips narrows the list to characters that have all ticked tags.
  - The campaign filter of today stays (Everything, one campaign, Outside campaigns). A name search box is added.
  - **Card:** portrait (the main one), name (bilingual), allegiance. The DM chooses the further card fields for everyone in the System: race, class, level, kind, status, disposition, owner, campaign, tags.
  - **Filter settings are each viewer's own:** the chosen tab, tags, campaign and search are remembered per viewer in their browser.
  - "New character" stays on this page; the new character opens in its sheet.
  - The folders by campaign and kind of today are removed.
- **Level 2, the character sheet.** Clicking a card opens the sheet with full focus:
  - The section navigation of the site is replaced by one "← Characters" button. There is no list of other characters and no way to another character except through the list.
  - A **menu on the right** switches between the pages of the sheet (10.2). On a phone the menu is a drop-down at the top.
  - Each page has its own address (`/characters/<id>/<page>`), so Back, reload and a shared link land on the same page.
  - The sheet search stays at the top. It marks matches on the open page and shows the number of matches next to every other page in the menu.
  - A page that holds nothing the viewer may see is not in their menu (DM Secrets for a player; Character Secrets and Char Notes for another player).

### 10.2 Pages of the sheet

| # | Page | Content | Comes from |
|---|---|---|---|
| 1 | Home | A summary. Stores nothing, draws from the other pages. Designed later. | First version: portrait, name, class and level, HP, AC, the six abilities, tags. |
| 2 | Preview | The character as other players see it: the outside information only. Designed later. | First version: portrait, name, allegiance, race, Open Character History. It is the only thing other players receive, from step U1 on. |
| 3 | Basic Info | Name and Russian name, portrait gallery with a main portrait, race, background, class and subclass, age, height, weight, alignment. Also: gender, allegiance, disposition, status, kind, campaigns, tags. | Identity group; the class list moves here; Background, Tags and the gallery are new. |
| 4 | Stats | The 6 attributes, the 6 saves, secondary stats (speeds, encumbrance, passive perception), Level, Proficiency Bonus, Inspiration, weapon/armor/tool/language proficiencies. | General Stats, Primary Stats, Saves, part of Secondary Stats, Proficiencies. |
| 5 | Skills | Skills and their values only. | Skills group. |
| 6 | Class Abilities | Class features of the character's classes (linked and "from class"), and the class modules: Talent tree, Class stats, Sorcery, Masks. | Features panel (class features without a subclass) and modules. |
| 7 | Subclass Abilities | Features given by the subclass. | Features panel (features that name a subclass). |
| 8 | Hero Abilities | Everything the DM gave on top of the class: feats, origins, special abilities, and the custom sections of this character. | Features panel (all other feature types), custom sections. |
| 9 | Inventory | Equipment, Supplies, Money and Items. | Equipment group, Supplies module, Items panel. |
| 10 | Spells Known | Known spells, spell slots, spell stats. The rules for spells per day and binding memorized spells are designed with phase 3 (tasks S2 to S4); the page may split into several. | Spellcasting module, Spells panel. |
| 11 | Progression History | What was chosen at which level-up and between levels. A hand-filled table first; recorded automatically in step U8. | New. |
| 12 | Open Character History | What the player wants others to know. | The Description field. |
| 13 | Character Secrets | What the player knows and hides from others. Seen by the owner and the DM. | Personal Secrets group. |
| 14 | DM Secrets | What the player does not know. Seen by the DM only. | DM Secrets group. |
| 15 | Char Notes | Free notes, seen by the player and the DM. | The Notes field, which becomes owner-and-DM only (today everyone who sees the sheet sees it). |
| 16 | Combat | All combat stats and modifiers. Its own stats: death saves, an Attacks table and a list of combat modifiers. It also shows AC, HP, hit dice and initiative, which stay stored in Secondary Stats (page 4): one value shown in two places. Seen by the owner and the DM. | Death Saves; Attacks and modifiers are new; the rest is shown from Secondary Stats. |

The DM's sheet controls (owner, who can see the sheet, sheet modules, history, delete) go to the bottom of Basic Info under "Sheet settings".

### 10.3 How it is stored

- **Pages are schema data.** The Character type gets a list of pages (key, label, order), and every top-level group names its page. Modules name the page of their groups; custom sections go to Hero Abilities. Field ids do not change, so no stored value moves and the change log stays valid. A type without pages (Feature, Spell, Item, Rule, Note) renders as today.
- **Visibility is unchanged and stays on the server:** pages are a layout, not a permission. A page shows only the groups the server sent.
- **A page can show fields that live on another page.** The page lists their ids; the value is stored once, and the audience of the field's own group decides who receives it.
- **Tags:** a list field on the character that only the DM edits. The list endpoint sends them with the other card values, filtered like every other field.
- **Card fields:** the DM's choice of card fields is stored on the System, one choice for everyone. The character list endpoint sends the values of the chosen fields of each character, only where the viewer may see the field.
- **Allegiance** is the existing Faction field under a new label; its stored values stay.
- **Portrait gallery:** a new field type holding several uploaded pictures. The existing Portrait field stays and holds the picture chosen as main, so cards, Home and Preview read one field. A picture uploaded earlier becomes the first picture of the gallery. A picture is served to a viewer only while a field they may see holds it, so the main portrait reaches other players and the rest of the gallery does not. A gallery holds 30 pictures at most.
- **Progression History:** first version is a table on the sheet (Level, When, What was chosen), filled by hand.

### 10.4 Player Requests

- A "Requests" button in the main navigation, with a count of requests that wait for the reader.
- A player writes a request: a subject and a text. The DM sees it, answers, and marks it resolved when the matter is settled. Both can write further messages while it is open.
- Two folders for both sides: **Open** and **Archive** (resolved).
- A player sees only their own requests. A DM sees the requests of all players of the System, with the player's name.
- **Storage:** a `requests` table (System, the player it belongs to, subject, status, dates) and a `request_messages` table. A request belongs to its player's account inside one System. Requests are not entities: they have no schema, no sheet and no audience. They are part of the JSON export and import of a System.
- **Count in the navigation:** for the DM, open requests whose last message is from the player; for the player, open requests whose last message is from the DM. No "read" marks are stored.

### 10.5 What changes for existing behaviour

- The Characters tab no longer shows a list beside an open character.
- Notes on a character become owner-and-DM only.
- AC, HP, hit dice and initiative stay in the "Secondary Stats" group. The Combat page shows the same fields, so an audience set on Secondary Stats covers them in both places.
- Everything on a character except the Preview becomes owner-and-DM only (today everyone who sees the sheet sees all of it except the secrets). Another player who may see the character receives the portrait, name, allegiance, race, Open Character History and the kind (PC, NPC, Aux) that sorts the list. The DM can still open a group or field on one character.
- The features, spells and items of a character, and its class details, are sent to its owner and the DM only. "Who has this feature" in the library lists names only the viewer's own characters, and all of them for the DM.
- The browser tests of the character sheet are rewritten for the new navigation.

### 10.6 Build order

| Step | Content | Task |
|---|---|---|
| 1 | Server: pages in the schema, regrouped character schema, tags, background, gallery field type, the DM's card field choice on the System, card values in the list, everything except the Preview closed to other players, server tests. The old screen keeps working after this step. | U1 |
| 2 | Character list: tabs, tag filter, cards, the DM's card field choice, filter settings remembered per viewer. | U2 |
| 3 | Focused sheet: right-hand menu, pages, search across pages, first versions of Home and Preview, rewritten browser tests. | U3 |
| 4 | Player Requests: tables, endpoints, export and import, screen, tests. | U4 |
| Later | The owner's design of the Preview page, Home, Spells Known, automatic Progression History, Combat details. | U5 to U9 |

### 10.7 Decisions (owner, 2026-11-17)

1. **Preview:** other players receive only the Preview of a character, with everything else closed to them on the server. First planned as a later step (U5); moved into U1 by the owner on 2026-11-18. U5 keeps the owner's design of what the Preview holds.
2. **Allegiance** is the Faction field renamed.
3. **Page 9 is Inventory.** The owner called it really important.
4. **Card fields are chosen by the DM for everyone. Filter settings of the list are each viewer's own.**
5. **Progression History:** a hand-filled table now, automatic recording later (U8).
6. **Tags** are edited by the DM only.
7. **Requests:** a thread where both sides write several messages; only the DM resolves a request, and can reopen it; a request does not name a character for now.
8. **Full focus** means the site navigation is hidden inside the sheet, with one "← Characters" button instead.
9. **Placement, for now:** Proficiencies on Stats; Talent tree, Class stats, Sorcery and Masks on Class Abilities; custom sections on Hero Abilities; Supplies on Inventory.
10. **Combat page (2026-11-18):** it stores only its own stats; AC, HP, hit dice and initiative stay in Secondary Stats and are shown on Combat as the same values, not as copies.
11. **Owner and DM only (2026-11-18):** every page except the Preview is seen by the character's owner and the DM only.
12. **List order (2026-11-18):** PC first, then NPC, then Aux; alphabetical by name inside each. On the All tab each kind has a small heading. The tab counts follow the campaign, tag and search filters. The DM picks the card fields with a "Card fields…" button on the list page.
13. **Edit across sheet pages (2026-11-18):** every page of the sheet opens in Read mode, also when Edit was on for the page before it. This narrows 11.8 for the character sheet.
14. **Sheet header (2026-11-18):** a compact header above every page: the main portrait in its brass frame, the name, the quiet kind line, and a d20 divider under it. Home shows its larger summary below the header.
15. **First page (2026-11-18):** the sheet opens on Home for the owner and the DM, and on Preview for another player (the only page they receive).
16. **U3 in two steps (2026-11-18):** step 1: full focus with the "← Characters" button, the right-hand menu (a drop-down on a phone), an address per page, the feature panel split into class / subclass / hero, "Sheet settings" at the bottom of Basic Info, the rewritten browser tests. Step 2: search with match counts per page, first versions of Home and Preview, the gallery screen, the header frame and the d20 dividers. The owner checks the app after each step.

### 10.8 Model

Per the rating rules in `TODOs.md`: steps 1 and 4 touch the schema model and storage and go to **Fable 5.2**; steps 2 and 3 are screen work on a settled server and go to **Opus 5.5 (medium)**. U5 changes visibility and goes to Fable 5.2.

## 11. Look and theme: Slate & Brass (decided 2026-11-17; switch, restyle, Read / Edit modes and step 3 built 2026-11-18)

The owner chose the **Slate & Brass** direction from the "AnyBrew Look Book" page (https://claude.ai/artifact/1i94FWp71kWs5kvnB3wQur), with every small touch from that page except a separate colour per System. The site also gets a light / dark switch so both modes can be compared.

### 11.1 Light / dark switch (built first, on today's look)

- Three choices in the header, next to the language and log-out controls: **System** (follows the device, the default), **Light**, **Dark**.
- The choice is kept **per device** in the browser, not on the account: a phone used in daylight and a PC used in the evening may want different modes. The language setting stays on the account as before.
- A short script in `web/index.html` sets the mode on the page before the app loads, so the page never flashes the wrong colours. With "System" the page follows the device when its setting changes.
- Tailwind's `dark:` styles are switched from the device setting to this page setting (`data-theme` on the page root).
- This step ships alone, on the current stone-and-blue look, so the owner can check light and dark before the restyle.

### 11.2 Colours as named tokens

Today the components name raw Tailwind colours (about 136 `stone` and 30 `sky` uses in 14 files), each with its own `dark:` twin. They are replaced by named colours that change with the mode, so each component names a colour once:

| Token | Use | Light | Dark |
|---|---|---|---|
| `bg` | page background | `#eff1f4` | `#161920` |
| `surface` | cards, sheet groups, inputs | `#ffffff` | `#1e222b` |
| `surface-2` | group headers, hover | `#e7eaef` | `#262b36` |
| `line` | borders, rules | `#cfd4dc` | `#363c4a` |
| `fg` | text | `#1f2430` | `#e6e8ee` |
| `muted` | secondary text, labels | `#5b6273` | `#949bab` |
| `accent` | brass: main buttons, active tab, ticks, rules | `#96681f` | `#d4a656` |
| `accent-ink` | text on brass | `#ffffff` | `#1a1408` |
| `bar` / `bar-fg` | top bar, dark slate in both modes | `#1f2430` / `#e6e8ee` | `#0f1116` / `#e6e8ee` |
| `secret` | tint of DM-only rows | brass at 6 % | brass at 7 % |

Danger (red), success (green), the search highlight (yellow) and the "outdated" mark keep their own colours. The "outdated" mark must not be confused with brass, so it gets an icon as well as its colour.

### 11.3 Fonts

- **Source Sans 3** for all running text, tables, inputs and buttons (has Cyrillic).
- **Marcellus SC** (engraved capitals) for the app name, character and entity names, page titles, sheet group headers and the six ability scores. Nowhere in tables or long text.
- **Correction to the look book:** Marcellus SC has **no Cyrillic letters**. The Russian half of a heading ("Inventory (Инвентарь)") needs a second font, named right after Marcellus SC so the browser uses it for Russian letters only. Forum was tried and rejected as hard to read (2026-11-17). The earlier look book samples had a bug and all showed Georgia; they were fixed the same day. Six options are on the look book page ("Russian headings"): **C** Georgia bold (system font, missing on Android), **D** PT Serif bold, **E** Cormorant SC, **F** Bona Nova SC, **G** Spectral SC (closest match in weight and width; proposed), **H** Tenor Sans in small capitals made by the browser. **Decided 2026-11-18: G, Spectral SC** (weight 500), served from our own server like the other fonts.
- The fonts are installed as packages (`@fontsource`) and served from our own server. No request goes to Google.

### 11.4 Shapes and the top bar

- The top bar is dark slate in both modes, with a thin brass line under it. The active tab is marked by a brass underline instead of today's filled blue button.
- Corners are smaller: 4 px for cards and groups, 3 px for buttons.
- Sheet groups get a 2 px brass line along their top edge.
- Buttons, labels and tabs stay in normal case; only Marcellus SC headings are capitals.

### 11.5 Small touches

| Touch | What it does | Where and when |
|---|---|---|
| **d20 mark** | A thin-line d20 drawn as our own small SVG. Used as the logo mark next to the System name, as a divider between the main parts of a sheet, and in empty lists ("No items yet"). | Logo and empty lists with the restyle; sheet dividers with the sheet rework (U3). |
| **DM-only style** | For the DM, anything players cannot see (an entity, a group, a field, a list row) gets a faint brass tint, a dashed outline and a small chip saying who can see it: "DM only", or the names from the visibility setting ("Anna, Party 2"). Players never see the chip, and the hidden data still never reaches their browser. | With the restyle. Lists may need the visibility setting sent with each row (to the DM only). |
| **Rarity colours** | A coloured mark beside item names: Common grey, Uncommon green, Rare blue, Very rare purple, Legendary orange-gold, Artifact red. | **On hold (owner, 2026-11-17).** Rarity is not the same as the Scarcity column in I2. Nothing is built until the owner returns to it. |
| **Portrait frames** | Portraits get an engraved square frame: a thin brass line set just inside the edge. A character without a portrait shows the first letter of their name in Marcellus SC in the same frame. | Character cards built in U2; sheet header in U3. |
| **Login page** | The only page with a full background: a dark slate stone texture drawn in CSS with a small brass-framed card on it. **Later: an artwork carousel** (owner's wish): the DM's chosen pictures fill the background and change every few seconds, with a title on each. The login page is open to anyone with the address, so carousel pictures are marked for it on purpose, stored apart from other uploads and served without a login; no other upload becomes public. | Stone texture with the restyle (V3); carousel as its own task (V7). Both are shown on the look book page ("Login page"). |
| **Section icons** | One thin-line icon per tab: Characters, Features, Spells, Items, Rules, Glossary, People, Data (from the Lucide icon set, free licence). On a phone the tab labels drop and the icons stay, with the label as a tooltip. | With the restyle. |
| **Spell school colours** | A small coloured dot per school of magic in spell lists and on the spell page. | Spells have no School field yet. It comes with the 25 spell properties (S1) and is shown in the spell table (S2). The colours are chosen in this step. |

**Not now:** a separate accent colour per System. The owner will work with a single System for a long time; it is in "Frozen".

### 11.6 Order of work

| Step | Content | Task |
|---|---|---|
| 1 | Light / dark switch on today's look; browser test that the choice survives a reload. | V1 |
| 2 | Tokens, fonts, shapes and top bar: every component moved to the named colours. Owner checks on PC and phone, in both modes and with Russian reading on. | V2 |
| 3 | Section icons, d20 logo and empty lists, login page. | V3 |
| 4 | DM-only style, with a browser test that the chip shows for the DM and not for a player. | V4 |
| 5 | Login artwork carousel. | V7 |
| On hold | Rarity field and colours. | Frozen |
| Inside U2 / U3 | Portrait frames on cards, d20 dividers on the sheet. | U2, U3 |
| Inside S1 / S2 | Spell school field and dots. | S1, S2 |

**Step 3 (V3), built 2026-11-18.** The section icons come from the Lucide icon package (`lucide-react`, free licence); the d20 is our own drawing: Characters (people), Features (medal), Spells (wand), Items (backpack), Rules (scroll), Glossary (open book), Notes (notebook), People (contact card), Data (database). Below the tablet width the labels drop; the label stays the link's name and its tooltip, and the nine icons fit on one line of a 390 px phone. The d20 stands beside the System name and above the empty-list message of the section lists and the character list; small lists inside a page (links, fields) stay plain text. The login, first-setup and invite pages share the stone texture: one large drawing over the whole page (a repeated tile showed seams), dark in both modes, with the card in the page's mode.

**Overlap with the character rework (section 10).** U2 and U3 rebuild the character list and sheet. The restyle comes first, because the named colours and fonts then carry into the rebuilt screens for free. Touches that belong only to the list and the sheet are built inside U2 and U3 so they are not made twice.

### 11.7 Open questions (2026-11-17)

1. **Rarity or Scarcity?** Answered 2026-11-17: not the same thing. Rarity colours are on hold; nothing is built for now.
2. **Cyrillic headings.** Answered 2026-11-18: Spectral SC (option G).
3. **Login picture.** Answered in part 2026-11-17: the owner wants an artwork carousel later (V7). Answered 2026-11-18: the stone texture is fine for now.

### 11.8 Read and Edit modes (decided and built 2026-11-18)

Every entity page (characters, features, spells, items, rules, glossary, notes) has two modes, so a page is easy to read:
- **Read** (the default): names, numbers and texts are plain text; long texts are shown formatted; empty fields are hidden, and a group with nothing filled in shows one faint line "Nothing filled in". Kind, campaigns and owner are one quiet line under the name. The DM sees who can see the page ("Seen by: …") but no visibility buttons.
- **Edit**: the full editor as before, with every field, the visibility buttons, owner, kind, campaigns, sheet modules, custom sections, adding and removing links, translations and Delete.
- An **Edit** button at the end of the search bar switches over; it becomes **Done** to go back. It shows only to people who may change something on the page.
- Counters stay usable in Read mode: tick boxes, pips, pools and talent picks, so a sheet can be played without switching to Edit.
- Every page opens in Read. A page just created opens in Edit. Edit stays on until another page is opened.

## 12. Spells section like the Features section (decided 2026-11-18, not built)

The owner wants the Spells section to work the same way as the Features section: the list of spells on the left as a **table or folders**, the full spell on the right (in Read mode by default, section 11.8).

- **One browser for both.** The feature browser (search, filters, sortable table, folder view, "Table / Folders" switch remembered per browser) becomes one shared library browser, set up per section: which columns, which filters, how folders are grouped. Features keep exactly what they have today.
- **Spells, with today's fields:**
  - Table columns: Name, Circle (0 shown as "Cantrip"), Casting, Characters (who has the spell).
  - Filters: Circle, Casting, Character; text search over name, Russian name, tags and summary.
  - Folders: by circle ("Cantrips", "1st circle", "2nd circle"…), spells sorted by name inside.
  - The wide left column of the Features section.
- **When the 25 spell properties arrive (S1),** School and the class lists are added as columns, filters and a second way to file folders (by school). The spell table task (S2) then adds filters on the other properties and the saved views from `Spell Compendium.base`, on top of this browser.
- **Later, if the owner asks:** the same browser for Items (weight, scarcity, price, type) and Rules.
