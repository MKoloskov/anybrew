import { describe, expect, it } from 'vitest';
import { checkFormula, evaluate } from '../src/formula';
import { effectiveSchema, listModules, listSchemas } from '../src/schemas';
import { allFields } from '../src/schemas/types';
import { PROFICIENCY_BONUS_2014 } from '../src/schemas/rule';
import { code, world, type Client } from './helpers';

const ALL = { all: true, players: [], parties: [] };

/** Adds the rules document that character sheets read their proficiency bonus from. */
async function addProficiencyRule(dm: Client, systemId: string) {
  const { id } = await dm.entity.create({ systemId, typeKey: 'rule', name: PROFICIENCY_BONUS_2014.name });
  await dm.entity.setField({ id, fieldId: 'formula_name', value: PROFICIENCY_BONUS_2014.formulaName });
  await dm.entity.setField({ id, fieldId: 'table', value: PROFICIENCY_BONUS_2014.table });
  return id;
}

describe('formulas', () => {
  const values: Record<string, unknown> = { str: 15, dex: 8, prof: true, bonus: '2', pool: { cur: 3, max: 5 }, pick: 'wis', wis: 18 };
  const calc = (formula: string) => evaluate(formula, (id) => values[id]);

  it('computes ability modifiers and totals', () => {
    expect(calc('mod(str)')).toBe(2);
    expect(calc('mod(dex)')).toBe(-1);
    expect(calc('mod(str) + prof * 3 + bonus')).toBe(7);
    expect(calc('10 + missing')).toBe(10);
    expect(calc('str * 5')).toBe(75);
    expect(calc('pool + 1')).toBe(4);
    expect(calc("mod(if(pick == 'int', str, if(pick == 'wis', wis, dex)))")).toBe(4);
    expect(calc('max(1, 2, 3) - min(4, 5) / 2')).toBe(1);
    expect(calc('-(2 + 3) * 2')).toBe(-10);
    expect(calc('1 / 0')).toBe(0);
  });

  it('gives null for a broken formula instead of failing', () => {
    expect(calc('mod(str')).toBeNull();
    expect(calc('explode(1)')).toBeNull();
    expect(calc('str $ 2')).toBeNull();
  });

  it('every formula in every schema parses and refers only to fields of that sheet', () => {
    for (const base of listSchemas()) {
      const schema = effectiveSchema(base.key, listModules(base.key).map((m) => m.key))!;
      const fields = allFields(schema);
      const ids = new Set(fields.map((f) => f.id));
      // A field id used twice would make two fields share one value.
      expect(ids.size, `duplicate field id in ${base.key}`).toBe(fields.length);
      for (const field of fields.filter((f) => f.type === 'computed'))
        for (const ref of checkFormula(field.formula!)) expect(ids.has(ref), `${field.id} uses unknown field ${ref}`).toBe(true);
    }
  });
});

describe('rules tables feed the sheets', () => {
  it('reads the proficiency bonus for the level from the rules document, and follows edits to it', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Hero' });
    const pb = async () => (await alice.entity.get({ id })).values.prof_bonus;

    // No rules document yet: the bonus is 0 rather than an error.
    await alice.entity.setField({ id, fieldId: 'level', value: 9 });
    expect(await pb()).toBe(0);

    const ruleId = await addProficiencyRule(dm, systemId);
    const expected = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
    for (const level of [1, 4, 5, 8, 9, 12, 13, 16, 17, 20]) {
      await alice.entity.setField({ id, fieldId: 'level', value: level });
      expect(await pb(), `level ${level}`).toBe(expected[level - 1]);
    }
    // Above the table the last row applies; the player cannot type the bonus in by hand.
    await alice.entity.setField({ id, fieldId: 'level', value: 25 });
    expect(await pb()).toBe(6);
    expect(await code(alice.entity.setField({ id, fieldId: 'prof_bonus', value: 9 }))).toBe('FORBIDDEN');

    // The DM homebrews the table: every sheet follows at once.
    await dm.entity.setField({ id: ruleId, fieldId: 'table', value: { columns: ['Level', 'Bonus'], rows: [['1', '1'], ['10', '7']] } });
    expect(await pb()).toBe(7);

    // Rules are open to players to read, but only the DM creates or edits them; a hidden rule still feeds the sheets.
    expect(await code(alice.entity.get({ id: ruleId }))).toBe('OK');
    expect(await code(alice.entity.setField({ id: ruleId, fieldId: 'body', value: 'x' }))).toBe('FORBIDDEN');
    await dm.entity.setVisibility({ id: ruleId, audience: { all: false, players: [], parties: [] } });
    expect(await code(alice.entity.get({ id: ruleId }))).toBe('NOT_FOUND');
    expect(await pb()).toBe(7);
    expect(await code(alice.entity.create({ systemId, typeKey: 'rule', name: 'x' }))).toBe('FORBIDDEN');
    expect(await code(dm.entity.setField({ id: ruleId, fieldId: 'table', value: { columns: ['a'], rows: [['1', '2']] } }))).toBe('BAD_REQUEST');
  });
});

