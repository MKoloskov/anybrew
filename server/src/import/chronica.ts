// One-time conversion of a Chronica campaign export into a system of this app.
//
//   npm run import:chronica -w server -- "<folder with the export .json files>" [--dry] [--replace]
//       [--talents "<English character name>=<path to the talent note>"]
//
// The folder also holds the approved English names ("English names*.md", tables of Russian | English).
// The script writes "_import-map.json" (what it created, so --replace can remove exactly that)
// and "Import report.md" into the same folder. Nothing from the export is stored in this repository.
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db';
import { changes, entities, links, members, systems, translations } from '../db/schema';
import { cleanHtml, htmlToText } from '../richtext';
import { checkValue } from '../routers/entity';
import { effectiveSchema } from '../schemas';
import { LINK_KIND, typeAndClassOf } from '../schemas/library';
import { allFields, type SchemaGroup } from '../schemas/types';
import { parseTalents } from '../talents';
import { DM_ONLY, EVERYONE, type Audience } from '../visibility';

type Json = Record<string, any>;

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && !a.includes('='));
const dry = args.includes('--dry');
const replace = args.includes('--replace');
const talentArg = args[args.indexOf('--talents') + 1];
if (!dir || !fs.existsSync(dir)) {
  console.error('Give the folder with the Chronica export files.');
  process.exit(1);
}

// ---------- Reading the export ----------

const campaign: Json = {};
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')))
  Object.assign(campaign, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).campaign);

const report: string[] = [];
const say = (line = '') => report.push(line);

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const CYRILLIC = /[А-Яа-яЁё]/;

/** Russian → English, from the approval lists next to the export. */
const english = new Map<string, string>();
for (const file of fs.readdirSync(dir).filter((f) => /^English names.*\.md$/.test(f)))
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
    const m = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|/.exec(line);
    if (m && m[1] !== 'Russian' && !/^-+$/.test(m[1]!)) english.set(squash(m[1]!), squash(m[2]!));
  }

type Name = { name: string; nameRu: string | null; prefixes: string[] };
const missingEnglish: string[] = [];

/** "[3] Threads of Fate / Нити Судьбы" → English name, Russian name and the bracketed prefixes. */
function splitName(raw: string, stripPrefixes: boolean): Name {
  let en = squash(raw);
  let ru: string | null = null;
  const slash = en.indexOf(' / ');
  if (slash > 0 && CYRILLIC.test(en.slice(slash)) && !CYRILLIC.test(en.slice(0, slash))) {
    ru = en.slice(slash + 3).trim();
    en = en.slice(0, slash).trim();
  } else if (CYRILLIC.test(en)) {
    ru = en;
    const known = english.get(en);
    if (known) en = known;
    else missingEnglish.push(en);
  }
  const prefixes: string[] = [];
  if (stripPrefixes) {
    const strip = (s: string, collect: boolean) => {
      let out = s;
      for (let m = /^\[([^\]]+)\]\s*/.exec(out); m; m = /^\[([^\]]+)\]\s*/.exec(out)) {
        if (collect) prefixes.push(m[1]!.trim());
        out = out.slice(m[0].length);
      }
      return out.trim();
    };
    en = strip(en, true);
    if (ru) ru = strip(ru, false);
  }
  return { name: en, nameRu: ru && ru !== en ? ru : null, prefixes };
}

/** Chronica's own tag badges and other leftovers, then the app's normal clean-up. */
function html(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const cleaned = cleanHtml(raw.replace(/<a\b[^>]*chronica\.ventures[^>]*>[\s\S]*?<\/a>/g, ''))
    // A link with nothing in it.
    .replace(/<a\b[^>]*>\s*<\/a>/g, '')
    .trim();
  const flat = unwrapLayoutTables(cleaned)
    .replace(/<h1>/g, '<h2>')
    .replace(/<\/h1>/g, '</h2>')
    .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/g, '')
    .trim();
  return htmlToText(flat).trim() ? flat : null;
}

/**
 * Text copied from rule sites arrives as a table with one cell per row, used only for layout.
 * Such a table becomes ordinary paragraphs; a real table (several cells in a row) stays a table.
 */
function unwrapLayoutTables(input: string): string {
  let out = input;
  for (let pass = 0; pass < 5; pass++) {
    // Innermost tables first: a table that has no other table inside it.
    const next = out.replace(/<table>((?:(?!<table)[\s\S])*?)<\/table>/g, (whole, inner: string) => {
      const rows = [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]!.trim()));
      if (!rows.length || rows.some((cells) => cells.length > 1)) return whole.replace('<table>', '<table data-kept>');
      return rows
        .flat()
        .filter((cell) => cell !== '')
        .map((cell) => (/^<(p|h\d|ul|ol|table|blockquote)\b/.test(cell) ? cell : `<p>${cell}</p>`))
        .join('');
    });
    if (next === out) break;
    out = next;
  }
  return out.replace(/<table data-kept>/g, '<table>');
}
const plain = (raw: unknown) => (typeof raw === 'string' && htmlToText(raw).trim() ? htmlToText(raw).trim() : null);

