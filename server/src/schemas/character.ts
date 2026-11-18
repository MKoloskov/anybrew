import { DM_ONLY } from '../visibility';
import type { EntitySchema, SchemaField, SchemaGroup, SchemaNode, SchemaPage, SheetModule } from './types';

// The character sheet, built from the owner's 14 Chronica stat groups.
// What every character has is the base schema; what only some have is a module.
// Typed-in modifiers from Chronica are replaced by formulas wherever the rule is fixed.

const f = (id: string, label: string, type: SchemaField['type'], extra: Partial<SchemaField> = {}): SchemaField => ({
  kind: 'field',
  id,
  label,
  type,
  ...extra,
});
const text = (id: string, label: string, extra?: Partial<SchemaField>) => f(id, label, 'text', extra);
const num = (id: string, label: string, extra?: Partial<SchemaField>) => f(id, label, 'number', extra);
const calc = (id: string, label: string, formula: string, extra?: Partial<SchemaField>) => f(id, label, 'computed', { formula, ...extra });
const group = (id: string, label: string, children: SchemaNode[], extra: Partial<SchemaGroup> = {}): SchemaGroup => ({
  kind: 'group',
  id,
  label,
  children,
  ...extra,
});
const row = (id: string, label: string, children: SchemaNode[], ru?: string) => group(id, label, children, { layout: 'row', ru });
/** A top-level group on a page of the sheet. */
const onPage = (page: PageKey, id: string, label: string, children: SchemaNode[], extra: Partial<SchemaGroup> = {}) =>
  group(id, label, children, { page, ...extra });

// The pages of the character sheet, in menu order. Home, Preview and the three ability pages hold
// no groups of their own: they show fields of other pages, and the features linked to the character.
const PAGES = [
  { key: 'home', label: 'Home', shows: ['portrait', 'classes', 'level', 'hp_row', 'ac_row', 'str_row', 'dex_row', 'con_row', 'int_row', 'wis_row', 'cha_row', 'tags'] },
  { key: 'preview', label: 'Preview', shows: ['portrait', 'faction', 'race', 'description'] },
  { key: 'basic', label: 'Basic Info' },
  { key: 'stats', label: 'Stats' },
  { key: 'skills', label: 'Skills' },
  { key: 'class', label: 'Class Abilities' },
  { key: 'subclass', label: 'Subclass Abilities' },
  { key: 'hero', label: 'Hero Abilities' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'spells', label: 'Spells Known' },
  { key: 'progression', label: 'Progression History' },
  { key: 'history', label: 'Open Character History' },
  { key: 'secrets', label: 'Character Secrets' },
  { key: 'dm', label: 'DM Secrets' },
  { key: 'notes', label: 'Char Notes' },
  // AC, HP, hit dice and initiative are stored once, in Secondary Stats, and shown here as well.
  { key: 'combat', label: 'Combat', shows: ['ac_row', 'hp_row', 'hit_dice', 'hit_dice_kind', 'initiative_row'] },
] as const satisfies readonly SchemaPage[];
type PageKey = (typeof PAGES)[number]['key'];

/**
 * What another player receives of a character they may see: the Preview, and the kind that sorts
 * the character list. Everything else is for the owner and the DM.
 */
const OUTSIDE = ['portrait', 'kind', 'race', 'faction', 'description'];

/** What the DM can add to the cards of the character list, for everyone in the System. */
export const CARD_FIELDS = [
  { key: 'race', label: 'Race' },
  { key: 'class', label: 'Class' },
  { key: 'level', label: 'Level' },
  { key: 'kind', label: 'Kind' },
  { key: 'status', label: 'Status' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'owner', label: 'Owner' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'tags', label: 'Tags' },
] as const;
export type CardFieldKey = (typeof CARD_FIELDS)[number]['key'];

const ABILITIES = [
  ['str', 'Strength', 'Сила'],
  ['dex', 'Dexterity', 'Ловкость'],
  ['con', 'Constitution', 'Телосложение'],
  ['int', 'Intelligence', 'Интеллект'],
  ['wis', 'Wisdom', 'Мудрость'],
  ['cha', 'Charisma', 'Харизма'],
] as const;