describe('character sheet', () => {
  it('works out modifiers, saves, skills and passive perception from what is typed in', async () => {
    const { dm, systemId } = await world([]);
    const { id } = await dm.entity.create({ systemId, typeKey: 'character', name: 'Elara' });
    const set = (fieldId: string, value: unknown) => dm.entity.setField({ id, fieldId, value });
    await addProficiencyRule(dm, systemId);
    await set('wis', 16);
    await set('level', 5); // proficiency bonus +3
    await set('skill_perception_prof', true);
    await set('skill_perception_bonus', 1);
    await set('save_wis_prof', true);
    await set('str', 9);

    const sheet = (await dm.entity.get({ id })).values;
    expect(sheet.wis_mod).toBe(3);
    expect(sheet.skill_perception).toBe(7); // 3 + 3 + 1
    expect(sheet.passive_perception).toBe(17);
    expect(sheet.save_wis).toBe(6);
    expect(sheet.save_str).toBe(-1);
    expect(sheet.enc_medium).toBe(45);

    // Computed values cannot be written, and are not stored.
    expect(await code(set('wis_mod', 5))).toBe('FORBIDDEN');
    const exported = await dm.system.export({ systemId });
    expect(Object.keys(exported.entities[0]!.values)).not.toContain('wis_mod');
  });

  it('checks the new field types', async () => {
    const { dm, systemId } = await world([]);
    const { id } = await dm.entity.create({ systemId, typeKey: 'character', name: 'T' });
    const set = (fieldId: string, value: unknown) => code(dm.entity.setField({ id, fieldId, value }));
    expect(await set('kind', 'npc')).toBe('OK');
    expect(await set('kind', 'dragon')).toBe('BAD_REQUEST');
    expect(await set('inspiration', 4)).toBe('OK');
    expect(await set('inspiration', 5)).toBe('BAD_REQUEST');
    expect(await set('hit_dice', { cur: 2, max: 5 })).toBe('OK');
    expect(await set('hit_dice', { cur: 2 })).toBe('BAD_REQUEST');
    expect(await set('hit_dice', 3)).toBe('BAD_REQUEST');
    expect(await set('eq_special', ['Rope', 'Mirror'])).toBe('OK');
    expect(await set('eq_special', 'Rope')).toBe('BAD_REQUEST');
  });

  it('adds module groups only to the characters that have the module', async () => {
    const { dm, systemId, players } = await world(['alice']);
    const alice = players.alice!;
    const caster = await dm.entity.create({ systemId, typeKey: 'character', name: 'Caster' });
    const fighter = await dm.entity.create({ systemId, typeKey: 'character', name: 'Fighter' });
    await dm.entity.setVisibility({ id: caster.id, audience: ALL });

    expect(await code(dm.entity.setField({ id: caster.id, fieldId: 'cast_ability', value: 'cha' }))).toBe('FORBIDDEN');
    await dm.entity.setModules({ id: caster.id, modules: ['spellcasting'] });
    await dm.entity.setField({ id: caster.id, fieldId: 'cast_ability', value: 'cha' });
    await dm.entity.setField({ id: caster.id, fieldId: 'cha', value: 18 });
    await addProficiencyRule(dm, systemId);
    await dm.entity.setField({ id: caster.id, fieldId: 'level', value: 1 }); // proficiency bonus +2
    await dm.entity.setField({ id: caster.id, fieldId: 'slots_1', value: { cur: 1, max: 4 } });

    const sheet = await dm.entity.get({ id: caster.id });
    expect(sheet.values.spell_dc).toBe(14); // 8 + 2 + 4
    expect(sheet.values.spell_attack).toBe(6);
    expect(sheet.schema.groups.map((g) => g.id)).toContain('spell_slots');
    expect((await dm.entity.get({ id: fighter.id })).schema.groups.map((g) => g.id)).not.toContain('spell_slots');

    // Removing the module hides its fields; attaching it again brings the values back.
    await dm.entity.setModules({ id: caster.id, modules: [] });
    expect((await dm.entity.get({ id: caster.id })).values.slots_1).toBeUndefined();
    await dm.entity.setModules({ id: caster.id, modules: ['spellcasting'] });
    expect((await dm.entity.get({ id: caster.id })).values.slots_1).toEqual({ cur: 1, max: 4 });

    expect(await code(dm.entity.setModules({ id: caster.id, modules: ['no_such_module'] }))).toBe('BAD_REQUEST');
    expect(await code(alice.entity.setModules({ id: caster.id, modules: [] }))).toBe('FORBIDDEN');
    expect((await alice.entity.get({ id: caster.id })).availableModules).toEqual([]);
  });

  it('shows personal secrets to the owner and the DM, never to other players', async () => {
    const { dm, systemId, players } = await world(['alice', 'bob']);
    const alice = players.alice!;
    const bob = players.bob!;
    const { id } = await alice.entity.create({ systemId, typeKey: 'character', name: 'Alice PC' });
    await dm.entity.setVisibility({ id, audience: ALL });
    await alice.entity.setField({ id, fieldId: 'personal_secrets', value: 'SECRET-personal' });
    await dm.entity.setField({ id, fieldId: 'gm_secrets', value: 'SECRET-gm' });
    await dm.entity.setField({ id, fieldId: 'race', value: 'Human' });

    const forAlice = JSON.stringify(await alice.entity.get({ id }));
    const forBob = JSON.stringify(await bob.entity.get({ id }));
    expect(forAlice).toContain('SECRET-personal');
    expect(forAlice).not.toContain('SECRET-gm');
    expect(forBob).toContain('Human');
    expect(forBob).not.toContain('SECRET-');
    expect(forBob).not.toContain('Personal Secrets');
    expect(JSON.stringify(await dm.entity.get({ id }))).toContain('SECRET-gm');
    expect(await code(bob.entity.setField({ id, fieldId: 'personal_secrets', value: 'x' }))).toBe('FORBIDDEN');

    // The DM can open the group to someone on this one character.
    await dm.entity.setFieldVisibility({ id, nodeId: 'personal', audience: { all: false, players: [bob.userId()], parties: [] } });
    expect(JSON.stringify(await bob.entity.get({ id }))).toContain('SECRET-personal');
  });
});
