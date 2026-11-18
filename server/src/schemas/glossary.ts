import type { EntitySchema } from './types';

// A glossary term. Its name is the English term and its Russian name is the translation,
// so "Perception" is defined and translated in one place. Wherever a sheet label is a glossary
// term, the label shows the definition on hover and the Russian form to a Russian reader.
export const glossary: EntitySchema = {
  key: 'glossary',
  name: 'Glossary term',
  plural: 'Glossary',
  playerCreatable: false,
  openByDefault: true,
  groups: [
    {
      kind: 'group',
      id: 'term',
      label: 'Term',
      children: [
        { kind: 'field', id: 'definition', label: 'Definition', type: 'longtext' },
        // Other spellings and word forms that mean the same term: plurals, abbreviations.
        { kind: 'field', id: 'aliases', label: 'Also written as', type: 'list' },
      ],
    },
  ],
};
