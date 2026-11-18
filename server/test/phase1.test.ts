import { describe, expect, it } from 'vitest';
import { cleanHtml, htmlToText } from '../src/richtext';
import { attachImage, fieldAccess } from '../src/routers/entity';
import { parseTalents } from '../src/talents';
import { code, world } from './helpers';

const ALL = { all: true, players: [], parties: [] };

describe('custom fields on one character', () => {
  it('adds a section to one sheet only, and keeps values when a field is removed and put back', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const mine = await alice.entity.create({ systemId, typeKey: 'character', name: 'Bard' });
    const other = await dm.entity.create({ systemId, typeKey: 'character', name: 'Other' });
    const groups = [
      {
        id: 'c_limited',
        label: 'Limited Abilities',
        children: [
          { id: 'c_bardic', label: 'Bardic Inspiration', type: 'pool' as const },
          { id: 'c_marks', label: 'Marks', type: 'pips' as const, max: 3 },
        ],
      },
    ];
    await dm.entity.setCustomSchema({ id: mine.id, groups });

    // The owner uses the new fields like any other.
    await alice.entity.setField({ id: mine.id, fieldId: 'c_bardic', value: { cur: 2, max: 4 } });
    expect(await code(alice.entity.setField({ id: mine.id, fieldId: 'c_marks', value: 4 }))).toBe('BAD_REQUEST');
    const sheet = await alice.entity.get({ id: mine.id });
    expect(sheet.schema.groups.at(-1)).toMatchObject({ id: 'c_limited', label: 'Limited Abilities', custom: true });
    expect(sheet.values.c_bardic).toEqual({ cur: 2, max: 4 });

    // Another character does not have the field at all.
    expect((await dm.entity.get({ id: other.id })).schema.groups.map((g) => g.id)).not.toContain('c_limited');
    expect(await code(dm.entity.setField({ id: other.id, fieldId: 'c_bardic', value: { cur: 1, max: 1 } }))).toBe('FORBIDDEN');

    await dm.entity.setCustomSchema({ id: mine.id, groups: [] });
    expect((await alice.entity.get({ id: mine.id })).values.c_bardic).toBeUndefined();
    await dm.entity.setCustomSchema({ id: mine.id, groups });
    expect((await alice.entity.get({ id: mine.id })).values.c_bardic).toEqual({ cur: 2, max: 4 });

    // Only the DM builds sheets, and a custom id can never take over a field of the shared sheet.
    expect(await code(alice.entity.setCustomSchema({ id: mine.id, groups: [] }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.setCustomSchema({ id: mine.id, groups: [{ id: 'identity', label: 'x', children: [] }] }))).toBe('BAD_REQUEST');
    expect(
      await code(dm.entity.setCustomSchema({ id: mine.id, groups: [{ id: 'c_aaaa', label: 'x', children: [{ id: 'c_aaaa', label: 'y', type: 'text' }] }] })),
    ).toBe('BAD_REQUEST');
  });
});

const NOTE = `
1 Minor = 1

**Balance comments**
SECRET-BALANCE the third seal is overpriced

**Protection Protocol:**
- Level 1: Physical (basic)
- Level 2: Physical (improved)

**Talent Branches**

*Rule: you can't take an upgrade and its prerequisite on the same Contract level.*
*Points Total: 60*

---
NINE HELLS

1) Seal of Darkness Tree (Nine Hells)
	1) Name: First Seal of Darkness (+) {4.5 PP}
		1) Type: Milestone Upgrade
		2) Prereq: -
		3) TIer: 1
		4) Description:
			1) Grants ability to cast CHA-based spells
			2) Max Spell Circle: 1
	2) Name: Second Seal of Darkness (+) {3.5 PP}
		1) Type: Major Upgrade
		2) Prereq: First Seal
		3) TIer: 2
		4) Description: Max Spell Circle: 2
	3) Dark Bargain {5 PP}
		1) Type: Milestone Upgrade
		2) Prereq: Second Seal of Darkness and any 2 other talents
---
BATIM

2) Explorer Tree (Batim): about physical form
	1) Name: Perfect Form {1 PP}
		1) Type: Minor Upgrade
		2) Prereq: -
	2) Name: Black Hooves, Fiery Heart {6 PP}
		1) Type: Milestone Upgrade
		2) Prereq: any 2 talents in this tree
`;

