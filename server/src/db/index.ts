import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';
import { migrateSchemas } from '../schemas/migrate';
import * as schema from './schema';

export type DB = ReturnType<typeof openDb>;

const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

/** Opens the database and migrates its tables and its stored data. Pass ':memory:' for tests. */
export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const opened = Object.assign(db, { sqlite });
  try {
    migrate(db, { migrationsFolder });
    // After the tables, the stored data: every System is brought up to the schemas in the code.
    migrateSchemas(opened, file);
  } catch (e) {
    sqlite.close();
    throw e;
  }
  return opened;
}

export { schema };
