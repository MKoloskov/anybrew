import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CLASS_MODULE } from '../src/classes';
import { entities } from '../src/db/schema';
import { registerFileRoutes } from '../src/files';
import { effectiveSchema, getSchema, listModules, listSchemas } from '../src/schemas';
import { allFields, type SchemaGroup, type SchemaNode } from '../src/schemas/types';
import { code, world, type Client } from './helpers';

const ALL = { all: true, players: [], parties: [] };
const SECRET = 'SECRET-';

/** Ids of every group and field of a sheet as it arrived. */
function nodeIds(groups: unknown): string[] {
  const out: string[] = [];
  const walk = (nodes: SchemaNode[]) => {
    for (const n of nodes) {
      out.push(n.id);
      if (n.kind === 'group') walk(n.children);
    }
  };
  walk(groups as SchemaNode[]);
  return out;
}

describe('pages of the character sheet', () => {
  const everyModule = listModules('character').map((m) => m.key);
  const custom: SchemaGroup = { kind: 'group', id: 'c_extra', label: 'Extra', custom: true, children: [] };
  const sheet = effectiveSchema('character', everyModule, [custom])!;

  it('has the 16 pages in menu order, and every section names one of them', () => {
    expect(sheet.pages!.map((p) => p.label)).toEqual([
      'Home',
      'Preview',
      'Basic Info',
      'Stats',
      'Skills',
      'Class Abilities',
      'Subclass Abilities',
      'Hero Abilities',
      'Inventory',
      'Spells Known',
      'Progression History',
      'Open Character History',
      'Character Secrets',
      'DM Secrets',
      'Char Notes',
      'Combat',
    ]);
    const keys = new Set(sheet.pages!.map((p) => p.key));
    expect(keys.size).toBe(16);
    for (const g of sheet.groups) expect(keys.has(g.page!), `page of group ${g.id}`).toBe(true);
    const pageOf = (groupId: string) => sheet.groups.find((g) => g.id === groupId)!.page;
    expect(['identity', 'primary', 'skills', 'equipment', 'supplies', 'spell_slots', 'talents_group', 'story', 'char_notes', 'personal', 'dm', 'death_saves'].map(pageOf)).toEqual(
      ['basic', 'stats', 'skills', 'inventory', 'inventory', 'spells', 'class', 'history', 'notes', 'secrets', 'dm', 'combat'],
    );
    // A section added to one character goes to Hero Abilities.
    expect(pageOf('c_extra')).toBe('hero');
  });

  it('shows fields of other pages by id, and every such id exists', () => {
    const ids = new Set(nodeIds(sheet.groups));
    for (const page of sheet.pages!) for (const id of page.shows ?? []) expect(ids.has(id), `${page.key} shows ${id}`).toBe(true);
    for (const id of sheet.outside!) expect(ids.has(id), `outside view field ${id}`).toBe(true);
    // Combat shows AC, HP, hit dice and initiative, which stay stored in Secondary Stats.
    const secondary = nodeIds([sheet.groups.find((g) => g.id === 'secondary')!]);
    const combat = sheet.pages!.find((p) => p.key === 'combat')!;
    for (const id of combat.shows!) expect(secondary).toContain(id);
    expect(secondary).toEqual(expect.arrayContaining(['ac', 'hp', 'hp_max', 'hit_dice', 'initiative']));
  });

  it('keeps the field ids that stored values and the change log are keyed by', () => {
    const ids = allFields(sheet).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(['portrait', 'kind', 'race', 'class', 'classes', 'faction', 'level', 'str', 'save_str_prof', 'skill_stealth_bonus', 'ac', 'hp', 'death_fail', 'eq_melee_main', 'money', 'description', 'notes', 'personal_secrets', 'gm_secrets', 'slots_1', 'talents_taken']),
    );
    const field = (id: string) => allFields(sheet).find((f) => f.id === id)!;
    expect(field('faction').label).toBe('Allegiance');
    expect(field('background').type).toBe('text');
    expect(field('tags')).toMatchObject({ type: 'list', dmEditOnly: true });
    expect(field('gallery')).toMatchObject({ type: 'gallery', main: 'portrait' });
    expect(field('progression').columns).toEqual(['Level', 'When', 'What was chosen']);
    expect(field('attacks').type).toBe('table');
  });

  it('leaves the other types as one sheet without pages', () => {
    for (const s of listSchemas().filter((x) => x.key !== 'character')) {
      expect(s.pages, s.key).toBeUndefined();
      expect(s.outside, s.key).toBeUndefined();
    }
  });
});