const SKILLS = [
  ['athletics', 'Athletics', 'Атлетика', 'str'],
  ['acrobatics', 'Acrobatics', 'Акробатика', 'dex'],
  ['stealth', 'Stealth', 'Скрытность', 'dex'],
  ['sleight_of_hand', 'Sleight of Hand', 'Ловкость рук', 'dex'],
  ['arcana', 'Arcana', 'Знание магии', 'int'],
  ['history', 'History', 'Знание истории', 'int'],
  ['nature', 'Nature', 'Знание природы', 'int'],
  ['religion', 'Religion', 'Знание религии', 'int'],
  ['investigation', 'Investigation', 'Расследование', 'int'],
  ['perception', 'Perception', 'Наблюдательность', 'wis'],
  ['insight', 'Insight', 'Проницательность', 'wis'],
  ['animal_handling', 'Animal Handling', 'Обращение с животными', 'wis'],
  ['medicine', 'Medicine', 'Медицина', 'wis'],
  ['survival', 'Survival', 'Выживание', 'wis'],
  ['persuasion', 'Persuasion', 'Убеждение', 'cha'],
  ['deception', 'Deception', 'Обман', 'cha'],
  ['intimidation', 'Intimidation', 'Устрашение', 'cha'],
  ['performance', 'Performance', 'Выступление', 'cha'],
] as const;

const slots3 = (id: string, label: string) =>
  row(id, label, [text(`${id}_main`, 'Main'), text(`${id}_secondary`, 'Secondary'), text(`${id}_backup`, 'Backup')]);

const sources = (id: string, label: string) =>
  row(id, label, [text(`${id}_default`, 'Default'), text(`${id}_background`, 'Background'), text(`${id}_bonus`, 'Bonus')]);

