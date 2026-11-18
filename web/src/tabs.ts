// The sections of a system that list entities of one type.
export type EntityTabDef = { key: string; label: string; typeKey: string; noun: string; plural: string };

export const ENTITY_TABS: EntityTabDef[] = [
  { key: 'characters', label: 'Characters', typeKey: 'character', noun: 'character', plural: 'characters' },
  { key: 'features', label: 'Features', typeKey: 'feature', noun: 'feature', plural: 'features' },
  { key: 'spells', label: 'Spells', typeKey: 'spell', noun: 'spell', plural: 'spells' },
  { key: 'items', label: 'Items', typeKey: 'item', noun: 'item', plural: 'items' },
  { key: 'rules', label: 'Rules', typeKey: 'rule', noun: 'rule', plural: 'rules' },
  { key: 'glossary', label: 'Glossary', typeKey: 'glossary', noun: 'term', plural: 'terms' },
  { key: 'notes', label: 'Notes', typeKey: 'note', noun: 'note', plural: 'notes' },
];

export const tabOfType = (typeKey: string) => ENTITY_TABS.find((t) => t.typeKey === typeKey);