function number(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(',', '.').replace('−', '-');
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const m = /^[+-]?\d+(\.\d+)?/.exec(s);
  return m ? Number(m[0]) : null;
}

// ---------- What will be created ----------

type NewEntity = {
  id: string;
  typeKey: string;
  name: string;
  nameRu: string | null;
  visibility: Audience;
  modules: string[];
  customSchema: SchemaGroup[];
  values: Record<string, unknown>;
};
type NewLink = { id: string; fromId: string; kind: string; toId: string; data: Record<string, unknown> };

const created: NewEntity[] = [];
const newLinks: NewLink[] = [];
const entity = (typeKey: string, n: { name: string; nameRu: string | null }, visibility: Audience, values: Record<string, unknown>): NewEntity => {
  const e: NewEntity = { id: nanoid(), typeKey, name: n.name.slice(0, 200), nameRu: n.nameRu, visibility, modules: [], customSchema: [], values: {} };
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) e.values[k] = v;
  created.push(e);
  return e;
};
const link = (from: NewEntity, to: NewEntity, data: Record<string, unknown> = {}) => {
  const kind = LINK_KIND[to.typeKey]!;
  if (newLinks.some((l) => l.fromId === from.id && l.toId === to.id)) return;
  newLinks.push({ id: nanoid(), fromId: from.id, kind, toId: to.id, data });
};

// ---------- Features and spells (Chronica "abilities") ----------

const SPELL_CIRCLE: Record<string, number> = { Cantrips: 0, '1st level': 1, '2nd level': 2, '3rd level': 3, '4th level': 4 };
const ACTION: Record<string, string> = { A: 'Action', Bonus: 'Bonus action', R: 'Reaction', Reaction: 'Reaction' };
const CATEGORY_FIX: Record<string, string> = { 'Special Abilties': 'Special Abilities' };

const abilityTypes: Json[] = [...(campaign.ability_types ?? []), ...(campaign.ability_type_folders ?? []).flatMap((f: Json) => f.ability_types ?? [])];
const abilityById = new Map<string, NewEntity>();
/** Spells and items are found again by their English name, because the same one appears in several places. */
const libraryByName = new Map<string, NewEntity>();
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, ' ').trim();
const merged: string[] = [];
const abilitySource = new Map<NewEntity, Json>();

for (const type of abilityTypes) {
  const circle = SPELL_CIRCLE[type.name as string];
  const category = CATEGORY_FIX[type.name] ?? type.name;
  for (const a of type.abilities ?? []) {
    const n = splitName(a.name, true);
    const tier = n.prefixes.map((p) => (/^\d+$/.test(p) ? Number(p) : null)).find((p) => p !== null) ?? null;
    const action = n.prefixes.map((p) => ACTION[p]).find(Boolean) ?? null;
    const tags = [...n.prefixes.filter((p) => !/^\d+$/.test(p) && !ACTION[p]), ...((a.abilitytag_list as string[] | null) ?? [])];
    const e =
      circle !== undefined
        ? entity('spell', n, EVERYONE, { circle, action, tags, summary: plain(a.short_description), description: html(a.long_description) })
        : entity('feature', n, EVERYONE, { ...typeAndClassOf(category), tier, action, tags, summary: plain(a.short_description), description: html(a.long_description) });
    abilityById.set(String(a.id), e);
    abilitySource.set(e, a);
    if (circle !== undefined) libraryByName.set(key(n.name), e);
  }
}

// ---------- Items (and the spells that were kept as library items) ----------

const CONTAINER_CIRCLE: Record<string, number> = { Cantrips: 0, '1st level spells': 1, '2nd level spells': 2, '3rd level spells': 3, '4th level spells': 4 };

function libraryItem(raw: Json, opts: { circle?: number; personal: boolean; carried?: boolean }): NewEntity {
  const n = splitName(raw.name, false);
  const existing = libraryByName.get(key(n.name));
  const description = html(raw.description);
  if (existing) {
    // The same spell or item written down twice: keep one, with the longer text.
    const had = (existing.values.description as string | undefined) ?? '';
    if (description && htmlToText(description).length > htmlToText(had).length) existing.values.description = description;
    if (!existing.nameRu && n.nameRu) existing.nameRu = n.nameRu;
    if (!opts.carried && !merged.includes(existing.name)) merged.push(existing.name);
    return existing;
  }
  const e =
    opts.circle !== undefined
      ? entity('spell', n, EVERYONE, { circle: opts.circle, tags: raw.item_tags ?? [], description })
      : entity('item', n, opts.personal ? DM_ONLY : EVERYONE, {
          weight: number(raw.weight),
          value: number(raw.value) || null,
          tags: raw.item_tags ?? [],
          description,
        });
  libraryByName.set(key(n.name), e);
  return e;
}

