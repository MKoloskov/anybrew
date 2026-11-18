# AnyBrew Campaign Manager

The plan, decisions and phases are in `website docs\PLAN.md`. This file only says how to run what exists.

## Run it on this PC

Double-click **Start AnyBrew.bat**. It starts the app and opens http://localhost:5173.
Close the black window to stop it.

The first visit shows a one-time setup screen that creates the DM account and the first System.
A System is one rule set with all its content; **+ System** in the header adds another (for a different game).
Campaigns are made on the People tab. A campaign is a group of players and a tag on content, not a separate place.

To try it as a player on the same PC, create an invite link on the People tab and open it in a
private (incognito) window, so the two logins do not share a session.

## Where the data is

Everything is in one file: `server\data\anybrew.db`. Deleting it resets the app to first-run setup.

- **Pictures:** uploaded images are files in `server\data\uploads`.
- **Backup:** `npm run backup` writes a timestamped copy of the database to `server\data\backups` and keeps the newest 30. It also copies every new picture into `server\data\backups\uploads`; that folder is shared by all copies and never pruned. To restore: stop the server, put the chosen copy back as `server\data\anybrew.db` (delete `anybrew.db-wal` and `anybrew.db-shm`), and copy `backups\uploads` into `server\data\uploads`.
- **Export:** the Data tab downloads the whole System. With "Include pictures" (the default) it is a ZIP file holding `export.json` and every uploaded picture of the System; without, it is one JSON file. Either can be imported as a new System; a JSON file brings no pictures.

## Checks

| Command | What it proves |
|---|---|
| `npm test` | Server tests: accounts, invites, the change log, export/import, that a player cannot receive hidden data through any endpoint, and that campaigns and Systems stay closed to outsiders. |
| `npm run test:browser` | A real browser plays a DM and two players of different campaigns through setup, invites, a note with secret parts, the campaign wall, history and undo. Screenshots land in `e2e\screenshots`. |

## Layout

- `server\` — the API, database and visibility filter. `src\visibility.ts` is the one place that decides what a viewer may see.
- `web\` — the browser app.
- `e2e\` — browser tests.
