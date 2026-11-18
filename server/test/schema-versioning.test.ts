import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { changes, entities, files, systems, translations } from '../src/db/schema';
import { readSnapshot } from '../src/schema-tool';
import { registerSchema } from '../src/schemas';
import { checkSchemas, fingerprint, printOf, type Snapshot } from '../src/schemas/fingerprint';
import { migrateSchemas, narrow } from '../src/schemas/migrate';
import type { EntitySchema, SchemaGroup, SchemaNode } from '../src/schemas/types';
import { currentSchemaVersion, schemaMigrations, type SchemaMigration, type SchemaOp } from '../src/schemas/versions';
import { DM_ONLY, EVERYONE, type Audience } from '../src/visibility';
import { code, world } from './helpers';

const T = 'vtest';
const field = (id: string, type: 'text' | 'number' | 'select' | 'longtext' = 'text', extra: object = {}): SchemaNode => ({ kind: 'field', id, label: id, type, ...extra });
const group = (id: string, children: SchemaNode[], extra: object = {}): SchemaGroup => ({ kind: 'group', id, label: id, children, ...extra });
const schema = (groups: SchemaGroup[], extra: Partial<EntitySchema> = {}): EntitySchema => ({ key: T, name: 'V', plural: 'Vs', playerCreatable: true, groups, ...extra });
const only = (players: string[]): Audience => ({ all: false, players, parties: [] });

/** The real migration list is put back after every test. */
const realMigrations = [...schemaMigrations];
afterEach(() => {
  schemaMigrations.length = 0;
  schemaMigrations.push(...realMigrations);
});
const addMigration = (...ops: SchemaOp[]) => schemaMigrations.push({ version: schemaMigrations.length + 1, date: 'test', what: 'test', ops });

describe('the schemas in the code match the accepted snapshot', () => {
  it('needs no migration and no new snapshot', () => {
    const result = checkSchemas(readSnapshot(), fingerprint(), schemaMigrations);
    // A failure here means a schema changed. Follow the steps at the top of src/schemas/versions.ts.
    expect(result.errors).toEqual([]);
    expect(result.upToDate, 'The schemas changed: run `npm run schema:accept -w server` and commit snapshot.json').toBe(true);
  });
});