for (const library of campaign.master_item_library ?? []) {
  for (const raw of library.inventory_items ?? []) libraryItem(raw, { personal: false });
  for (const container of library.containers ?? []) {
    const circle = CONTAINER_CIRCLE[container.name as string];
    // A container that is not a spell level holds one character's own things.
    for (const raw of container.inventory_items ?? []) libraryItem(raw, { circle, personal: circle === undefined });
  }
}

// ---------- Characters ----------

const statInfo = new Map<number, { group: string; name: string; type: string }>();
for (const g of (campaign.stat_group_folders ?? []).flatMap((f: Json) => f.stat_groups ?? []).concat(campaign.stat_groups ?? []))
  for (const s of g.stats ?? []) statInfo.set(s.id, { group: g.name, name: squash(s.name), type: s.input_type });

const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILL_ABILITY: Record<string, string> = {
  athletics: 'str', acrobatics: 'dex', stealth: 'dex', sleight_of_hand: 'dex', arcana: 'int', history: 'int', nature: 'int',
  religion: 'int', investigation: 'int', perception: 'wis', insight: 'wis', animal_handling: 'wis', medicine: 'wis', survival: 'wis',
  persuasion: 'cha', deception: 'cha', intimidation: 'cha', performance: 'cha',
};
const CAST_ABILITY: [RegExp, string][] = [
  [/sorcerer|bard|warlock|paladin/i, 'cha'],
  [/wizard|artificer/i, 'int'],
  [/cleric|druid|ranger|monk/i, 'wis'],
];
const SUPPLY: Record<string, string> = { Hardware: 'supply_hardware', 'Binders & Containers': 'supply_binders', Alchemical: 'supply_alchemical', Magical: 'supply_magical' };
const SUPPLY_LEVEL = ['lots', 'some', 'few', 'none'];
const SLOT: Record<string, string> = { '1st Level': 'slots_1', '2nd Level': 'slots_2', '3rd Level': 'slots_3', '4th Level': 'slots_4' };
const KNOWN: Record<string, [string, number]> = { Cantrips: ['spells_0', 0], '1st Circle': ['spells_1', 1], '2nd Circle': ['spells_2', 2], '3rd Circle': ['spells_3', 3], '4th Circle': ['spells_4', 4] };
const MASK: Record<string, string> = { 'Mask of the Queen': 'mask_queen', 'Mask of the Shadow': 'mask_shadow' };
const SLOTS3 = ['main', 'secondary', 'backup'];
const SOURCES = ['default', 'background', 'bonus'];
const WORN = ['eq_body', 'eq_head', 'eq_back', 'eq_ring', 'eq_neck', 'eq_feet'];
const PROFICIENCY: Record<string, string> = { Weapons: 'prof_weapons', Armor: 'prof_armor', Tools: 'prof_tools', Languages: 'prof_languages' };

const mod = (score: unknown) => (typeof score === 'number' ? Math.floor((score - 10) / 2) : 0);

type Sheet = { e: NewEntity; raw: Json };
const sheets: Sheet[] = [];
const characterByChronicaId = new Map<number, NewEntity>();