describe('another player receives only the Preview of a character', () => {
  /** Alice's character, filled on every page, shared with all players. Bob is the other player. */
  async function shared() {
    const w = await world(['alice', 'bob']);
    const alice = w.players.alice!;
    const bob = w.players.bob!;
    const { dm, systemId } = w;
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Elara' });
    await dm.entity.setModules({ id, modules: ['spellcasting', 'class_stats'] });
    await dm.entity.setCustomSchema({ id, groups: [{ id: 'c_boon', label: `${SECRET}section`, children: [{ id: 'c_boontext', label: 'Boon', type: 'text' }] }] });
    const open = { race: 'Moon elf', faction: 'Cormyr', description: '<p>A noble of Suzail.</p>' };
    const closed = {
      background: `${SECRET}background`,
      class: `${SECRET}class`,
      gender: `${SECRET}gender`,
      disposition: `${SECRET}disposition`,
      level: 7,
      str: 17,
      skill_stealth_bonus: 3,
      ac: 19,
      hp: 41,
      money: 1234,
      eq_melee_main: `${SECRET}sword`,
      combat_modifiers: [`${SECRET}modifier`],
      attacks: { columns: ['Attack', 'Bonus'], rows: [[`${SECRET}attack`, '+5']] },
      progression: { columns: ['Level', 'When', 'What was chosen'], rows: [['2', 'Session 3', `${SECRET}choice`]] },
      notes: `<p>${SECRET}notes</p>`,
      personal_secrets: `<p>${SECRET}personal</p>`,
      spells_1: [`${SECRET}spell`],
      class_dc: 15,
      c_boontext: `${SECRET}boon`,
    };
    for (const [fieldId, value] of Object.entries({ ...open, ...closed })) await alice.entity.setField({ id, fieldId, value });
    await dm.entity.setField({ id, fieldId: 'kind', value: 'pc' });
    await dm.entity.setField({ id, fieldId: 'tags', value: [`${SECRET}tag`] });
    await dm.entity.setField({ id, fieldId: 'gm_secrets', value: `<p>${SECRET}dm</p>` });
    await dm.entity.setTranslation({ id, fieldId: 'notes', text: `<p>${SECRET}notes-ru</p>` });
    await dm.entity.setVisibility({ id, audience: ALL });
    return { ...w, alice, bob, id, open, closed };
  }

  /** Everything a member can read about the characters of a system, as one string. */
  async function everything(c: Client, systemId: string, id: string) {
    return JSON.stringify([
      await c.entity.get({ id }),
      await c.entity.list({ systemId }),
      await c.entity.links({ id }),
      await c.entity.classInfo({ id }),
      await c.system.get({ systemId }),
    ]);
  }

  it('sends the other player the outside view and nothing else', async () => {
    const { bob, id, systemId } = await shared();
    const sheet = await bob.entity.get({ id });
    expect(Object.keys(sheet.values).sort()).toEqual(['description', 'faction', 'kind', 'race']);
    expect(allFields(sheet.schema).map((f) => f.id).sort()).toEqual(['description', 'faction', 'kind', 'portrait', 'race']);
    // Only the two sections that hold those fields arrive, emptied of everything else.
    expect(sheet.schema.groups.map((g) => g.id)).toEqual(['identity', 'story']);
    expect(sheet).toMatchObject({ canEdit: false, editableFields: [], modules: [], availableModules: [], access: null, translations: {} });
    expect(await everything(bob, systemId, id)).not.toContain(SECRET);
  });

  it('sends the owner everything except the DM secrets, and the DM everything', async () => {
    const { alice, dm, id, systemId, closed } = await shared();
    const mine = await alice.entity.get({ id });
    for (const [fieldId, value] of Object.entries(closed)) expect(mine.values[fieldId], fieldId).toEqual(value);
    expect(mine.values.tags).toEqual([`${SECRET}tag`]);
    expect(mine.values.gm_secrets).toBeUndefined();
    expect(mine.translations.notes?.text).toContain('notes-ru');
    expect(mine.modules).toEqual(['spellcasting', 'class_stats']);
    expect(await everything(alice, systemId, id)).not.toContain(`${SECRET}dm`);
    expect((await dm.entity.get({ id })).values.gm_secrets).toContain(`${SECRET}dm`);
  });

  it('keeps Notes for the owner and the DM, and Tags for the DM to edit', async () => {
    const { alice, bob, dm, id } = await shared();
    expect((await alice.entity.get({ id })).values.notes).toContain('notes');
    expect((await bob.entity.get({ id })).values.notes).toBeUndefined();
    expect(await code(bob.entity.setField({ id, fieldId: 'notes', value: '<p>x</p>' }))).toBe('FORBIDDEN');
    // The owner reads the tags but only the DM changes them.
    expect((await alice.entity.get({ id })).editableFields).not.toContain('tags');
    expect(await code(alice.entity.setField({ id, fieldId: 'tags', value: ['Mine'] }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.setField({ id, fieldId: 'tags', value: ['Cormyr', 'Noble'] }))).toBe('OK');
    expect((await alice.entity.get({ id })).values.tags).toEqual(['Cormyr', 'Noble']);
    expect(await code(alice.entity.setField({ id, fieldId: 'background', value: 'Courtier' }))).toBe('OK');
  });

  it('lets the DM open one section or one field of one character', async () => {
    const { bob, dm, id } = await shared();
    const forBob = { all: false, players: [bob.userId()], parties: [] };
    // A whole section: everything in it arrives.
    await dm.entity.setFieldVisibility({ id, nodeId: 'primary', audience: ALL });
    // One field deep inside a closed section: it arrives alone, inside its row and section.
    await dm.entity.setFieldVisibility({ id, nodeId: 'ac', audience: forBob });
    const sheet = await bob.entity.get({ id });
    expect(sheet.values).toMatchObject({ str: 17, ac: 19, str_mod: 3 });
    expect(Object.keys(sheet.values)).not.toContain('hp');
    expect(Object.keys(sheet.values)).not.toContain('initiative');
    expect(nodeIds([sheet.schema.groups.find((g) => g.id === 'secondary')!])).toEqual(['secondary', 'ac_row', 'ac']);
    // Closing them again returns the character to its outside view.
    await dm.entity.setFieldVisibility({ id, nodeId: 'primary', audience: null });
    await dm.entity.setFieldVisibility({ id, nodeId: 'ac', audience: null });
    expect(Object.keys((await bob.entity.get({ id })).values).sort()).toEqual(['description', 'faction', 'kind', 'race']);
  });

  it('a field the DM hid inside a section does not make the section appear for others', async () => {
    const { bob, dm, id } = await shared();
    await dm.entity.setFieldVisibility({ id, nodeId: 'hp', audience: { all: false, players: [], parties: [] } });
    expect((await bob.entity.get({ id })).schema.groups.map((g) => g.id)).toEqual(['identity', 'story']);
    // The DM can also close a field of the outside view on one character.
    await dm.entity.setFieldVisibility({ id, nodeId: 'race', audience: { all: false, players: [], parties: [] } });
    expect(Object.keys((await bob.entity.get({ id })).values).sort()).toEqual(['description', 'faction', 'kind']);
  });

  it('keeps what a character has, and its classes, between the owner and the DM', async () => {
    const { alice, bob, dm, id, systemId } = await shared();
    const wizard = await dm.entity.create({ systemId, typeKey: 'rule', name: 'Wizard' });
    await dm.entity.setModules({ id: wizard.id, modules: [CLASS_MODULE] });
    const feature = await dm.entity.create({ systemId, typeKey: 'feature', name: 'Arcane Recovery' });
    await dm.entity.setVisibility({ id: feature.id, audience: ALL });
    const item = await dm.entity.create({ systemId, typeKey: 'item', name: 'Staff' });
    await dm.entity.setVisibility({ id: item.id, audience: ALL });
    await alice.entity.setField({ id, fieldId: 'classes', value: [{ classId: wizard.id, subclass: null, level: 5 }] });
    await alice.entity.link({ fromId: id, kind: 'has', toId: feature.id });
    await alice.entity.link({ fromId: id, kind: 'owns', toId: item.id });

    expect(await alice.entity.links({ id })).toHaveLength(2);
    expect(await alice.entity.classInfo({ id })).toHaveLength(1);
    expect(await dm.entity.links({ id })).toHaveLength(2);
    // Bob sees the character and the library, but not the connection between them.
    expect(await bob.entity.links({ id })).toEqual([]);
    expect(await bob.entity.classInfo({ id })).toEqual([]);
    expect(await bob.entity.links({ id: feature.id })).toEqual([]);
    const holders = async (c: Client) => (await c.entity.list({ systemId, typeKey: 'item' })).find((i) => i.id === item.id)!.holderIds;
    expect(await holders(bob)).toEqual([]);
    expect(await holders(alice)).toEqual([id]);
    expect(await holders(dm)).toEqual([id]);
    expect((await bob.entity.get({ id })).values.classes).toBeUndefined();
  });

  it('does not touch the visibility of types without an outside view', async () => {
    const { bob, dm, systemId } = await shared();
    const note = await dm.entity.create({ systemId, typeKey: 'note', name: 'Open note' });
    await dm.entity.setField({ id: note.id, fieldId: 'summary', value: 'for all' });
    await dm.entity.setVisibility({ id: note.id, audience: ALL });
    expect((await bob.entity.get({ id: note.id })).values.summary).toBe('for all');
    expect(getSchema('note')!.outside).toBeUndefined();
  });
});

describe('card fields of the character list', () => {
  it('stores the choice of the DM on the System, one choice for everyone', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const system = await dm.system.get({ systemId });
    expect(system.cardFields).toEqual([]);
    expect(system.cardFieldOptions.map((o) => o.key)).toEqual(['race', 'class', 'level', 'kind', 'status', 'disposition', 'owner', 'campaign', 'tags']);

    expect(await code(alice.system.setCardFields({ systemId, fields: ['race'] }))).toBe('FORBIDDEN');
    expect(await code(dm.system.setCardFields({ systemId, fields: ['hp'] as never }))).toBe('BAD_REQUEST');
    // Kept in the order of the list of options, without doubles.
    await dm.system.setCardFields({ systemId, fields: ['tags', 'race', 'race', 'level'] });
    expect((await dm.system.get({ systemId })).cardFields).toEqual(['race', 'level', 'tags']);
    expect((await alice.system.get({ systemId })).cardFields).toEqual(['race', 'level', 'tags']);

    // The choice travels with the export; an export made before the choice existed still imports.
    const exported = JSON.parse(JSON.stringify(await dm.system.export({ systemId })));
    const copy = await dm.system.import({ data: exported });
    expect((await dm.system.get({ systemId: copy.systemId })).cardFields).toEqual(['race', 'level', 'tags']);
    delete exported.system.settings;
    const old = await dm.system.import({ data: exported });
    expect((await dm.system.get({ systemId: old.systemId })).cardFields).toEqual([]);
  });

  it('sends each viewer the card values of the fields they may see', async () => {
    const { dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;
    const wizard = await dm.entity.create({ systemId, typeKey: 'rule', name: 'Wizard' });
    await dm.entity.setModules({ id: wizard.id, modules: [CLASS_MODULE] });
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Elara' });
    for (const [fieldId, value] of Object.entries({ race: 'Moon elf', faction: 'Cormyr', disposition: 'Ally', status: 'alive', class: 'typed class' }))
      await alice.entity.setField({ id, fieldId, value });
    await dm.entity.setField({ id, fieldId: 'kind', value: 'pc' });
    await dm.entity.setField({ id, fieldId: 'tags', value: ['Cormyr'] });
    await dm.entity.setVisibility({ id, audience: ALL });
    const card = async (c: Client) => (await c.entity.list({ systemId, typeKey: 'character' })).find((e) => e.id === id)!.card!;

    // Nothing chosen: portrait, allegiance and tags only.
    expect(await card(dm)).toEqual({ portrait: null, allegiance: 'Cormyr', tags: ['Cormyr'], values: {} });

    await dm.system.setCardFields({ systemId, fields: ['race', 'class', 'level', 'kind', 'status', 'disposition', 'owner', 'campaign', 'tags'] });
    // The typed-in class is used while no class is chosen from the rules.
    expect((await card(dm)).values).toEqual({ race: 'Moon elf', class: 'typed class', level: null, kind: 'Player character', status: 'Alive', disposition: 'Ally' });
    await alice.entity.setField({ id, fieldId: 'classes', value: [{ classId: wizard.id, subclass: null, level: 5 }] });
    const full = { race: 'Moon elf', class: 'Wizard 5', level: 5, kind: 'Player character', status: 'Alive', disposition: 'Ally' };
    expect((await card(dm)).values).toEqual(full);
    expect(await card(alice)).toEqual({ portrait: null, allegiance: 'Cormyr', tags: ['Cormyr'], values: full });

    // The other player gets the card values of the outside view; the rest is empty, not sent.
    expect(await card(bob)).toEqual({
      portrait: null,
      allegiance: 'Cormyr',
      tags: [],
      values: { race: 'Moon elf', class: null, level: null, kind: 'Player character', status: null, disposition: null },
    });
    // A field the DM opened for everyone on this character reaches the card as well.
    await dm.entity.setFieldVisibility({ id, nodeId: 'status', audience: ALL });
    expect((await card(bob)).values.status).toBe('Alive');
    // Only characters have a card.
    expect((await dm.entity.list({ systemId, typeKey: 'rule' }))[0]!.card).toBeNull();
  });
});

describe('portrait gallery', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  /** The real upload and download routes over an in-memory world, with Alice's character. */
  async function gallery() {
    const w = await world(['alice', 'bob']);
    const alice = w.players.alice!;
    const bob = w.players.bob!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anybrew-test-'));
    dirs.push(dir);
    const app = Fastify();
    await app.register(cookie);
    registerFileRoutes(app, w.db, 'sid', dir);
    const { id } = await alice.entity.create({ systemId: w.systemId, typeKey: 'character', name: 'Pictured' });
    const upload = async (c: Client, fieldId: string, entityId = id) => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/upload?entityId=${entityId}&fieldId=${fieldId}`,
        headers: { 'content-type': 'image/png' },
        cookies: { sid: c.token() },
        payload: PNG,
      });
      return res.statusCode === 200 ? (res.json().id as string) : res.statusCode;
    };
    const load = async (c: Client, fileId: string) => (await app.inject({ method: 'GET', url: `/api/file/${fileId}`, cookies: { sid: c.token() } })).statusCode;
    const values = async (c: Client) => (await c.entity.get({ id })).values;
    return { ...w, alice, bob, id, upload, load, values };
  }

  it('holds several pictures; the first becomes the main one and the owner chooses another', async () => {
    const { alice, id, upload, values } = await gallery();
    const a = (await upload(alice, 'gallery')) as string;
    const b = (await upload(alice, 'gallery')) as string;
    expect(await values(alice)).toMatchObject({ gallery: [a, b], portrait: a });

    await alice.entity.setMainPicture({ id, fieldId: 'gallery', fileId: b });
    expect(await values(alice)).toMatchObject({ gallery: [a, b], portrait: b });
    // Removing the main picture makes the next one the main; removing the last empties both fields.
    await alice.entity.removePicture({ id, fieldId: 'gallery', fileId: b });
    expect(await values(alice)).toMatchObject({ gallery: [a], portrait: a });
    await alice.entity.removePicture({ id, fieldId: 'gallery', fileId: a });
    expect((await values(alice)).gallery).toBeUndefined();
    expect((await values(alice)).portrait).toBeUndefined();

    // The list of pictures is changed by uploading and removing only, never by typing ids.
    expect(await code(alice.entity.setField({ id, fieldId: 'gallery', value: ['some-file-id'] }))).toBe('BAD_REQUEST');
    expect(await code(alice.entity.setMainPicture({ id, fieldId: 'gallery', fileId: 'not-in-the-gallery' }))).toBe('NOT_FOUND');
    expect(await code(alice.entity.removePicture({ id, fieldId: 'portrait', fileId: a }))).toBe('BAD_REQUEST');
  });

  it('counts a portrait uploaded the old way as the first picture of the gallery', async () => {
    const { alice, dm, db, id, upload, load, values } = await gallery();
    const old = (await upload(alice, 'portrait')) as string;
    expect(await values(alice)).toMatchObject({ portrait: old, gallery: [old] });
    // Replacing the portrait the old way keeps the earlier picture in the gallery.
    const next = (await upload(alice, 'portrait')) as string;
    expect(await values(alice)).toMatchObject({ portrait: next, gallery: [old, next] });
    // A portrait that was stored before the gallery existed is its first picture as well.
    db.update(entities).set({ values: { portrait: old } }).where(eq(entities.id, id)).run();
    expect(await values(alice)).toMatchObject({ portrait: old, gallery: [old] });
    expect(await load(alice, old)).toBe(200);
    // Choosing another main picture stores the list, so the earlier portrait stays in the gallery.
    const added = (await upload(alice, 'gallery')) as string;
    await alice.entity.setMainPicture({ id, fieldId: 'gallery', fileId: added });
    expect(await values(dm)).toMatchObject({ portrait: added, gallery: [old, added] });
  });

  it('serves a picture only to someone who may see a field that holds it', async () => {
    const { alice, bob, dm, id, systemId, upload, load } = await gallery();
    const main = (await upload(alice, 'gallery')) as string;
    const second = (await upload(alice, 'gallery')) as string;
    expect(await load(alice, main)).toBe(200);
    expect(await load(dm, second)).toBe(200);
    // Bob may not see the character at all.
    expect(await load(bob, main)).toBe(404);
    expect(await upload(bob, 'gallery')).toBe(404);

    // Shared: the main portrait is part of the outside view, the rest of the gallery is not.
    await dm.entity.setVisibility({ id, audience: ALL });
    expect(await load(bob, main)).toBe(200);
    expect(await load(bob, second)).toBe(404);
    expect((await bob.entity.get({ id })).values).toMatchObject({ portrait: main });
    expect((await bob.entity.get({ id })).values.gallery).toBeUndefined();
    expect((await bob.entity.list({ systemId, typeKey: 'character' }))[0]!.card!.portrait).toBe(main);
    // He still cannot add, remove or choose pictures.
    expect(await upload(bob, 'gallery')).toBe(404);
    expect(await upload(bob, 'portrait')).toBe(404);
    expect(await code(bob.entity.removePicture({ id, fieldId: 'gallery', fileId: main }))).toBe('FORBIDDEN');
    expect(await code(bob.entity.setMainPicture({ id, fieldId: 'gallery', fileId: second }))).toBe('FORBIDDEN');

    // When the owner chooses another main picture, that one opens to Bob and the old one closes.
    await alice.entity.setMainPicture({ id, fieldId: 'gallery', fileId: second });
    expect(await load(bob, second)).toBe(200);
    expect(await load(bob, main)).toBe(404);
    // A removed picture is served to nobody, not even its owner.
    await alice.entity.removePicture({ id, fieldId: 'gallery', fileId: main });
    expect(await load(alice, main)).toBe(404);
    expect(await load(dm, main)).toBe(404);

    // Without a login nothing is served, and a picture cannot be put into a field of another type.
    const anonymous = { token: () => 'no-such-session' } as Client;
    expect(await load(anonymous, second)).toBe(404);
    expect(await upload(alice, 'race')).toBe(404);
  });

  it('holds 30 pictures at most', async () => {
    const { alice, upload, values } = await gallery();
    for (let i = 0; i < 30; i++) expect(typeof (await upload(alice, 'gallery'))).toBe('string');
    expect(await upload(alice, 'gallery')).toBe(400);
    expect((await values(alice)).gallery).toHaveLength(30);
  });

  it('logs every gallery change so the DM can undo it', async () => {
    const { alice, dm, id, upload, values } = await gallery();
    const a = (await upload(alice, 'gallery')) as string;
    const b = (await upload(alice, 'gallery')) as string;
    await alice.entity.removePicture({ id, fieldId: 'gallery', fileId: b });
    const history = await dm.entity.history({ id });
    const removal = history.find((h) => h.target === 'field' && h.key === 'gallery')!;
    expect(removal).toMatchObject({ label: 'Portrait gallery', oldValue: [a, b], newValue: [a], canRevert: true });
    await dm.entity.revert({ changeId: removal.id });
    expect((await values(alice)).gallery).toEqual([a, b]);
  });
});
