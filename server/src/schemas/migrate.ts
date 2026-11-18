import { and, eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db';
import { changes, entities, systems, translations } from '../db/schema';
import { EVERYONE, type Audience } from '../visibility';
import { currentSchemaVersion, schemaMigrations, type SchemaMigration, type SchemaOp } from './versions';

// Brings the stored data of a System up to the schemas in the code (see versions.ts).

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
type Row = typeof entities.$inferSelect;

/**
 * The audience that passes only who passes both. Where the two cannot be combined exactly
 * (a player named in one and reached through a party in the other) it errs on the narrow side.
 */
export function narrow(a: Audience, b: Audience): Audience {
  const both = (x: string[], y: string[]) => x.filter((id) => y.includes(id));
  return {
    all: a.all && b.all,
    players: a.all ? b.players : b.all ? a.players : both(a.players, b.players),
    parties: a.all ? b.parties : b.all ? a.parties : both(a.parties, b.parties),
  };
}

/** The ops of one type applied to one entity. Returns null when nothing changed. */
function applyToEntity(row: Row, ops: SchemaOp[]): Pick<Row, 'values' | 'fieldVisibility' | 'modules'> | null {
  const values = { ...row.values };
  const overrides = { ...row.fieldVisibility };
  let modules = row.modules;
  const phase = <K extends SchemaOp['op']>(kind: K, run: (op: Extract<SchemaOp, { op: K }>) => void) => {
    for (const op of ops) if (op.op === kind) run(op as Extract<SchemaOp, { op: K }>);
  };

  phase('move', (op) => {
    const lost = op.lost.map((id) => overrides[id]).filter((a): a is Audience => !!a);
    if (!lost.length) return;
    // What the node let through until now: its own override, else its default in the schema.
    // An owner-only node without either was open to the owner alone (and the DM).
    const base =
      overrides[op.id] ?? op.default ?? (op.ownerOnly ? { all: false, players: row.ownerId ? [row.ownerId] : [], parties: [] } : EVERYONE);
    overrides[op.id] = lost.reduce(narrow, base);
  });
  phase('convert', (op) => {
    if (!op.fn || !(op.id in values)) return;
    const next = op.fn(values[op.id]);
    if (next === null || next === undefined) delete values[op.id];
    else values[op.id] = next;
  });
  phase('rename', (op) => {
    if (op.from in values) {
      values[op.to] = values[op.from];
      delete values[op.from];
    }
    if (overrides[op.from]) {
      overrides[op.to] = overrides[op.from]!;
      delete overrides[op.from];
    }
  });
  phase('remove', (op) => {
    delete values[op.id];
    delete overrides[op.id];
  });
  phase('renameModule', (op) => {
    if (modules.includes(op.from)) modules = [...new Set(modules.map((m) => (m === op.from ? op.to : m)))];
  });
  phase('removeModule', (op) => {
    if (modules.includes(op.key)) modules = modules.filter((m) => m !== op.key);
  });

  const changed =
    JSON.stringify(values) !== JSON.stringify(row.values) ||
    JSON.stringify(overrides) !== JSON.stringify(row.fieldVisibility) ||
    modules !== row.modules;
  return changed ? { values, fieldVisibility: overrides, modules } : null;
}

function applyMigration(tx: Tx, systemId: string, migration: SchemaMigration): number {
  let touched = 0;
  for (const type of new Set(migration.ops.map((op) => op.type))) {
    const ops = migration.ops.filter((op) => op.type === type);
    // Deleted entities are migrated too: they can be restored.
    const rows = tx.select().from(entities).where(and(eq(entities.systemId, systemId), eq(entities.typeKey, type))).all();
    for (const row of rows) {
      const next = applyToEntity(row, ops);
      if (!next) continue;
      tx.update(entities).set(next).where(eq(entities.id, row.id)).run();
      touched++;
    }
    const ofType = sql`(select id from entities where system_id = ${systemId} and type_key = ${type})`;

    // The history keeps its values in the shape of the field, so an undo writes a value that fits.
    for (const op of ops) {
      if (op.op !== 'convert' || !op.fn) continue;
      const fn = op.fn;
      const turn = (v: unknown) => (v === null || v === undefined ? null : (fn(v) ?? null));
      const logged = tx
        .select()
        .from(changes)
        .where(and(eq(changes.systemId, systemId), eq(changes.target, 'field'), eq(changes.key, op.id), sql`${changes.entityId} in ${ofType}`))
        .all();
      for (const c of logged) tx.update(changes).set({ oldValue: turn(c.oldValue), newValue: turn(c.newValue) }).where(eq(changes.id, c.id)).run();
    }
    for (const op of ops) {
      if (op.op !== 'rename') continue;
      tx.run(sql`update changes set key = ${op.to} where system_id = ${systemId} and key = ${op.from}
        and target in ('field', 'translation', 'fieldVisibility') and entity_id in ${ofType}`);
      tx.run(sql`update translations set field_id = ${op.to} where field_id = ${op.from} and entity_id in ${ofType}`);
      tx.run(sql`update files set field_id = ${op.to} where system_id = ${systemId} and field_id = ${op.from} and entity_id in ${ofType}`);
    }
    for (const op of ops) {
      if (op.op !== 'remove') continue;
      // The history and the picture files of a removed field stay; nothing shows them any more.
      tx.delete(translations).where(and(eq(translations.fieldId, op.id), sql`${translations.entityId} in ${ofType}`)).run();
    }
  }
  return touched;
}

/** Brings one System from the version it is at to the current one. Runs inside the caller's transaction. */
export function migrateSystem(tx: Tx, systemId: string, from: number): void {
  for (const m of schemaMigrations) if (m.version > from) applyMigration(tx, systemId, m);
  tx.update(systems).set({ schemaVersion: currentSchemaVersion() }).where(eq(systems.id, systemId)).run();
}

export class NewerSchemaError extends Error {}

/** Refuses data that a newer version of the app saved: this version does not know its schemas. */
export function assertKnownVersion(version: number, what: string): void {
  if (version > currentSchemaVersion())
    throw new NewerSchemaError(
      `${what} was saved by a newer version of the app (schema version ${version}; this version knows ${currentSchemaVersion()}). Update the app first.`,
    );
}

/**
 * Called when the database is opened. Every System behind the current version is migrated, each in
 * its own transaction. Before the first change the whole database is copied to
 * `backups/before-schema-v<n>-<time>.db` next to it, so a migration can always be taken back.
 */
export function migrateSchemas(db: DB, file?: string): { migrated: string[]; safetyCopy: string | null } {
  const all = db.select({ id: systems.id, name: systems.name, version: systems.schemaVersion }).from(systems).all();
  for (const s of all) assertKnownVersion(s.version, `The System "${s.name}"`);
  const behind = all.filter((s) => s.version < currentSchemaVersion());
  if (!behind.length) return { migrated: [], safetyCopy: null };

  let safetyCopy: string | null = null;
  if (file && file !== ':memory:') {
    const dir = path.join(path.dirname(file), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    safetyCopy = path.join(dir, `before-schema-v${currentSchemaVersion()}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.sqlite.exec(`VACUUM INTO '${safetyCopy.replace(/'/g, "''")}'`);
  }
  for (const s of behind) {
    db.transaction((tx) => migrateSystem(tx, s.id, s.version));
    console.log(`Schema: System "${s.name}" brought from version ${s.version} to ${currentSchemaVersion()}.`);
  }
  if (safetyCopy) console.log(`Schema: the database as it was before is kept in ${safetyCopy}`);
  return { migrated: behind.map((s) => s.id), safetyCopy };
}