describe('talent tree', () => {
  it('reads trees, costs, prerequisites, taken marks and tracks from the note', () => {
    const { data, picks, dmNotes } = parseTalents(NOTE);
    expect(data.pointsTotal).toBe(60);
    expect(data.rules).toHaveLength(1);
    expect(data.tracks).toEqual([{ name: 'Protection Protocol', levels: ['Level 1: Physical (basic)', 'Level 2: Physical (improved)'] }]);
    expect(data.patrons.map((p) => p.name)).toEqual(['Nine Hells', 'Batim']);
    const [seal, explorer] = [data.patrons[0]!.trees[0]!, data.patrons[1]!.trees[0]!];
    expect(explorer.about).toBe('physical form');
    expect(seal.talents.map((t) => [t.name, t.type, t.cost, t.tier])).toEqual([
      ['First Seal of Darkness', 'Milestone', 4.5, 1],
      ['Second Seal of Darkness', 'Major', 3.5, 2],
      ['Dark Bargain', 'Milestone', 5, null],
    ]);
    expect(seal.talents[0]!.description).toContain('Max Spell Circle: 1');
    expect(seal.talents[1]!.requires).toEqual(['first_seal_of_darkness']); // "First Seal" is a shortened name
    expect(seal.talents[2]).toMatchObject({ requires: ['second_seal_of_darkness'], anyOfTree: 2 });
    expect(explorer.talents[1]).toMatchObject({ name: 'Black Hooves, Fiery Heart', requires: [], anyOfTree: 2 });
    expect(Object.keys(picks)).toEqual(['first_seal_of_darkness', 'second_seal_of_darkness']);
    expect(dmNotes).toContain('SECRET-BALANCE');
  });

  it('gives the player the whole tree with costs but not the balance notes, and lets them mark talents', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Elara' });

    expect(await code(dm.entity.importTalents({ id, markdown: NOTE }))).toBe('BAD_REQUEST'); // module not attached
    await dm.entity.setModules({ id, modules: ['talent_tree'] });
    expect(await dm.entity.importTalents({ id, markdown: NOTE })).toEqual({ trees: 2, talents: 5, taken: 2 });
    expect(await code(alice.entity.importTalents({ id, markdown: NOTE }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.importTalents({ id, markdown: 'nothing here' }))).toBe('BAD_REQUEST');

    const forAlice = JSON.stringify(await alice.entity.get({ id }));
    expect(forAlice).toContain('Dark Bargain');
    expect(forAlice).toContain('4.5');
    expect(forAlice).not.toContain('SECRET-BALANCE');
    expect(JSON.stringify(await dm.entity.get({ id }))).toContain('SECRET-BALANCE');

    // The player marks a talent with its Contract level; the tree itself is the DM's.
    await alice.entity.setField({ id, fieldId: 'talents_taken', value: { first_seal_of_darkness: { level: 1 }, second_seal_of_darkness: { level: 2 } } });
    expect(await code(alice.entity.setField({ id, fieldId: 'talents', value: {} }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.setField({ id, fieldId: 'talents_taken', value: { x: { level: 'one' } } }))).toBe('BAD_REQUEST');

    // Loading the note again keeps the levels already entered.
    await dm.entity.importTalents({ id, markdown: NOTE });
    expect((await alice.entity.get({ id })).values.talents_taken).toEqual({
      first_seal_of_darkness: { level: 1 },
      second_seal_of_darkness: { level: 2 },
    });
  });
});

describe('Russian names, translations and the glossary', () => {
  it('stores a Russian name and a Russian text, and marks the text outdated when the English changes', async () => {
    const { dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Elara Fairhold' });
    await dm.entity.setVisibility({ id, audience: ALL });
    await alice.entity.setNameRu({ id, nameRu: 'Элара Фейрхольд' });
    await alice.entity.setField({ id, fieldId: 'description', value: '<p>A noble.</p>' });
    await alice.entity.setField({ id, fieldId: 'personal_secrets', value: '<p>SECRET-en</p>' });

    await dm.entity.setTranslation({ id, fieldId: 'description', text: '<p>Дворянка.</p>' });
    await dm.entity.setTranslation({ id, fieldId: 'personal_secrets', text: '<p>SECRET-ru</p>' });
    expect(await code(alice.entity.setTranslation({ id, fieldId: 'description', text: 'x' }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.setTranslation({ id, fieldId: 'race', text: 'x' }))).toBe('BAD_REQUEST');

    const sheet = await bob.entity.get({ id });
    expect(sheet.nameRu).toBe('Элара Фейрхольд');
    expect(sheet.translations.description).toEqual({ text: '<p>Дворянка.</p>', outdated: false });
    // A translation is hidden exactly where its source is hidden.
    expect(JSON.stringify(sheet)).not.toContain('SECRET-');
    expect(JSON.stringify(await alice.entity.get({ id }))).toContain('SECRET-ru');
    expect((await bob.entity.list({ systemId, typeKey: 'character' }))[0]!.nameRu).toBe('Элара Фейрхольд');

    await alice.entity.setField({ id, fieldId: 'description', value: '<p>A disgraced noble.</p>' });
    expect((await bob.entity.get({ id })).translations.description!.outdated).toBe(true);
    await dm.entity.setTranslation({ id, fieldId: 'description', text: '<p>Опальная дворянка.</p>' });
    expect((await bob.entity.get({ id })).translations.description!.outdated).toBe(false);
    await dm.entity.setTranslation({ id, fieldId: 'description', text: null });
    expect((await bob.entity.get({ id })).translations.description).toBeUndefined();

    // Names and translations survive export and import.
    await dm.entity.setTranslation({ id, fieldId: 'description', text: '<p>Текст</p>' });
    const copy = await dm.system.import({ data: JSON.parse(JSON.stringify(await dm.system.export({ systemId }))) });
    const copied = (await dm.entity.list({ systemId: copy.systemId, typeKey: 'character' }))[0]!;
    expect(copied.nameRu).toBe('Элара Фейрхольд');
    expect((await dm.entity.get({ id: copied.id })).translations.description!.text).toBe('<p>Текст</p>');
  });

  it('serves glossary terms that are open to players, and only those', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const term = await dm.entity.create({ systemId, typeKey: 'glossary', name: 'Perception' });
    await dm.entity.setNameRu({ id: term.id, nameRu: 'Наблюдательность' });
    await dm.entity.setField({ id: term.id, fieldId: 'definition', value: 'How well you notice things.' });
    await dm.entity.setField({ id: term.id, fieldId: 'aliases', value: ['Passive Perception'] });
    const hidden = await dm.entity.create({ systemId, typeKey: 'glossary', name: 'SECRET-term' });
    await dm.entity.setVisibility({ id: hidden.id, audience: { all: false, players: [], parties: [] } });

    const seen = await alice.entity.glossary({ systemId });
    expect(seen).toEqual([
      { id: term.id, term: 'Perception', ru: 'Наблюдательность', definition: 'How well you notice things.', aliases: ['Passive Perception'] },
    ]);
    expect(await dm.entity.glossary({ systemId })).toHaveLength(2);
    expect(await code(alice.entity.create({ systemId, typeKey: 'glossary', name: 'x' }))).toBe('FORBIDDEN');
  });
});

describe('rich text', () => {
  it('keeps formatting and removes anything that could run or track', () => {
    const dirty =
      '<div style="color:red" onclick="steal()"><span class="x">Hello</span> <b>bold</b><script>alert(1)</script>' +
      '<img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a></div><p><br></p>' +
      '<table><tr><td style="x">cell</td></tr></table><h2 id="t">Title</h2>';
    const clean = cleanHtml(dirty);
    expect(clean).toContain('<strong>bold</strong>');
    expect(clean).toContain('<h2>Title</h2>');
    expect(clean).toContain('<td>cell</td>');
    expect(clean).toContain('href="https://example.com"');
    for (const bad of ['script', 'onclick', 'onerror', 'javascript:', 'style=', 'class=', '<img', '<div', '<span']) expect(clean).not.toContain(bad);
    expect(htmlToText('<p>One</p><p>Two &amp; three</p>')).toBe('One\nTwo & three');
  });

  it('cleans what is saved, and treats empty formatting as an empty field', async () => {
    const { dm, systemId } = await world([]);
    const { id } = await dm.entity.create({ systemId, typeKey: 'character', name: 'T' });
    await dm.entity.setField({ id, fieldId: 'notes', value: '<p onclick="x()">Kept</p><script>alert(1)</script>' });
    expect((await dm.entity.get({ id })).values.notes).toBe('<p>Kept</p>');
    await dm.entity.setField({ id, fieldId: 'notes', value: '<p><br></p>' });
    expect((await dm.entity.get({ id })).values.notes).toBeUndefined();
  });
});

describe('images', () => {
  it('lets only someone who may edit a field put a picture in it, and only viewers of the field read it', async () => {
    const { db, dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Pictured' });

    // The upload route asks fieldAccess before storing anything.
    expect(fieldAccess(db, alice.userId(), id, 'portrait')).toMatchObject({ canEdit: true, field: { type: 'image' } });
    expect(fieldAccess(db, bob.userId(), id, 'portrait')).toBeNull(); // the sheet is not shared with Bob
    expect(fieldAccess(db, alice.userId(), id, 'gm_secrets')).toBeNull();
    expect(fieldAccess(db, alice.userId(), id, 'no_such_field')).toBeNull();

    const access = fieldAccess(db, alice.userId(), id, 'portrait')!;
    attachImage(db, access.row, 'portrait', alice.userId(), { id: 'file-id-0000001', mime: 'image/png', size: 10 });
    expect((await alice.entity.get({ id })).values.portrait).toBe('file-id-0000001');

    await dm.entity.setVisibility({ id, audience: ALL });
    expect(fieldAccess(db, bob.userId(), id, 'portrait')).toMatchObject({ canEdit: false });

    // A picture cannot be pointed at someone else's file by typing an id; it can only be removed.
    expect(await code(alice.entity.setField({ id, fieldId: 'portrait', value: 'another-file-id' }))).toBe('BAD_REQUEST');
    expect(await code(alice.entity.setField({ id, fieldId: 'portrait', value: null }))).toBe('OK');
    // Logged: the picture joined the gallery, became the portrait, and the portrait was emptied.
    expect((await dm.entity.history({ id })).filter((h) => h.target === 'field')).toHaveLength(3);
  });
});