describe('schema check: what a schema change needs', () => {
  const snap = (s: EntitySchema, modules: { key: string; groups: SchemaGroup[] }[] = [], retired: string[] = []): Snapshot => ({
    version: 0,
    types: { [T]: { ...printOf(s, modules), retired } },
  });
  const now = (s: EntitySchema, modules: { key: string; groups: SchemaGroup[] }[] = []) => ({ types: { [T]: printOf(s, modules) }, errors: [] });
  const check = (before: Snapshot, after: ReturnType<typeof now>, ...ops: SchemaOp[]) =>
    checkSchemas(before, after, ops.length ? [{ version: 1, date: 'test', what: 'test', ops }] : []).errors;
  const base = schema([group('g', [field('a'), field('b')])]);

  it('lets a new field through without a migration, and asks only for a new snapshot', () => {
    const result = checkSchemas(snap(base), now(schema([group('g', [field('a'), field('b'), field('c')])])), []);
    expect(result.errors).toEqual([]);
    expect(result.upToDate).toBe(false);
    expect(result.next.types[T]!.nodes.c).toBeTruthy();
  });

  it('refuses a field that disappeared, and takes a rename or a remove', () => {
    const renamed = now(schema([group('g', [field('a'), field('b2')])]));
    expect(check(snap(base), renamed).join()).toContain('"b" is gone');
    expect(check(snap(base), renamed, { op: 'rename', type: T, from: 'b', to: 'b2' })).toEqual([]);
    const removed = now(schema([group('g', [field('a')])]));
    expect(check(snap(base), removed).join()).toContain('"b" is gone');
    expect(check(snap(base), removed, { op: 'remove', type: T, id: 'b' })).toEqual([]);
  });

  it('never lets an id be used again', () => {
    const removed = checkSchemas(snap(base), now(schema([group('g', [field('a')])])), [{ version: 1, date: '', what: '', ops: [{ op: 'remove', type: T, id: 'b' }] }]);
    expect(removed.next.types[T]!.retired).toEqual(['b']);
    // Later someone adds a field with the old id.
    const again = checkSchemas(removed.next, now(base), [{ version: 1, date: '', what: '', ops: [{ op: 'remove', type: T, id: 'b' }] }]);
    expect(again.errors.join()).toContain('uses an id that was in use before');
    expect(check(snap(base), now(schema([group('g', [field('a'), field('c')])])), { op: 'rename', type: T, from: 'b', to: 'a' }).join()).toContain('is or was in use');
  });

  it('refuses a type change or a lost option without a convert', () => {
    const typed = now(schema([group('g', [field('a', 'number'), field('b')])]));
    expect(check(snap(base), typed).join()).toContain('changed type from text to number');
    expect(check(snap(base), typed, { op: 'convert', type: T, id: 'a', to: 'number', fn: Number })).toEqual([]);
    const options = (values: string[]) => schema([group('g', [field('a', 'select', { options: values.map((v) => ({ value: v, label: v })) })])]);
    expect(check(snap(options(['x', 'y'])), now(options(['x', 'y', 'z'])))).toEqual([]);
    expect(check(snap(options(['x', 'y'])), now(options(['x']))).join()).toContain('lost the options y');
    expect(check(snap(options(['x', 'y'])), now(options(['x'])), { op: 'convert', type: T, id: 'a', to: 'select', fn: () => 'x' })).toEqual([]);
  });

  it('refuses a node that left a group without a move, because an override on the group would stop covering it', () => {
    const moved = now(schema([group('g', [field('a')]), group('h', [field('b')])]));
    expect(check(snap(base), moved).join()).toContain('"b" is no longer inside g');
    expect(check(snap(base), moved, { op: 'move', type: T, id: 'b', lost: ['g'] })).toEqual([]);
    // Wrapping a field in a further group loses nothing.
    expect(check(snap(base), now(schema([group('g', [field('a'), group('row', [field('b')])])])))).toEqual([]);
    // A dissolved group: every child must be moved, then the group removed.
    const flat = now(schema([group('top', [field('a'), field('b')])]));
    const before = snap(schema([group('top', [group('g', [field('a'), field('b')])])]));
    expect(check(before, flat, { op: 'remove', type: T, id: 'g' }).filter((e) => e.includes('no longer inside'))).toHaveLength(2);
    expect(check(before, flat, { op: 'move', type: T, id: 'a', lost: ['g'] }, { op: 'move', type: T, id: 'b', lost: ['g'] }, { op: 'remove', type: T, id: 'g' })).toEqual([]);
  });

  it('one move of a group covers what lies in it, and a move must repeat the default audience of its node', () => {
    const before = snap(schema([group('g', [group('inner', [field('a'), field('b')])])]));
    const after = now(schema([group('g', []), group('inner', [field('a'), field('b')], { ownerOnly: true })]));
    const errors = check(before, after, { op: 'access', type: T, id: 'inner', why: 'test' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('{op: "move", type: "vtest", id: "inner", lost: ["g"], ownerOnly: true}');
    expect(check(before, after, { op: 'access', type: T, id: 'inner', why: 'test' }, { op: 'move', type: T, id: 'inner', lost: ['g'] }).join()).toContain('must repeat');
    expect(check(before, after, { op: 'access', type: T, id: 'inner', why: 'test' }, { op: 'move', type: T, id: 'inner', lost: ['g'], ownerOnly: true })).toEqual([]);
  });

  it('refuses a change of who sees a field by default until it is stated on purpose', () => {
    const secret = schema([group('g', [field('a'), field('b')], { visibility: DM_ONLY })]);
    const opened = now(base);
    expect(check(snap(secret), opened).filter((e) => e.includes('by default changed'))).toHaveLength(2);
    expect(check(snap(secret), opened, { op: 'access', type: T, id: 'g', why: 'opened on purpose' })).toEqual([]);
    // The outside view counts too: a field added to it reaches other players.
    const closed = schema([group('g', [field('a'), field('b')])], { outside: ['a'] });
    const wider = now(schema([group('g', [field('a'), field('b')])], { outside: ['a', 'b'] }));
    expect(check(snap(closed), wider).join()).toContain('who sees the field "b" by default changed');
    expect(check(snap(closed), now(base)).filter((e) => e.includes('by default changed'))).toHaveLength(2);
    expect(check(snap(closed), now(base), { op: 'access', type: T, id: '*', why: 'no outside view any more' })).toEqual([]);
  });

  it('refuses a module or a type that disappeared, a duplicate id, a gap in the versions and two migrations at once', () => {
    const mod = [{ key: 'm', groups: [group('mg', [field('mf')])] }];
    expect(check(snap(base, mod), now(base)).join()).toContain('the module "m" is gone');
    expect(check(snap(base, mod), now(base), { op: 'removeModule', type: T, key: 'm' }, { op: 'remove', type: T, id: 'mg' }, { op: 'remove', type: T, id: 'mf' })).toEqual([]);
    expect(checkSchemas(snap(base), { types: {}, errors: [] }, []).errors.join()).toContain('The type "vtest" is gone');
    const errors: string[] = [];
    printOf(schema([group('g', [field('g')])]), [], errors);
    expect(errors.join()).toContain('used by two nodes');
    const m = (version: number): SchemaMigration => ({ version, date: '', what: '', ops: [] });
    expect(checkSchemas(snap(base), now(base), [m(2)]).errors.join()).toContain('no gaps');
    expect(checkSchemas(snap(base), now(base), [m(1), m(2)]).errors.join()).toContain('Accept the snapshot after each migration');
    expect(check(snap(base), now(base), { op: 'remove', type: T, id: 'nope' }).join()).toContain('was not a node before');
  });
});

describe('narrow: the audience that passes only who passes both', () => {
  it('never lets through someone one of the two would stop', () => {
    expect(narrow(EVERYONE, only(['a']))).toEqual(only(['a']));
    expect(narrow(only(['a', 'b']), only(['b', 'c']))).toEqual(only(['b']));
    expect(narrow(DM_ONLY, EVERYONE)).toEqual(DM_ONLY);
    expect(narrow({ all: false, players: ['a'], parties: ['p'] }, { all: false, players: [], parties: ['p', 'q'] })).toEqual({ all: false, players: [], parties: ['p'] });
  });
});

describe('schema migration: stored data follows the schema', () => {
  const v1 = schema([group('g', [field('title'), field('old'), field('count'), field('story', 'longtext')]), group('side', [field('gone')])]);

  /** A world with one entity of the test type, filled through the API under the first schema. */
  async function filled() {
    registerSchema(v1);
    const w = await world(['alice', 'bob']);
    const { id } = await w.dm.entity.create({ systemId: w.systemId, typeKey: T, name: 'Thing' });
    await w.dm.entity.setVisibility({ id, audience: EVERYONE });
    for (const [fieldId, value] of [['title', 'Title'], ['old', 'kept'], ['count', '7'], ['gone', 'bye'], ['story', 'English']] as const)
      await w.dm.entity.setField({ id, fieldId, value });
    await w.dm.entity.setTranslation({ id, fieldId: 'story', text: 'Русский' });
    const row = () => w.db.select().from(entities).where(eq(entities.id, id)).get()!;
    const version = () => w.db.select().from(systems).where(eq(systems.id, w.systemId)).get()!.schemaVersion;
    return { ...w, id, row, version };
  }

  it('a new System starts at the current version, and opening an up-to-date database changes nothing', async () => {
    addMigration();
    addMigration();
    const w = await world([]);
    expect(w.db.select().from(systems).get()!.schemaVersion).toBe(2);
    expect(migrateSchemas(w.db)).toEqual({ migrated: [], safetyCopy: null });
  });

  it('rename: value, override, translation, picture and history move to the new id', async () => {
    const w = await filled();
    await w.dm.entity.setFieldVisibility({ id: w.id, nodeId: 'story', audience: only([w.players.alice!.userId()]) });
    w.db.insert(files).values({ id: 'f1', systemId: w.systemId, entityId: w.id, fieldId: 'story', mime: 'image/png', size: 1, createdBy: 'x', createdAt: 1 }).run();
    // A second System with the same field is at the current version already and must stay untouched.
    const other = await w.dm.system.create({ name: 'Other' });
    const twin = await w.dm.entity.create({ systemId: other.systemId, typeKey: T, name: 'Twin' });
    await w.dm.entity.setField({ id: twin.id, fieldId: 'story', value: 'stays' });
    w.db.update(systems).set({ schemaVersion: 1 }).where(eq(systems.id, other.systemId)).run();

    registerSchema(schema([group('g', [field('title'), field('old'), field('count'), field('tale', 'longtext')]), group('side', [field('gone')])]));
    addMigration({ op: 'rename', type: T, from: 'story', to: 'tale' });
    expect(migrateSchemas(w.db).migrated).toEqual([w.systemId]);

    expect(w.version()).toBe(1);
    expect(w.row().values).toMatchObject({ tale: 'English' });
    expect(w.row().values.story).toBeUndefined();
    expect(Object.keys(w.row().fieldVisibility)).toEqual(['tale']);
    expect(w.db.select().from(translations).all().map((t) => t.fieldId)).toEqual(['tale']);
    expect(w.db.select().from(files).get()!.fieldId).toBe('tale');
    const logged = w.db.select().from(changes).where(eq(changes.entityId, w.id)).all();
    expect(logged.some((c) => c.key === 'story')).toBe(false);
    expect(logged.filter((c) => c.key === 'tale').map((c) => c.target).sort()).toEqual(['field', 'fieldVisibility', 'translation']);
    // Through the API: the value reads under the new id, with its translation, still closed to Bob.
    const seen = await w.players.alice!.entity.get({ id: w.id });
    expect(seen.values.tale).toBe('English');
    expect(seen.translations.tale?.text).toBe('Русский');
    expect(JSON.stringify(await w.players.bob!.entity.get({ id: w.id }))).not.toContain('English');
    // The history of the field can still be undone.
    const history = await w.dm.entity.history({ id: w.id });
    const change = history.find((c) => c.key === 'tale' && c.target === 'field')!;
    expect(change.canRevert).toBe(true);
    await w.dm.entity.revert({ changeId: change.id });
    expect(w.row().values.tale).toBeUndefined();
    expect(w.db.select().from(entities).where(eq(entities.id, twin.id)).get()!.values).toEqual({ story: 'stays' });
    // A second run finds nothing to do.
    expect(migrateSchemas(w.db).migrated).toEqual([]);
  });

  it('remove: value, override and translation are deleted; the history stays but cannot be undone', async () => {
    const w = await filled();
    await w.dm.entity.setFieldVisibility({ id: w.id, nodeId: 'story', audience: DM_ONLY });
    registerSchema(schema([group('g', [field('title'), field('old'), field('count')]), group('side', [field('gone')])]));
    addMigration({ op: 'remove', type: T, id: 'story' });
    migrateSchemas(w.db);
    expect(w.row().values).toEqual({ title: 'Title', old: 'kept', count: '7', gone: 'bye' });
    expect(w.row().fieldVisibility).toEqual({});
    expect(w.db.select().from(translations).all()).toEqual([]);
    const change = (await w.dm.entity.history({ id: w.id })).find((c) => c.key === 'story' && c.target === 'field')!;
    expect(change.canRevert).toBe(false);
    expect(await code(w.dm.entity.revert({ changeId: change.id }))).toBe('BAD_REQUEST');
    expect(w.row().values.story).toBeUndefined();
  });

  it('convert: the value and the values in the history get the new shape, so an undo still fits', async () => {
    const w = await filled();
    await w.dm.entity.setField({ id: w.id, fieldId: 'count', value: '9' });
    registerSchema(schema([group('g', [field('title'), field('old'), field('count', 'number'), field('story', 'longtext')]), group('side', [field('gone')])]));
    addMigration({ op: 'convert', type: T, id: 'count', to: 'number', fn: (v) => Number(v) });
    migrateSchemas(w.db);
    expect(w.row().values.count).toBe(9);
    const history = (await w.dm.entity.history({ id: w.id })).filter((c) => c.key === 'count');
    expect(history.map((c) => [c.oldValue, c.newValue])).toEqual([[7, 9], [null, 7]]);
    await w.dm.entity.revert({ changeId: history[0]!.id });
    expect(w.row().values.count).toBe(7);
    expect((await w.dm.entity.get({ id: w.id })).values.count).toBe(7);
  });

  it('move: a field that leaves a narrowed group stays just as closed', async () => {
    const w = await filled();
    const alice = w.players.alice!;
    const bob = w.players.bob!;
    // On this entity the DM closed the side group to everyone but Alice.
    await w.dm.entity.setFieldVisibility({ id: w.id, nodeId: 'side', audience: only([alice.userId()]) });
    expect(JSON.stringify(await bob.entity.get({ id: w.id }))).not.toContain('bye');
    // A second entity without an override must not get one.
    const plain = await w.dm.entity.create({ systemId: w.systemId, typeKey: T, name: 'Plain' });

    // The new schema dissolves the side group: its field now lies in the open group.
    registerSchema(schema([group('g', [field('title'), field('old'), field('count'), field('story', 'longtext'), field('gone')])]));
    addMigration({ op: 'move', type: T, id: 'gone', lost: ['side'] }, { op: 'remove', type: T, id: 'side' });
    migrateSchemas(w.db);

    expect(w.row().fieldVisibility).toEqual({ gone: only([alice.userId()]) });
    expect((await alice.entity.get({ id: w.id })).values.gone).toBe('bye');
    expect(JSON.stringify(await bob.entity.get({ id: w.id }))).not.toContain('bye');
    expect(w.db.select().from(entities).where(eq(entities.id, plain.id)).get()!.fieldVisibility).toEqual({});
  });

  it('move: an override of its own, a default audience and owner-only are narrowed, never replaced', async () => {
    registerSchema(v1);
    const w = await world(['alice', 'bob']);
    const [a, b] = [w.players.alice!.userId(), w.players.bob!.userId()];
    const make = async (name: string, overrides: Record<string, Audience>, ownerId: string | null = null) => {
      const { id } = await w.dm.entity.create({ systemId: w.systemId, typeKey: T, name });
      w.db.update(entities).set({ fieldVisibility: overrides, ownerId }).where(eq(entities.id, id)).run();
      return () => w.db.select().from(entities).where(eq(entities.id, id)).get()!.fieldVisibility.gone;
    };
    const own = await make('own', { side: only([a, b]), gone: only([b]) });
    const wide = await make('wide', { side: DM_ONLY, gone: EVERYONE });
    const owned = await make('owned', { side: only([a, b]) }, a);
    const ownedOut = await make('owned out', { side: only([b]) }, a);

    addMigration({ op: 'move', type: T, id: 'gone', lost: ['side'] });
    migrateSchemas(w.db);
    expect(own()).toEqual(only([b]));
    // "All" under a DM-only group was never open; it must not become open now.
    expect(wide()).toEqual(DM_ONLY);

    // The same move for a node that is owner-only in the new schema, and for one that is DM-only by default.
    const again = (op: SchemaOp, overrides: Record<string, Record<string, Audience>>) => {
      w.db.update(systems).set({ schemaVersion: 0 }).run();
      schemaMigrations.length = 0;
      addMigration(op);
      for (const [name, fieldVisibility] of Object.entries(overrides)) w.db.update(entities).set({ fieldVisibility }).where(eq(entities.name, name)).run();
      migrateSchemas(w.db);
    };
    // Alice owns both; the group was open to Alice and Bob on one, and to Bob alone on the other.
    again({ op: 'move', type: T, id: 'gone', lost: ['side'], ownerOnly: true }, { owned: { side: only([a, b]) }, 'owned out': { side: only([b]) } });
    expect(owned()).toEqual(only([a]));
    expect(ownedOut()).toEqual(DM_ONLY);

    again({ op: 'move', type: T, id: 'gone', lost: ['side'], default: DM_ONLY }, { owned: { side: EVERYONE } });
    expect(owned()).toEqual(DM_ONLY);
  });

  it('modules are renamed and removed on the entities that have them, deleted entities included', async () => {
    registerSchema(v1);
    const w = await world([]);
    const { id } = await w.dm.entity.create({ systemId: w.systemId, typeKey: T, name: 'M' });
    w.db.update(entities).set({ modules: ['m1', 'm2', 'm3'], deletedAt: 5 }).where(eq(entities.id, id)).run();
    addMigration({ op: 'renameModule', type: T, from: 'm1', to: 'n1' }, { op: 'removeModule', type: T, key: 'm2' });
    migrateSchemas(w.db);
    expect(w.db.select().from(entities).where(eq(entities.id, id)).get()!.modules).toEqual(['n1', 'm3']);
  });

  it('an older export is brought up to date on import, and a newer one is refused', async () => {
    const w = await filled();
    const exported = await w.dm.system.export({ systemId: w.systemId });
    expect(exported.schemaVersion).toBe(0);

    addMigration({ op: 'rename', type: T, from: 'story', to: 'tale' }, { op: 'remove', type: T, id: 'gone' });
    const { systemId: copyId } = await w.dm.system.import({ data: exported });
    const copy = w.db.select().from(entities).where(eq(entities.systemId, copyId)).get()!;
    expect(copy.values).toEqual({ title: 'Title', old: 'kept', count: '7', tale: 'English' });
    expect(w.db.select().from(translations).where(eq(translations.entityId, copy.id)).get()!.fieldId).toBe('tale');
    expect(w.db.select().from(systems).where(eq(systems.id, copyId)).get()!.schemaVersion).toBe(1);
    expect((await w.dm.system.export({ systemId: copyId })).schemaVersion).toBe(1);
    // A file from before versioning has no version and counts as 0.
    const { schemaVersion: _none, ...legacy } = exported;
    const { systemId: legacyId } = await w.dm.system.import({ data: legacy });
    expect(w.db.select().from(entities).where(eq(entities.systemId, legacyId)).get()!.values.tale).toBe('English');

    const before = w.db.select().from(systems).all().length;
    expect(await code(w.dm.system.import({ data: { ...exported, schemaVersion: 5 } }))).toBe('BAD_REQUEST');
    expect(w.db.select().from(systems).all()).toHaveLength(before);
  });

  it('a database file gets a safety copy before its data is migrated, a failed migration changes nothing, and newer data stops the start', async () => {
    registerSchema(v1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anybrew-schema-'));
    const file = path.join(dir, 'test.db');
    try {
      let db = openDb(file);
      db.insert(systems).values({ id: 's1', name: 'Filed', createdAt: 1 }).run();
      const entity = { id: 'e1', systemId: 's1', typeKey: T, name: 'E', campaignIds: [], visibility: DM_ONLY, fieldVisibility: {}, values: { story: 'before' }, createdAt: 1, updatedAt: 1 };
      db.insert(entities).values(entity).run();
      db.sqlite.close();
      expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);

      // A migration that fails half-way leaves the System as it was.
      addMigration({ op: 'rename', type: T, from: 'story', to: 'tale' }, { op: 'convert', type: T, id: 'story', to: 'text', fn: () => { throw new Error('boom'); } });
      expect(() => openDb(file)).toThrow('boom');
      schemaMigrations.length = 0;
      db = openDb(file);
      expect(db.select().from(entities).get()!.values).toEqual({ story: 'before' });
      expect(db.select().from(systems).get()!.schemaVersion).toBe(0);
      db.sqlite.close();

      addMigration({ op: 'rename', type: T, from: 'story', to: 'tale' });
      db = openDb(file);
      expect(db.select().from(entities).get()!.values).toEqual({ tale: 'before' });
      const copies = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('before-schema-v1-'));
      expect(copies.length).toBeGreaterThanOrEqual(1);
      const copy = openDbReadOnly(path.join(dir, 'backups', copies.sort().at(-1)!));
      expect(copy).toContain('"story":"before"');
      db.sqlite.close();

      // The same file opened by an older version of the app: it must refuse to run.
      schemaMigrations.length = 0;
      expect(() => openDb(file)).toThrow('newer version of the app');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every place in the server that creates a System names its schema version', () => {
    // Without it a new System would count as version 0 and be "migrated" from the start.
    const src = path.resolve(import.meta.dirname, '../src');
    const sources = (fs.readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
    const inserts = sources.flatMap((text) => text.split('insert(systems)').slice(1).map((after) => after.slice(0, 400)));
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    for (const after of inserts) expect(after).toContain('schemaVersion');
    expect(currentSchemaVersion()).toBe(schemaMigrations.length);
  });
});

/** The entity values of a database file, read without opening it as the app would (which would migrate it). */
function openDbReadOnly(file: string): string {
  const db = new Database(file, { readonly: true });
  const text = JSON.stringify(db.prepare('select "values" from entities').all());
  db.close();
  return text.replace(/\\"/g, '"');
}
