// Schema versioning from the command line (see schemas/versions.ts).
//   npm run schema:check  -w server   what changed in the schemas since the accepted snapshot, and what it needs
//   npm run schema:accept -w server   store the schemas as the new snapshot (refused while something is missing)
//   npm run schema:audit  -w server   look through the database for data no schema knows; changes nothing
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { effectiveSchema, getSchema, listModules } from './schemas';
import { checkSchemas, fingerprint, type Snapshot } from './schemas/fingerprint';
import type { SchemaGroup, SchemaNode } from './schemas/types';
import { currentSchemaVersion, schemaMigrations } from './schemas/versions';

export const SNAPSHOT_FILE = path.resolve(import.meta.dirname, 'schemas/snapshot.json');

export function readSnapshot(): Snapshot | null {
  return fs.existsSync(SNAPSHOT_FILE) ? (JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) as Snapshot) : null;
}

function check(accept: boolean) {
  const result = checkSchemas(readSnapshot(), fingerprint(), schemaMigrations);
  if (result.errors.length) {
    console.log(`The schemas changed in a way that needs a migration in schemas/versions.ts (${result.errors.length}):\n`);
    for (const e of result.errors) console.log(`- ${e}\n`);
    process.exit(1);
  }
  if (result.upToDate) return console.log(`Schemas match the snapshot (version ${currentSchemaVersion()}). Nothing to do.`);
  if (!accept) {
    console.log('The schemas differ from the snapshot and need no further migration. Run: npm run schema:accept -w server');
    process.exit(1);
  }
  // One node per line, so a change to the schemas reads as a short diff.
  const text = JSON.stringify(result.next, null, 1).replace(/\{\s*"k":[^{}]*\}/g, (node) => JSON.stringify(JSON.parse(node)));
  fs.writeFileSync(SNAPSHOT_FILE, `${text}\n`);
  console.log(`Snapshot written at version ${result.next.version}: ${SNAPSHOT_FILE}`);
}

function audit() {
  const dbFile = process.env.DB_FILE ?? path.resolve(import.meta.dirname, '../data/anybrew.db');
  const db = new Database(dbFile, { readonly: true });
  const idsOf = (groups: SchemaGroup[]) => {
    const out = new Set<string>();
    const walk = (nodes: SchemaNode[]) => nodes.forEach((n) => (out.add(n.id), n.kind === 'group' && walk(n.children)));
    walk(groups);
    return out;
  };
  const rows = db.prepare('select id, name, type_key, modules, custom_schema, "values", field_visibility, deleted_at from entities').all() as {
    id: string; name: string; type_key: string; modules: string; custom_schema: string; values: string; field_visibility: string; deleted_at: number | null;
  }[];
  const translated = db.prepare('select entity_id, field_id from translations').all() as { entity_id: string; field_id: string }[];
  const found = new Map<string, { count: number; example: string }>();
  const note = (what: string, example: string) => {
    const f = found.get(what) ?? { count: 0, example };
    f.count++;
    found.set(what, f);
  };
  for (const r of rows) {
    const modules = JSON.parse(r.modules) as string[];
    const schema = effectiveSchema(r.type_key, modules, JSON.parse(r.custom_schema) as SchemaGroup[]);
    if (!schema || !getSchema(r.type_key)) {
      note(`unknown type "${r.type_key}"`, r.name);
      continue;
    }
    const known = idsOf(schema.groups);
    // A value of a module that is not attached now is kept on purpose: attaching the module brings it back.
    const anyModule = idsOf(listModules(r.type_key).flatMap((m) => m.groups));
    for (const m of modules) if (!listModules(r.type_key).some((x) => x.key === m)) note(`${r.type_key}: unknown module "${m}"`, r.name);
    for (const key of Object.keys(JSON.parse(r.values) as object))
      if (!known.has(key) && !anyModule.has(key)) note(`${r.type_key}: value under "${key}"${key.startsWith('c_') ? ' (a custom field that was deleted)' : ''}`, r.name);
    for (const key of Object.keys(JSON.parse(r.field_visibility) as object))
      if (!known.has(key) && !anyModule.has(key)) note(`${r.type_key}: AUDIENCE OVERRIDE on "${key}"`, r.name);
    for (const t of translated) if (t.entity_id === r.id && !known.has(t.field_id) && !anyModule.has(t.field_id)) note(`${r.type_key}: translation of "${t.field_id}"`, r.name);
  }
  const systems = db.prepare('select name, schema_version from systems').all() as { name: string; schema_version: number }[];
  console.log(`Database: ${dbFile}`);
  for (const s of systems) console.log(`System "${s.name}": schema version ${s.schema_version} (the app is at ${currentSchemaVersion()})`);
  console.log(`${rows.length} entities checked.`);
  if (!found.size) return console.log('Nothing is stored under an id that no schema knows.');
  console.log('\nStored under ids that no schema knows (not sent to anyone, but not shown either):');
  for (const [what, f] of [...found].sort()) console.log(`  ${String(f.count).padStart(4)} × ${what}   e.g. on "${f.example}"`);
}

const command = process.argv[2];
if (command === 'check') check(false);
else if (command === 'accept') check(true);
else if (command === 'audit') audit();