function character(raw: Json, proficiencyBonus: (level: number | null) => number): NewEntity {
  const n = splitName(raw.name, false);
  const v: Record<string, unknown> = {};
  const notes: string[] = [];
  const note = (text: string) => notes.push(text);
  const modules = new Set<string>();
  const filled = (x: unknown) => typeof x === 'string' && x.trim() !== '' && x.trim() !== '??';
  const text = (x: unknown) => (filled(x) ? squash(x as string).slice(0, 500) : null);

  v.kind = raw.special === 'Main Character' ? 'pc' : 'npc';
  v.race = text(raw.race);
  v.class = text(raw.npc_class);
  v.gender = raw.gender === 'Unknown' ? null : text(raw.gender);
  v.age = text(typeof raw.title === 'string' ? raw.title.replace(/^Age:\s*/i, '') : null);
  v.alignment = text(raw.alignment);
  v.faction = text(raw.faction);
  v.disposition = raw.disposition === 'Unknown' ? null : text(raw.disposition);
  v.status = ['alive', 'dead', 'missing', 'unknown'].includes(String(raw.status).toLowerCase()) ? String(raw.status).toLowerCase() : null;
  v.description = html(raw.description);
  const linksHtml = ((raw.target_links as Json[] | undefined) ?? []).map((l) => `<p><a href="${l.link}">${l.title}</a></p>`).join('');
  v.notes = html((raw.notes && raw.notes !== raw.description ? raw.notes : '') + linksHtml);
  v.personal_secrets = html(raw.personal_secrets);
  v.gm_secrets = html(raw.gm_secrets);

  const counts = new Map<number, number>();
  for (const c of raw.char_stat_input_counts ?? []) if (typeof c.value === 'number') counts.set(c.stat_id, c.value);
  const data = new Map<string, { values: string[]; count: number | null; id: number; type: string }>();
  for (const row of raw.char_stat_data ?? []) {
    const info = statInfo.get(row.stat_id);
    if (!info) continue;
    data.set(`${info.group} / ${info.name}`, {
      values: ((row.value as unknown[] | null) ?? []).map((x) => String(x ?? '').trim()),
      count: counts.get(row.stat_id) ?? null,
      id: row.stat_id,
      type: info.type,
    });
  }
  // A count can exist for a stat that has no values yet.
  for (const [id, count] of counts) {
    const info = statInfo.get(id);
    if (info && !data.has(`${info.group} / ${info.name}`)) data.set(`${info.group} / ${info.name}`, { values: [], count, id, type: info.type });
  }
  const used = new Set<string>();
  const take = (name: string) => {
    used.add(name);
    return data.get(name) ?? { values: [] as string[], count: null, id: 0, type: '' };
  };
  const ticked = (values: string[]) => values.filter((x) => x === 'true').length;
  /** Tick boxes with a set number of boxes: a pool whose ticked boxes are the uses already spent. */
  const pool = (s: { values: string[]; count: number | null }, fallbackMax: number | null = null) => {
    const typed = s.values.map(number).find((x) => x !== null && !['true', 'false'].includes(String(x))) ?? null;
    const max = s.count ?? typed ?? fallbackMax;
    if (max === null || max <= 0) return null;
    return { cur: Math.max(0, max - ticked(s.values)), max };
  };

  // General
  const levelText = take('General Stats / Level').values[0] ?? '';
  v.level = number(levelText);
  const levelDetail = /\((.+)\)/.exec(levelText)?.[1];
  if (levelDetail && typeof v.class === 'string') v.class = `${v.class} (${levelDetail})`;
  const pb = proficiencyBonus(v.level as number | null);
  const typedPb = number(take('General Stats / Proficiency Bonus').values[0]);
  if (typedPb !== null && typedPb !== pb) note(`Proficiency Bonus was typed as ${typedPb}; the rules table gives ${pb} at level ${v.level}.`);
  v.inspiration = Math.min(4, number(take('General Stats / Inspiration').values[0]) ?? 0) || null;
  v.height = text(take('General Stats / Height').values[0]);
  v.weight = text(take('General Stats / Weight').values[0]);

  // Abilities, saves, skills
  for (const id of ABILITY_IDS) {
    const stat = [...data.keys()].find((k) => k.startsWith('Primary Stats / ') && k.includes(`(${id.toUpperCase()})`));
    if (stat) v[id] = number(take(stat).values[0]);
  }
  const proficient = (flag: string | undefined) => !!flag && flag.trim() !== '' && !/^(no|false|-)$/i.test(flag.trim());
  for (const id of ABILITY_IDS) {
    const s = take(`Saves / Save - ${id.toUpperCase()}`);
    const total = number(s.values[0]);
    const prof = proficient(s.values[1]);
    if (prof) v[`save_${id}_prof`] = true;
    if (total === null) continue;
    const bonus = total - mod(v[id]) - (prof ? pb : 0);
    if (bonus) {
      v[`save_${id}_bonus`] = bonus;
      note(`Save ${id.toUpperCase()}: typed ${total}, the rules give ${total - bonus}; the difference (${bonus > 0 ? '+' : ''}${bonus}) is kept as Bonus.`);
    }
  }
  for (const [id, ability] of Object.entries(SKILL_ABILITY)) {
    const label = id.replace(/_/g, ' ');
    const stat = [...data.keys()].find((k) => k.toLowerCase().startsWith(`skills / ${label} /`));
    if (!stat) continue;
    const s = take(stat);
    const total = number(s.values[0]);
    const prof = proficient(s.values[1]);
    if (prof) v[`skill_${id}_prof`] = true;
    if (total === null) continue;
    const bonus = total - mod(v[ability]) - (prof ? pb : 0);
    if (bonus) {
      v[`skill_${id}_bonus`] = bonus;
      const flag = s.values[1] && !/^yes$/i.test(s.values[1]) ? ` (marked “${s.values[1]}”)` : '';
      note(`Skill ${label}${flag}: typed ${total}, the rules give ${total - bonus}; the difference (${bonus > 0 ? '+' : ''}${bonus}) is kept as Bonus.`);
    }
  }

  // Secondary
  const ac = take('Secondary Stats / Armor Class (AC)').values;
  if (filled(ac[0]) || filled(ac[1])) {
    const plainNumber = /^\d+$/.test(ac[0] ?? '');
    v.ac = /^\d+/.test(ac[0] ?? '') ? number(ac[0]) : null;
    v.ac_calc = text(plainNumber ? ac[1] : [ac[0], ac[1]].filter(filled).join('; '));
    if (!plainNumber) note(`Armor Class was typed as “${ac[0]}”: the number field holds ${v.ac ?? 'nothing'}, the full text is in Calculation.`);
  }
  const hp = take('Secondary Stats / Hit Points (HP)').values;
  v.hp = number(hp[0]);
  v.hp_temp = number(hp[1]) || null;
  v.hp_max = number(hp[2]);
  const diceText = take('Secondary Stats / Hit Dice Total').values[0] ?? '';
  const diceCurrent = take('Secondary Stats / Hit Dice Current');
  if (filled(diceText)) {
    v.hit_dice_kind = text(diceText);
    const total = [...diceText.matchAll(/(\d+)\s*d\s*\d+/gi)].reduce((sum, m) => sum + Number(m[1]), 0);
    if (total) v.hit_dice = { cur: Math.max(0, total - ticked(diceCurrent.values)), max: total };
  }
  const speed = take('Secondary Stats / Speed').values;
  ['speed_walk', 'speed_climb', 'speed_swim', 'speed_fly'].forEach((id, i) => (v[id] = number(speed[i])));
  const initiative = number(take('Secondary Stats / Initiative').values[0]);
  if (initiative !== null && initiative - mod(v.dex)) {
    v.initiative_bonus = initiative - mod(v.dex);
    note(`Initiative: typed ${initiative}, Dexterity gives ${mod(v.dex)}; the difference is kept as Bonus.`);
  }
  const passive = number(take('Secondary Stats / Passive Perception').values[0]);
  const perception = mod(v.wis) + (v.skill_perception_prof ? pb : 0) + ((v.skill_perception_bonus as number | undefined) ?? 0);
  if (passive !== null && passive !== 10 + perception) note(`Passive Perception was typed as ${passive}; the sheet now shows ${10 + perception} (10 + Perception).`);
  const load = take('Secondary Stats / Encumbrance').values.map(number);
  if (typeof v.str === 'number' && load[0] != null && (load[0] !== v.str * 5 || load[1] !== v.str * 10))
    note(`Encumbrance was typed as ${load[0]} / ${load[1]}; the sheet now shows ${v.str * 5} / ${v.str * 10} (Strength × 5 and × 10).`);

  // Death saves: three successes, then three failures.
  const death = take('Secret Stats / Death Saves').values;
  v.death_success = ticked(death.slice(0, 3)) || null;
  v.death_fail = ticked(death.slice(3, 6)) || null;

  // Proficiencies and equipment
  for (const [name, id] of Object.entries(PROFICIENCY)) take(`Proficiencies / ${name}`).values.forEach((x, i) => SOURCES[i] && (v[`${id}_${SOURCES[i]}`] = text(x)));
  take('Equipment / Melee').values.forEach((x, i) => SLOTS3[i] && (v[`eq_melee_${SLOTS3[i]}`] = text(x)));
  take('Equipment / Ranged').values.forEach((x, i) => SLOTS3[i] && (v[`eq_ranged_${SLOTS3[i]}`] = text(x)));
  v.eq_special = take('Equipment / Special').values.filter(filled).map(squash);
  take('Equipment / Clothing / trinkets').values.forEach((x, i) => WORN[i] && (v[WORN[i]!] = text(x)));
  v.attuned = Math.min(3, ticked(take('Equipment / Attuned Magic Items').values)) || null;

  // Spellcasting
  const dc = number(take('Spell Stats / Spell Save DC').values[0]);
  const attack = number(take('Spell Stats / Spell Attack Bonus').values[0]);
  const spellLinks: { name: string; circle: number | null; note: string | null }[] = [];
  for (const [name, id] of Object.entries(SLOT)) {
    const p = pool(take(`Spell Slots / ${name}`));
    if (p) v[id] = p;
  }
  for (const [name, [id, circle]] of Object.entries(KNOWN)) {
    const list = take(`Spells Known / ${name}`).values.filter((x) => x.trim() !== '').map(squash);
    if (list.length) v[id] = list;
    for (const spellName of list) if (spellName !== '??') spellLinks.push({ name: spellName, circle, note: null });
  }
  for (const [name, id] of Object.entries(MASK)) {
    const s = take(`Spells Known / ${name}`).values;
    s.slice(0, 2).forEach((x, i) => {
      if (!filled(x)) return;
      v[`${id}_${i + 1}`] = text(x);
      spellLinks.push({ name: squash(x), circle: i + 1, note: name });
      modules.add('masks');
    });
  }
  const caster = dc !== null || attack !== null || Object.keys(v).some((k) => /^(slots|spells)_\d$/.test(k) && v[k] != null);
  if (caster) {
    modules.add('spellcasting');
    const ability = CAST_ABILITY.find(([re]) => re.test(String(raw.npc_class ?? '')))?.[1] ?? null;
    v.cast_ability = ability;
    if (!ability) note(`Spellcasting ability could not be told from the class “${raw.npc_class}”; choose it on the sheet.`);
    const castMod = mod(v[ability ?? 'cha']);
    if (dc !== null && dc - (8 + pb + castMod)) {
      v.spell_dc_bonus = dc - (8 + pb + castMod);
      note(`Spell Save DC: typed ${dc}, the rules give ${8 + pb + castMod}; the difference is kept as Bonus.`);
    }
    if (attack !== null && attack - (pb + castMod)) {
      v.spell_attack_bonus = attack - (pb + castMod);
      note(`Spell Attack Bonus: typed ${attack}, the rules give ${pb + castMod}; the difference is kept as Bonus.`);
    }
  }
  const sorcery = pool(take('Spell Stats / Sorcery Points'));
  const metamagic = take('Spell Stats / Metamagic').values.filter(filled).map(squash);
  if (sorcery || metamagic.length) {
    modules.add('sorcery');
    v.sorcery_points = sorcery;
    v.metamagic = metamagic;
  }

  // Class stats and supplies
  const classDc = number(take('Class Stats / Class Save DC').values[0]);
  const ki = number(take('Class Stats / Ki Points').values[0]);
  if (classDc !== null || ki !== null) {
    modules.add('class_stats');
    v.class_dc = classDc;
    if (ki !== null && ki > 0) v.ki = { cur: ki, max: ki };
  }
  for (const [name, id] of Object.entries(SUPPLY)) {
    const index = take(`Special Stats / ${name}`).values.indexOf('true');
    if (index >= 0 && SUPPLY_LEVEL[index]) {
      v[id] = SUPPLY_LEVEL[index];
      modules.add('supplies');
    }
  }

  // Limited abilities exist per character, so they become a section of this one sheet.
  const limited: SchemaGroup = { kind: 'group', id: 'c_limited', label: 'Limited Abilities', custom: true, children: [] };
  for (const [name, s] of data) {
    if (!name.startsWith('Limited Abilities / ')) continue;
    used.add(name);
    const p = pool(s, ticked(s.values) ? s.values.length : null);
    if (!p) continue;
    const id = `c_lim${s.id}`;
    limited.children.push({ kind: 'field', id, label: name.slice('Limited Abilities / '.length), type: 'pool' });
    v[id] = p;
  }

  for (const [name, s] of data)
    if (!used.has(name) && s.values.some((x) => x !== '' && x !== 'false' && x !== '??'))
      note(`Not imported, no place on the sheet: ${name} = ${s.values.filter((x) => x !== '').join(', ')}`);

  const e = entity('character', n, DM_ONLY, v);
  e.modules = [...modules];
  if (limited.children.length) e.customSchema = [limited];
  characterByChronicaId.set(raw.id, e);
  sheets.push({ e, raw });

  // Features and spells picked from the library.
  for (const id of (raw.ability_ids as string[] | undefined) ?? []) {
    const target = abilityById.get(String(id));
    if (target) link(e, target);
  }
  // Spells typed into "Spells Known" by name.
  for (const s of spellLinks) {
    const marked = s.name.endsWith('*');
    const spellName = s.name.replace(/\*+$/, '').trim();
    let target = libraryByName.get(key(spellName));
    if (!target || target.typeKey !== 'spell') {
      target = entity('spell', { name: spellName, nameRu: null }, EVERYONE, { circle: s.circle });
      libraryByName.set(key(spellName), target);
      stubs.push(spellName);
    }
    link(e, target, { ...(s.note ? { note: s.note } : marked ? { note: 'marked * on the old sheet' } : {}) });
  }

  if (notes.length) {
    say(`### ${e.name}`);
    for (const line of notes) say(`- ${line}`);
    say();
  }
  return e;
}
const stubs: string[] = [];