export const character: EntitySchema = {
  key: 'character',
  name: 'Character',
  plural: 'Characters',
  playerCreatable: true,
  pages: PAGES.map((p) => ({ ...p, ...('shows' in p ? { shows: [...p.shows] } : {}) })),
  customPage: 'hero',
  outside: OUTSIDE,
  groups: [
    onPage('basic', 'identity', 'Basic Info', [
      // The picture chosen as the main one: cards, Home and Preview read this field.
      f('portrait', 'Portrait', 'image'),
      f('gallery', 'Portrait gallery', 'gallery', { main: 'portrait' }),
      f('kind', 'Kind', 'select', {
        dmEditOnly: true,
        options: [
          { value: 'pc', label: 'Player character' },
          { value: 'npc', label: 'NPC' },
          // A barely-named background character.
          { value: 'aux', label: 'Aux' },
        ],
      }),
      text('race', 'Race'),
      text('background', 'Background'),
      // Classes are chosen from the rules documents that are classes. Choosing them sets the Level
      // to the sum of the class levels and fills hit dice, saves and proficiencies from the class.
      f('classes', 'Classes', 'classes'),
      text('class', 'Class'),
      text('gender', 'Gender'),
      text('age', 'Age'),
      text('alignment', 'Alignment'),
      // Stored under the id it had when the label was "Faction".
      text('faction', 'Allegiance'),
      // How the character stands towards the party: Ally, Neutral, Enemy…
      text('disposition', 'Disposition'),
      f('status', 'Status', 'select', {
        options: ['Alive', 'Dead', 'Missing', 'Unknown'].map((s) => ({ value: s.toLowerCase(), label: s })),
      }),
      text('height', 'Height'),
      text('weight', 'Weight'),
      // Free words the character list is filtered by, such as "Cormyr".
      f('tags', 'Tags', 'list', { dmEditOnly: true }),
    ]),
    onPage('stats', 'general', 'General Stats', [
      num('level', 'Level'),
      // Read from the rules document "Proficiency Bonus from Level"; edit that table to change it for everyone.
      calc('prof_bonus', 'Proficiency Bonus', "lookup('proficiency_bonus', level)", { signed: true }),
      f('inspiration', 'Inspiration', 'pips', { max: 4 }),
    ]),
    onPage(
      'stats',
      'primary',
      'Primary Stats',
      ABILITIES.map(([id, label, ru]) =>
        row(`${id}_row`, `${label} (${id.toUpperCase()})`, [num(id, 'Value'), calc(`${id}_mod`, 'Modifier', `mod(${id})`, { signed: true })], ru),
      ),
    ),
    onPage(
      'stats',
      'saves',
      'Saves',
      ABILITIES.map(([id, label]) =>
        row(`save_${id}_row`, `Save – ${id.toUpperCase()}`, [
          f(`save_${id}_prof`, 'Proficient', 'boolean'),
          num(`save_${id}_bonus`, 'Bonus'),
          calc(`save_${id}`, 'Total', `mod(${id}) + save_${id}_prof * prof_bonus + save_${id}_bonus`, { signed: true }),
        ], `Спасбросок – ${label}`),
      ),
    ),
    onPage(
      'skills',
      'skills',
      'Skills',
      SKILLS.map(([id, label, ru, ability]) =>
        row(`skill_${id}_row`, `${label} (${ability.toUpperCase()})`, [
          f(`skill_${id}_prof`, 'Proficient', 'boolean'),
          num(`skill_${id}_bonus`, 'Bonus'),
          calc(`skill_${id}`, 'Total', `mod(${ability}) + skill_${id}_prof * prof_bonus + skill_${id}_bonus`, { signed: true }),
        ], ru),
      ),
    ),
    onPage('stats', 'secondary', 'Secondary Stats', [
      row('ac_row', 'Armor Class (AC)', [num('ac', 'Total'), text('ac_calc', 'Calculation')]),
      row('hp_row', 'Hit Points (HP)', [num('hp', 'Current HP'), num('hp_temp', 'Temp HP'), num('hp_max', 'Max HP')]),
      f('hit_dice', 'Hit Dice', 'pool'),
      // Which dice they are, for example "5d6 + 1d8".
      text('hit_dice_kind', 'Hit Dice (dice)'),
      row('speed_row', 'Speed', [num('speed_walk', 'Walk'), num('speed_climb', 'Climb'), num('speed_swim', 'Swim'), num('speed_fly', 'Fly')]),
      row('initiative_row', 'Initiative', [
        num('initiative_bonus', 'Bonus'),
        calc('initiative', 'Total', 'mod(dex) + initiative_bonus', { signed: true }),
      ]),
      calc('passive_perception', 'Passive Perception', '10 + skill_perception'),
      row('encumbrance_row', 'Encumbrance', [calc('enc_medium', 'Medium', 'str * 5'), calc('enc_heavy', 'Heavy', 'str * 10')]),
    ]),
    onPage('combat', 'death_saves', 'Death Saves', [
      f('death_success', 'Successes', 'pips', { max: 3 }),
      f('death_fail', 'Failures', 'pips', { max: 3 }),
    ]),
    onPage('combat', 'combat', 'Combat', [
      f('attacks', 'Attacks', 'table', { columns: ['Attack', 'Bonus', 'Damage', 'Notes'] }),
      f('combat_modifiers', 'Combat modifiers', 'list'),
    ]),
    onPage('stats', 'proficiencies', 'Proficiencies', [
      sources('prof_weapons', 'Weapons'),
      sources('prof_armor', 'Armor'),
      sources('prof_tools', 'Tools'),
      sources('prof_languages', 'Languages'),
    ]),
    onPage('inventory', 'equipment', 'Equipment', [
      slots3('eq_melee', 'Melee'),
      slots3('eq_ranged', 'Ranged'),
      f('eq_special', 'Special', 'list'),
      row('eq_worn', 'Clothing / trinkets', [
        text('eq_body', 'Body'),
        text('eq_head', 'Head'),
        text('eq_back', 'Back'),
        text('eq_ring', 'Ring'),
        text('eq_neck', 'Neck'),
        text('eq_feet', 'Feet'),
      ]),
      f('attuned', 'Attuned Magic Items', 'pips', { max: 3 }),
      num('money', 'Money ($)'),
    ]),
    // Filled by hand for now: what was chosen at which level-up and between levels.
    // The group has its own id: a group and a field with one id would share one audience override.
    onPage('progression', 'progression_history', 'Progression History', [
      f('progression', 'Progression History', 'table', { columns: ['Level', 'When', 'What was chosen'] }),
    ]),
    // What the player wants others to know: the only long text of the outside view.
    onPage('history', 'story', 'Description', [f('description', 'Description', 'richtext')]),
    onPage('notes', 'char_notes', 'Notes', [f('notes', 'Notes', 'richtext')]),
    onPage('secrets', 'personal', 'Personal Secrets', [f('personal_secrets', 'Personal secrets', 'richtext')], { ownerOnly: true }),
    onPage('dm', 'dm', 'DM Secrets', [f('gm_secrets', 'DM secrets', 'richtext')], { visibility: DM_ONLY }),
  ],
};

