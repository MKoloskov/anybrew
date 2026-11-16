// Copies the live database to data/backups with a timestamp and keeps the newest 30 copies.
// Safe to run while the server is running: SQLite's backup API takes a consistent snapshot.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const KEEP = 30;
const dbFile = process.env.DB_FILE ?? path.resolve(import.meta.dirname, '../data/anybrew.db');
const dir = process.env.BACKUP_DIR ?? path.join(path.dirname(dbFile), 'backups');

if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `anybrew-${stamp}.db`);

const db = new Database(dbFile, { readonly: true });
await db.backup(target);
db.close();

const old = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith('anybrew-') && f.endsWith('.db'))
  .sort()
  .reverse()
  .slice(KEEP);
for (const f of old) fs.unlinkSync(path.join(dir, f));

console.log(`Backup written: ${target}`);