// ---------- Writing ----------

const dbFile = process.env.DB_FILE ?? path.resolve(import.meta.dirname, '../../data/anybrew.db');
const db = openDb(dbFile);
const system = db.select().from(systems).all().find((s) => s.name === campaign.name) ?? db.select().from(systems).all()[0];
if (!system) throw new Error('No system in the database to import into.');
const dm = db.select().from(members).where(eq(members.systemId, system.id)).all().find((m) => m.role === 'dm');
if (!dm) throw new Error('The system has no DM.');

const mapFile = path.join(dir, '_import-map.json');
const previous: { entityIds: string[]; linkIds: string[] } | null = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
if (previous && !replace && !dry) {
  console.error('This export was already imported. Run with --replace to remove that import and do it again.');
  process.exit(1);
}

// The proficiency bonus comes from the same rules table the sheets read.
const pbRows = db
  .select()
  .from(entities)
  .where(eq(entities.systemId, system.id))
  .all()
  .find((r) => r.typeKey === 'rule' && !r.deletedAt && r.values.formula_name === 'proficiency_bonus')?.values.table as { rows: string[][] } | undefined;
const proficiencyBonus = (level: number | null) => {
  let out = 0;
  for (const row of pbRows?.rows ?? []) if (level !== null && Number(row[0]) <= level) out = Number(row[1]);
  return out;
};

