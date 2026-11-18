import { DM_ONLY } from '../visibility';
import { character, characterModules } from './character';
import { glossary } from './glossary';
import { feature, item, spell } from './library';
import { rule, ruleModules } from './rule';
import type { EntitySchema, SchemaGroup, SheetModule } from './types';

// Phase 0 ships one small type that exercises groups, field types and DM-only content.
// The real Character, Item, Spell and Feature schemas arrive in phases 1 to 3.
const note: EntitySchema = {
  key: 'note',
  name: 'Note',
  plural: 'Notes',
  playerCreatable: true,
  groups: [
    {
      kind: 'group',
      id: 'main',
      label: 'Note',
      children: [
        { kind: 'field', id: 'summary', label: 'Summary', type: 'text' },
        { kind: 'field', id: 'body', label: 'Text', type: 'longtext' },
        { kind: 'field', id: 'session', label: 'Session number', type: 'number' },
        { kind: 'field', id: 'resolved', label: 'Resolved', type: 'boolean' },
        { kind: 'field', id: 'verdict', label: 'DM verdict', type: 'text', dmEditOnly: true },
      ],
    },
    {
      kind: 'group',
      id: 'dm',
      label: 'DM notes',
      visibility: DM_ONLY,
      children: [{ kind: 'field', id: 'dm_notes', label: 'Secrets', type: 'longtext' }],
    },
  ],
};

const registry = new Map<string, EntitySchema>([
  [character.key, character],
  [rule.key, rule],
  [feature.key, feature],
  [spell.key, spell],
  [item.key, item],
  [glossary.key, glossary],
  [note.key, note],
]);
const modules = new Map<string, SheetModule>([...characterModules, ...ruleModules].map((m) => [m.key, m]));

/** Modules that can be attached to entities of a type. */
export function listModules(typeKey: string): SheetModule[] {
  return [...modules.values()].filter((m) => m.forType === typeKey);
}

/** The sheet of one entity: the base schema of its type, then the groups of its modules, then its own custom groups. */
export function effectiveSchema(typeKey: string, moduleKeys: string[], custom: SchemaGroup[] = []): EntitySchema | undefined {
  const base = registry.get(typeKey);
  if (!base) return undefined;
  const extra = [
    ...listModules(typeKey).filter((m) => moduleKeys.includes(m.key)).flatMap((m) => m.groups),
    ...custom.map((g) => (base.customPage ? { ...g, page: base.customPage } : g)),
  ];
  return extra.length ? { ...base, groups: [...base.groups, ...extra] } : base;
}

export function getSchema(typeKey: string): EntitySchema | undefined {
  return registry.get(typeKey);
}

export function listSchemas(): EntitySchema[] {
  return [...registry.values()];
}

/** Tests register extra schemas here. */
export function registerSchema(schema: EntitySchema): void {
  registry.set(schema.key, schema);
}
