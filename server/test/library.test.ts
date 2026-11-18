import { describe, expect, it } from 'vitest';
import { code, world } from './helpers';

const ALL = { all: true, players: [], parties: [] };

describe('features, spells and items linked to a character', () => {
  it('lists what a character has, with the few values a list needs, and hides what the viewer may not see', async () => {
    const { dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;
    const sheet = await alice.entity.create({ systemId, typeKey: 'character', name: 'Rogue' });

    // The libraries are the DM's; players read them.
    expect(await code(alice.entity.create({ systemId, typeKey: 'feature', name: 'Mine' }))).toBe('FORBIDDEN');
    const feature = await dm.entity.create({ systemId, typeKey: 'feature', name: 'Sneak Attack' });
    await dm.entity.setNameRu({ id: feature.id, nameRu: 'Скрытая атака' });
    await dm.entity.setField({ id: feature.id, fieldId: 'ftype', value: 'Class feature' });
    await dm.entity.setField({ id: feature.id, fieldId: 'class', value: 'Rogue' });
    await dm.entity.setField({ id: feature.id, fieldId: 'tier', value: 1 });
    const spell = await dm.entity.create({ systemId, typeKey: 'spell', name: 'Light' });
    await dm.entity.setField({ id: spell.id, fieldId: 'circle', value: 0 });
    const potion = await dm.entity.create({ systemId, typeKey: 'item', name: 'Potion of Healing' });
    const secret = await dm.entity.create({ systemId, typeKey: 'item', name: 'Cursed Ring' });
    await dm.entity.setVisibility({ id: secret.id, audience: { all: false, players: [], parties: [] } });

    // The owner of the sheet links what they can see.
    await alice.entity.link({ fromId: sheet.id, kind: 'has', toId: feature.id });
    await alice.entity.link({ fromId: sheet.id, kind: 'knows', toId: spell.id });
    await alice.entity.link({ fromId: sheet.id, kind: 'owns', toId: potion.id, data: { quantity: 3 } });
    expect(await code(alice.entity.link({ fromId: sheet.id, kind: 'owns', toId: secret.id }))).toBe('NOT_FOUND');
    await dm.entity.link({ fromId: sheet.id, kind: 'owns', toId: secret.id });

    const mine = await alice.entity.links({ id: sheet.id });
    expect(mine.map((l) => l.other.name).sort()).toEqual(['Light', 'Potion of Healing', 'Sneak Attack']);
    expect(mine.find((l) => l.kind === 'has')!.other).toMatchObject({
      nameRu: 'Скрытая атака',
      typeKey: 'feature',
      info: { ftype: 'Class feature', class: 'Rogue', tier: 1 },
    });
    expect(mine.find((l) => l.kind === 'knows')!.other.info.circle).toBe(0);
    expect(mine.find((l) => l.kind === 'owns')!.data).toEqual({ quantity: 3 });
    expect(await dm.entity.links({ id: sheet.id })).toHaveLength(4);

    // The feature list carries what the table sorts and filters by, and who has each feature.
    const listed = (await alice.entity.list({ systemId, typeKey: 'feature' })).find((f) => f.id === feature.id)!;
    expect(listed.info).toMatchObject({ ftype: 'Class feature', class: 'Rogue', tier: 1 });
    expect(listed.holderIds).toEqual([sheet.id]);
    // Bob may not see Alice's sheet, so he is not told that she has the feature.
    expect((await bob.entity.list({ systemId, typeKey: 'feature' })).find((f) => f.id === feature.id)!.holderIds).toEqual([]);
    // The DM-only ring is held by the sheet, which only the DM learns.
    expect((await dm.entity.list({ systemId, typeKey: 'item' })).find((i) => i.id === secret.id)!.holderIds).toEqual([sheet.id]);
    expect((await alice.entity.list({ systemId, typeKey: 'item' })).some((i) => i.id === secret.id)).toBe(false);

    // From the library side the feature shows who has it, but only to someone who may see that character.
    expect((await alice.entity.links({ id: feature.id })).map((l) => [l.direction, l.other.name])).toEqual([['in', 'Rogue']]);
    expect(await bob.entity.links({ id: feature.id })).toEqual([]);
    await dm.entity.setVisibility({ id: sheet.id, audience: ALL });
    // Bob sees the character now, but what it has stays between its owner and the DM.
    expect(await bob.entity.links({ id: feature.id })).toEqual([]);
    expect(await bob.entity.links({ id: sheet.id })).toEqual([]);
    expect((await bob.entity.list({ systemId, typeKey: 'feature' })).find((f) => f.id === feature.id)!.holderIds).toEqual([]);
    // And he may not change what is on it.
    const link = mine.find((l) => l.kind === 'has')!;
    expect(await code(bob.entity.unlink({ linkId: link.id }))).toBe('FORBIDDEN');
    expect(await code(alice.entity.unlink({ linkId: link.id }))).toBe('OK');
  });
});

describe('characters by campaign and kind', () => {
  it('a character is filed under several campaigns and is a PC, an NPC or an Aux', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const a = (await dm.system.createCampaign({ systemId, name: 'Heart of Anauroch' })).id;
    const b = (await dm.system.createCampaign({ systemId, name: 'Second Table' })).id;
    const guard = await dm.entity.create({ systemId, typeKey: 'character', name: 'Gate Guard' });
    await dm.entity.setCampaigns({ id: guard.id, campaignIds: [a, b] });
    await dm.entity.setField({ id: guard.id, fieldId: 'kind', value: 'aux' });
    const listed = (await dm.entity.list({ systemId, typeKey: 'character' })).find((c) => c.id === guard.id)!;
    expect(listed.campaignIds).toEqual([a, b]);
    expect(listed.info.kind).toBe('aux');
    // The kind is the DM's to set, and only the three kinds exist.
    const own = await players.alice!.entity.create({ systemId, typeKey: 'character', name: 'Hero' });
    expect(await code(players.alice!.entity.setField({ id: own.id, fieldId: 'kind', value: 'pc' }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.setField({ id: guard.id, fieldId: 'kind', value: 'extra' }))).toBe('BAD_REQUEST');
  });
});

describe('classes from the Rules section', () => {
  const file = {
    anybrew: 'class',
    name: 'Alternate Wizard',
    body: '<h2>Alternate Wizard</h2><p>A homebrew wizard.</p><script>alert(1)</script>',
    hitDie: 6,
    saves: ['int', 'wis'],
    armor: 'None',
    weapons: 'Daggers, quarterstaffs',
    subclassTitle: 'Arcane Tradition',
    subclasses: ['Evoker', 'Diviner'],
    table: { columns: ['Level', 'Features', 'Cantrips Known'], rows: [['1', 'Spellcasting', '3'], ['2', 'Arcane Tradition', '3'], ['4', '-', '4']] },
    features: [
      { name: 'Spellcasting', level: 1, description: '<p>You cast spells.</p>' },
      { name: 'Arcane Recovery', level: 1 },
      { name: 'Sculpt Spells', level: 2, subclass: 'Evoker' },
      { name: 'Portent', level: 2, subclass: 'Diviner' },
      { name: 'Empowered Evocation', level: 10, subclass: 'Evoker' },
    ],
  };

  it('a class file is reviewed, imported, and feeds the sheet of a character that takes the class', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    expect(await code(alice.entity.importClass({ systemId, data: file, dryRun: true }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.importClass({ systemId, data: { anybrew: 'class' }, dryRun: true }))).toBe('BAD_REQUEST');

    // The review writes nothing.
    const review = await dm.entity.importClass({ systemId, data: file, dryRun: true });
    expect(review).toMatchObject({ name: 'Alternate Wizard', status: 'new', hitDie: 6, saves: 'INT, WIS', tableLevels: 3, ruleId: null });
    expect(review.features.map((f) => f.status)).toEqual(['new', 'new', 'new', 'new', 'new']);
    expect(await dm.entity.list({ systemId, typeKey: 'feature' })).toHaveLength(0);

    // Imported without Arcane Recovery.
    const skipped = review.features.find((f) => f.name === 'Arcane Recovery')!.key;
    const { ruleId } = await dm.entity.importClass({ systemId, data: file, dryRun: false, skip: [skipped] });
    const rule = await dm.entity.get({ id: ruleId! });
    expect(rule.modules).toEqual(['class']);
    expect(rule.values).toMatchObject({ hit_die: 6, class_saves: 'INT, WIS', subclasses: ['Evoker', 'Diviner'] });
    expect(String(rule.values.body)).not.toContain('script');
    const features = await dm.entity.list({ systemId, typeKey: 'feature' });
    expect(features.map((f) => f.name).sort()).toEqual(['Empowered Evocation', 'Portent', 'Sculpt Spells', 'Spellcasting']);
    expect(features.find((f) => f.name === 'Portent')!.info).toMatchObject({ ftype: 'Class feature', class: 'Alternate Wizard', subclass: 'Diviner', tier: 2 });
    expect((await dm.entity.list({ systemId, typeKey: 'rule' })).find((r) => r.id === ruleId)!.isClass).toBe(true);

    // The same file again updates what exists instead of doubling it.
    const again = await dm.entity.importClass({ systemId, data: file, dryRun: true });
    expect(again.status).toBe('update');
    expect(again.features.map((f) => f.status)).toEqual(['update', 'new', 'update', 'update', 'update']);
    await dm.entity.importClass({ systemId, data: file, dryRun: false, skip: [skipped] });
    expect(await dm.entity.list({ systemId, typeKey: 'feature' })).toHaveLength(4);

    // Alice takes the class at level 2 as an Evoker.
    const sheet = await alice.entity.create({ systemId, typeKey: 'character', name: 'Mira' });
    expect(await code(alice.entity.setField({ id: sheet.id, fieldId: 'classes', value: [{ classId: 'nope', subclass: null, level: 1 }] }))).toBe('BAD_REQUEST');
    await alice.entity.setField({ id: sheet.id, fieldId: 'classes', value: [{ classId: ruleId, subclass: 'Evoker', level: 2 }] });
    const mira = await alice.entity.get({ id: sheet.id });
    expect(mira.values).toMatchObject({
      level: 2,
      hit_dice_kind: '2d6',
      hit_dice: { cur: 2, max: 2 },
      save_int_prof: true,
      save_wis_prof: true,
      prof_weapons_default: 'Daggers, quarterstaffs',
    });
    expect(mira.values.save_str_prof).toBeUndefined();
    const [info] = await alice.entity.classInfo({ id: sheet.id });
    expect(info).toMatchObject({ found: true, name: 'Alternate Wizard', hitDie: 6, subclasses: ['Evoker', 'Diviner'] });
    if (!info?.found) throw new Error('class not found');
    expect(info.tableRow).toEqual([{ column: 'Features', value: 'Arcane Tradition' }, { column: 'Cantrips Known', value: '3' }]);
    // Her own subclass up to her level: not the Diviner's feature, not the level 10 one.
    expect(info.features.map((f) => f.name)).toEqual(['Spellcasting', 'Sculpt Spells']);

    // A level-up keeps hand edits of what the first class filled in, and reads the table line below the level.
    await alice.entity.setField({ id: sheet.id, fieldId: 'prof_weapons_default', value: 'Daggers only' });
    await alice.entity.setField({ id: sheet.id, fieldId: 'classes', value: [{ classId: ruleId, subclass: 'Evoker', level: 10 }] });
    const later = await alice.entity.get({ id: sheet.id });
    expect(later.values).toMatchObject({ level: 10, hit_dice_kind: '10d6', hit_dice: { cur: 2, max: 10 }, prof_weapons_default: 'Daggers only' });
    const [atTen] = await alice.entity.classInfo({ id: sheet.id });
    if (!atTen?.found) throw new Error('class not found');
    expect(atTen.tableRow).toEqual([{ column: 'Cantrips Known', value: '4' }]);
    expect(atTen.features.map((f) => f.name)).toEqual(['Spellcasting', 'Sculpt Spells', 'Empowered Evocation']);

    // A class the player may not see cannot be taken and gives nothing.
    await dm.entity.setVisibility({ id: ruleId!, audience: { all: false, players: [], parties: [] } });
    expect(await code(alice.entity.setField({ id: sheet.id, fieldId: 'classes', value: [{ classId: ruleId, subclass: null, level: 3 }] }))).toBe('BAD_REQUEST');
    expect(await alice.entity.classInfo({ id: sheet.id })).toMatchObject([{ found: false }]);
  });

  it('two classes add up: level and hit dice', async () => {
    const { dm, systemId } = await world([]);
    const make = async (name: string, die: number) => {
      const { ruleId } = await dm.entity.importClass({ systemId, data: { anybrew: 'class', name, hitDie: die, saves: ['cha'] }, dryRun: false });
      return ruleId!;
    };
    const sorcerer = await make('Sorcerer', 6);
    const cleric = await make('Cleric', 8);
    const sheet = await dm.entity.create({ systemId, typeKey: 'character', name: 'Esther' });
    await dm.entity.setField({
      id: sheet.id,
      fieldId: 'classes',
      value: [{ classId: sorcerer, subclass: null, level: 4 }, { classId: cleric, subclass: null, level: 1 }],
    });
    expect((await dm.entity.get({ id: sheet.id })).values).toMatchObject({ level: 5, hit_dice_kind: '4d6 + 1d8', hit_dice: { cur: 5, max: 5 }, save_cha_prof: true });
  });
});