const CIRCLES = ['1st', '2nd', '3rd', '4th'] as const;
const CAST_MOD = "mod(if(cast_ability == 'int', int, if(cast_ability == 'wis', wis, cha)))";

export const characterModules: SheetModule[] = [
  {
    // Replaces normal class progression for a character who advances by buying talents.
    // The tree itself is loaded from the DM's note; the player marks what is taken.
    key: 'talent_tree',
    name: 'Talent tree',
    forType: 'character',
    groups: [
      onPage('class', 'talents_group', 'Talents', [
        f('talents', 'Talent tree', 'talents', { dmEditOnly: true }),
        f('talents_taken', 'Taken talents', 'talentpicks'),
      ]),
      onPage('class', 'talents_dm', 'Talent notes (DM)', [f('talents_dm_notes', 'Balance notes', 'longtext')], { visibility: DM_ONLY }),
    ],
  },
  {
    key: 'spellcasting',
    name: 'Spellcasting',
    forType: 'character',
    groups: [
      onPage('spells', 'spell_stats', 'Spell Stats', [
        f('cast_ability', 'Spellcasting ability', 'select', {
          options: [
            { value: 'int', label: 'Intelligence' },
            { value: 'wis', label: 'Wisdom' },
            { value: 'cha', label: 'Charisma' },
          ],
        }),
        row('spell_dc_row', 'Spell Save DC', [num('spell_dc_bonus', 'Bonus'), calc('spell_dc', 'Total', `8 + prof_bonus + ${CAST_MOD} + spell_dc_bonus`)]),
        row('spell_attack_row', 'Spell Attack Bonus', [
          num('spell_attack_bonus', 'Bonus'),
          calc('spell_attack', 'Total', `prof_bonus + ${CAST_MOD} + spell_attack_bonus`, { signed: true }),
        ]),
      ]),
      onPage('spells', 'spell_slots', 'Spell Slots', CIRCLES.map((c, i) => f(`slots_${i + 1}`, `${c} Circle`, 'pool'))),
      onPage('spells', 'spells_known', 'Spells Known', [
        f('spells_0', 'Cantrips', 'list'),
        ...CIRCLES.map((c, i) => f(`spells_${i + 1}`, `${c} Circle`, 'list')),
      ]),
    ],
  },
  {
    key: 'sorcery',
    name: 'Sorcery (points and metamagic)',
    forType: 'character',
    groups: [onPage('class', 'sorcery', 'Sorcery', [f('sorcery_points', 'Sorcery Points', 'pool'), f('metamagic', 'Metamagic', 'list')])],
  },
  {
    key: 'class_stats',
    name: 'Class stats (save DC, ki)',
    forType: 'character',
    groups: [onPage('class', 'class_stats', 'Class Stats', [num('class_dc', 'Class Save DC'), f('ki', 'Ki Points', 'pool')])],
  },
  {
    key: 'masks',
    name: 'Masks (Queen and Shadow)',
    forType: 'character',
    groups: [
      onPage('class', 'masks', 'Masks', [
        row('mask_queen', 'Mask of the Queen', [text('mask_queen_1', '1st Circle'), text('mask_queen_2', '2nd Circle')]),
        row('mask_shadow', 'Mask of the Shadow', [text('mask_shadow_1', '1st Circle'), text('mask_shadow_2', '2nd Circle')]),
      ]),
    ],
  },
  {
    key: 'supplies',
    name: 'Supplies (hardware, alchemical…)',
    forType: 'character',
    groups: [
      onPage(
        'inventory',
        'supplies',
        'Special Stats',
        [
          ['supply_hardware', 'Hardware'],
          ['supply_binders', 'Binders & Containers'],
          ['supply_alchemical', 'Alchemical'],
          ['supply_magical', 'Magical'],
        ].map(([id, label]) =>
          f(id!, label!, 'select', { options: ['LOTS', 'SOME', 'FEW', 'NONE'].map((v) => ({ value: v.toLowerCase(), label: v })) }),
        ),
      ),
    ],
  },
];