say(`# Chronica import report`);
say();
say(`Campaign “${campaign.name}”, imported into the system “${system.name}”.`);
say();
say(`## Differences between what was typed and what the sheet now works out`);
say();
say(`Chronica held every total as typed text. The sheet works totals out from the abilities, the proficiency tick and the Proficiency Bonus table. Where the typed total was different, the difference is stored in the “Bonus” box of that row, so every total on the sheet equals what was typed.`);
say();
const characters: Json[] = campaign.characters ?? [];
for (const raw of characters) character(raw, proficiencyBonus);

// Inventories and money belong to players in Chronica; here they go to the player's character.
const players: Json[] = campaign.players ?? [];
const ownerNotes: string[] = [];
for (const p of players) {
  const theirs = sheets.filter((s) => s.raw.player_id === p.id);
  const mains = theirs.filter((s) => s.raw.special === 'Main Character');
  const target = mains.length === 1 ? mains[0]! : theirs.length === 1 ? theirs[0]! : null;
  const items: Json[] = p.inventory?.inventory_items ?? [];
  const wealth = number(p.player_wealth) ?? 0;
  if (theirs.length) ownerNotes.push(`- Chronica player ${p.id}: ${theirs.map((s) => s.e.name).join(', ')}`);
  if (!target) {
    if (items.length || wealth) ownerNotes.push(`  - Not imported: ${items.length} inventory items and $${wealth}, because it is unclear whose they are.`);
    continue;
  }
  if (wealth) target.e.values.money = wealth;
  for (const raw of items) {
    const circle = undefined;
    const e = libraryItem(raw, { circle, personal: true, carried: true });
    link(target.e, e, e.typeKey === 'item' ? { quantity: number(raw.quantity) ?? 1 } : {});
  }
}

