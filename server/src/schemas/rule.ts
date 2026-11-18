import { CLASS_MODULE } from '../classes';
import type { EntitySchema, SheetModule } from './types';

// A rules document: text plus an optional table. Rules are campaign-agnostic content of the system.
// A table with a formula name can feed sheets: lookup('proficiency_bonus', level) reads the
// "Proficiency Bonus from Level" table, so changing the table changes every character sheet.
export const rule: EntitySchema = {
  key: 'rule',
  name: 'Rule',
  plural: 'Rules',
  playerCreatable: false,
  openByDefault: true,
  groups: [
    {
      kind: 'group',
      id: 'rule',
      label: 'Rule',
      children: [
        { kind: 'field', id: 'body', label: 'Text', type: 'richtext' },
        { kind: 'field', id: 'table', label: 'Table', type: 'table' },
      ],
    },
    {
      kind: 'group',
      id: 'wiring',
      label: 'Use in sheets',
      children: [
        // The name formulas use to find this table. Changing it disconnects the sheets that use it.
        { kind: 'field', id: 'formula_name', label: 'Formula name', type: 'text', dmEditOnly: true },
      ],
    },
  ],
};

/**
 * Attached to a rules document, this section makes it a class that characters can take.
 * The document's Table is then the class table (first column: level), and its features are the
 * features of the library whose Class is the document's name.
 */
export const ruleModules: SheetModule[] = [
  {
    key: CLASS_MODULE,
    name: 'Class (characters can take it)',
    forType: 'rule',
    groups: [
      {
        kind: 'group',
        id: 'class',
        label: 'Class',
        children: [
          { kind: 'field', id: 'hit_die', label: 'Hit die (sides)', type: 'number' },
          { kind: 'field', id: 'class_saves', label: 'Saving throw proficiencies', type: 'text' },
          { kind: 'field', id: 'class_armor', label: 'Armor proficiencies', type: 'text' },
          { kind: 'field', id: 'class_weapons', label: 'Weapon proficiencies', type: 'text' },
          { kind: 'field', id: 'class_tools', label: 'Tool proficiencies', type: 'text' },
          { kind: 'field', id: 'class_skills', label: 'Skills', type: 'longtext' },
          { kind: 'field', id: 'subclass_title', label: 'Subclasses are called', type: 'text' },
          { kind: 'field', id: 'subclasses', label: 'Subclasses', type: 'list' },
        ],
      },
    ],
  },
];

/** The D&D 5e (2014) proficiency bonus by character level. */
export const PROFICIENCY_BONUS_2014 = {
  name: 'Proficiency Bonus from Level',
  formulaName: 'proficiency_bonus',
  body: 'D&D 5e (2014). The bonus is read from the first row whose level is not above the character’s level. Character sheets take their Proficiency Bonus from this table.',
  table: {
    columns: ['Level', 'Proficiency Bonus'],
    rows: Array.from({ length: 20 }, (_, i) => [String(i + 1), String(2 + Math.floor(i / 4))]),
  },
};
