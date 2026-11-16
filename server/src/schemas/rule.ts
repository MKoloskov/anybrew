import type { EntitySchema } from './types';

// A rules document: text plus an optional table. Rules are campaign-agnostic content of the system.
// A table with a formula name can feed sheets: lookup('proficiency_bonus', level) reads the
// "Proficiency Bonus from Level" table, so changing the table changes every character sheet.
export const rule: EntitySchema = {
  key: 'rule',
  name: 'Rule',
  plural: 'Rules',
  playerCreatable: false,
  groups: [
    {
      kind: 'group',
      id: 'rule',
      label: 'Rule',
      children: [
        { kind: 'field', id: 'body', label: 'Text', type: 'longtext' },
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
