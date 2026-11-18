import type { EntitySchema, SchemaField } from './types';

// The shared libraries that characters link to: features (class features, feats, origins,
// attacks), spells and items. These are the first, small versions of the types: they hold what the
// Chronica library held. The item type grows in phase 2 (inventory) and the spell type in phase 3
// (the owner's 25 spell properties).

const f = (id: string, label: string, type: SchemaField['type'], ru?: string): SchemaField => ({ kind: 'field', id, label, type, ru });

export const feature: EntitySchema = {
  key: 'feature',
  name: 'Feature',
  plural: 'Features',
  playerCreatable: false,
  openByDefault: true,
  groups: [
    {
      kind: 'group',
      id: 'feature',
      label: 'Feature',
      children: [
        // What kind of feature it is: "Class feature", "Feat", "Maneuver", "Origin"… Free text, so the
        // owner adds kinds by typing them; the screen offers the ones already in use.
        f('ftype', 'Type', 'text', 'Тип'),
        // The class it belongs to, when it belongs to one.
        f('class', 'Class', 'text', 'Класс'),
        // Empty for a feature of the class itself.
        f('subclass', 'Subclass', 'text', 'Подкласс'),
        // The character level at which it is gained.
        f('tier', 'Level gained', 'number', 'Уровень получения'),
        f('action', 'Action', 'text', 'Действие'),
        f('tags', 'Tags', 'list', 'Теги'),
        f('summary', 'Summary', 'longtext', 'Кратко'),
        f('description', 'Description', 'richtext', 'Описание'),
      ],
    },
  ],
};

export const spell: EntitySchema = {
  key: 'spell',
  name: 'Spell',
  plural: 'Spells',
  playerCreatable: false,
  openByDefault: true,
  groups: [
    {
      kind: 'group',
      id: 'spell',
      label: 'Spell',
      children: [
        // 0 is a cantrip.
        f('circle', 'Circle', 'number', 'Круг'),
        f('action', 'Casting', 'text', 'Сотворение'),
        f('tags', 'Tags', 'list', 'Теги'),
        f('summary', 'Summary', 'longtext', 'Кратко'),
        f('description', 'Description', 'richtext', 'Описание'),
      ],
    },
  ],
};

export const item: EntitySchema = {
  key: 'item',
  name: 'Item',
  plural: 'Items',
  playerCreatable: false,
  openByDefault: true,
  groups: [
    {
      kind: 'group',
      id: 'item',
      label: 'Item',
      children: [
        f('weight', 'Weight (lb)', 'number', 'Вес (фунты)'),
        f('value', 'Value ($)', 'number', 'Цена ($)'),
        f('tags', 'Tags', 'list', 'Теги'),
        f('description', 'Description', 'richtext', 'Описание'),
      ],
    },
  ],
};

/** The link kind that ties a character to a library entity of each type. */
export const LINK_KIND: Record<string, string> = { feature: 'has', spell: 'knows', item: 'owns' };

export const CLASS_FEATURE = 'Class feature';

/**
 * Type and class of a feature from the name of the old library section it was filed under:
 * "Monk features" is a class feature of the Monk, "Feats" are feats.
 */
export function typeAndClassOf(section: string): { ftype: string; class: string | null } {
  const s = section.trim();
  const ofClass = /^(.+?)\s+features$/i.exec(s);
  if (ofClass) return { ftype: CLASS_FEATURE, class: ofClass[1]! };
  const known: Record<string, string> = {
    feats: 'Feat',
    origins: 'Origin',
    'basic attack': 'Attack',
    proficiencies: 'Proficiency',
    'special abilities': 'Special ability',
  };
  return { ftype: known[s.toLowerCase()] ?? s, class: null };
}