// Abilities with the same name ("Languages", "Tools") are one per character: name them after their character.
const byName = new Map<string, NewEntity[]>();
for (const e of created) if (e.typeKey === 'feature') byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
for (const group of byName.values())
  if (group.length > 1)
    for (const e of group) {
      const holders = newLinks.filter((l) => l.toId === e.id).map((l) => created.find((c) => c.id === l.fromId)!.name);
      if (holders.length === 1) e.name = `${e.name} – ${holders[0]}`;
    }

// Notes
for (const folder of campaign.adventure_note_folders ?? [])
  for (const n of folder.adventure_notes ?? [])
    entity('note', splitName(n.title, false), DM_ONLY, { summary: `From the Chronica notes folder “${folder.name}”`, body: plain(n.content) });
if (plain(campaign.about)) entity('note', { name: 'About the campaign', nameRu: 'О кампании' }, EVERYONE, { body: plain(campaign.about) });
if (plain(campaign.gm_secrets)) entity('note', { name: 'DM secrets of the campaign (from Chronica)', nameRu: null }, DM_ONLY, { dm_notes: plain(campaign.gm_secrets) });
for (const p of players) if (p.game_master && plain(p.notes)) entity('note', { name: 'DM notes (from Chronica)', nameRu: null }, DM_ONLY, { dm_notes: plain(p.notes) });

// The talent tree of one character, from the owner's note.
if (args.includes('--talents') && talentArg?.includes('=')) {
  const [who, file] = [talentArg.slice(0, talentArg.indexOf('=')), talentArg.slice(talentArg.indexOf('=') + 1)];
  const target = created.find((e) => e.typeKey === 'character' && e.name === who);
  if (!target) throw new Error(`No character named ${who}`);
  const { data, picks, dmNotes } = parseTalents(fs.readFileSync(file, 'utf8'));
  target.modules.push('talent_tree');
  target.values.talents = data;
  target.values.talents_taken = picks;
  if (dmNotes) target.values.talents_dm_notes = dmNotes;
  const trees = data.patrons.flatMap((p) => p.trees);
  say(`## Talent tree`);
  say();
  say(`${who}: ${trees.length} trees with ${trees.reduce((n, t) => n + t.talents.length, 0)} talents, ${Object.keys(picks).length} of them taken, read from the talent note.`);
  say();
}

// Every value must fit its field, exactly as if it had been typed into the sheet.
for (const e of created) {
  const schema = effectiveSchema(e.typeKey, e.modules, e.customSchema);
  if (!schema) throw new Error(`Unknown type ${e.typeKey}`);
  const fields = new Map(allFields(schema).map((f) => [f.id, f]));
  for (const [id, value] of Object.entries(e.values)) {
    const field = fields.get(id);
    if (!field) throw new Error(`${e.typeKey} “${e.name}”: no field ${id} on its sheet`);
    try {
      const checked = checkValue(field, value);
      if (checked === null) delete e.values[id];
      else e.values[id] = checked;
    } catch {
      throw new Error(`${e.typeKey} “${e.name}”: value of ${id} does not fit: ${JSON.stringify(value).slice(0, 200)}`);
    }
  }
}

const count = (typeKey: string) => created.filter((e) => e.typeKey === typeKey).length;
say(`## What was imported`);
say();
say(`- ${count('character')} characters`);
say(`- ${count('feature')} features, ${count('spell')} spells, ${count('item')} items, ${count('note')} notes`);
say(`- ${newLinks.length} links from characters to their features, spells and items`);
say();
for (const s of sheets) {
  const mine = newLinks.filter((l) => l.fromId === s.e.id);
  const n = (kind: string) => mine.filter((l) => l.kind === kind).length;
  say(`- ${s.e.name}${s.e.nameRu ? ` (${s.e.nameRu})` : ''}: ${Object.keys(s.e.values).length} filled fields, ${n('has')} features, ${n('knows')} spells, ${n('owns')} items${s.e.modules.length ? `; modules: ${s.e.modules.join(', ')}` : ''}`);
}
say();
say(`## Who played whom in Chronica`);
say();
say(`The export has no player names, only numbers. Every character is imported without an owner and visible to the DM only. Set the owner on each sheet once the players have accounts.`);
say();
for (const line of ownerNotes) say(line);
say();
if (stubs.length) {
  say(`## Spells known only by name`);
  say();
  say(`These were typed into “Spells Known” and are not in the Chronica library. Each got an empty spell page, linked to its character: ${stubs.join(', ')}.`);
  say();
}
if (merged.length) {
  say(`## Written down more than once in Chronica, imported once`);
  say();
  say(merged.join(', ') + '.');
  say();
}
if (missingEnglish.length) {
  say(`## Names still without an English form`);
  say();
  for (const n of new Set(missingEnglish)) say(`- ${n}`);
  say();
}
say(`## Not imported`);
say();
say(`- The names of the bags inside player inventories: the export gives only their numbers, so items are listed without a bag.`);
say(`- Maps (${(campaign.map_folders ?? []).reduce((n: number, f: Json) => n + (f.maps?.length ?? 0), 0)}): the export holds no picture files.`);
say(`- Pictures of characters and items: none are in the export.`);

console.log(report.join('\n'));
if (dry) {
  if (args.includes('--show')) {
    const want = args[args.indexOf('--show') + 1]!;
    for (const e of created.filter((x) => x.name.includes(want))) console.log(JSON.stringify(e, null, 1).slice(0, 6000));
  }
  const all = created.map((e) => String(e.values.description ?? '')).join('');
  console.log('tables left:', (all.match(/<table>/g) ?? []).length, 'h1 left:', (all.match(/<h1>/g) ?? []).length);
  console.log('\nDry run: nothing was written.');
  process.exit(0);
}

const now = Date.now();
db.transaction((tx) => {
  if (previous) {
    for (let i = 0; i < previous.entityIds.length; i += 200) {
      const ids = previous.entityIds.slice(i, i + 200);
      tx.delete(changes).where(inArray(changes.entityId, ids)).run();
      tx.delete(translations).where(inArray(translations.entityId, ids)).run();
      tx.delete(links).where(inArray(links.fromId, ids)).run();
      tx.delete(links).where(inArray(links.toId, ids)).run();
      tx.delete(entities).where(inArray(entities.id, ids)).run();
    }
  }
  for (const e of created) {
    tx.insert(entities)
      .values({ ...e, systemId: system.id, ownerId: null, campaignIds: [], fieldVisibility: {}, createdAt: now, updatedAt: now })
      .run();
    tx.insert(changes)
      .values({ systemId: system.id, entityId: e.id, target: 'create', key: null, oldValue: null, newValue: { name: e.name, typeKey: e.typeKey, source: 'Chronica import' }, userId: dm.userId, at: now })
      .run();
  }
  for (const l of newLinks) tx.insert(links).values({ ...l, systemId: system.id, createdAt: now }).run();
});
fs.writeFileSync(mapFile, JSON.stringify({ entityIds: created.map((e) => e.id), linkIds: newLinks.map((l) => l.id) }));
fs.writeFileSync(path.join(dir, 'Import report.md'), report.join('\n') + '\n');
console.log(`\nWritten to ${dbFile}. Report: ${path.join(dir, 'Import report.md')}`);
