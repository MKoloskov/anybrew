import type { Audience } from '../visibility';

// Schemas are plain data, in the shape the database will store once the schema builder exists.
// Still to come: rich text, table, reference, dice and image fields.

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'boolean'
  /** One of `options`. Stored as the option's value. */
  | 'select'
  /** A row of `max` boxes to tick off, such as death saves. Stored as the number ticked. */
  | 'pips'
  /** A resource with its own maximum, such as spell slots or hit dice. Stored as { cur, max }. */
  | 'pool'
  /** A list of short text lines. Stored as string[]. */
  | 'list'
  /** A free table: headings and rows of text cells. Stored as { columns: string[], rows: string[][] }. */
  | 'table'
  /** Read-only, worked out from other fields by `formula`. Never stored. */
  | 'computed';

export type SchemaField = {
  kind: 'field';
  /** Stable id: values and the change log are keyed by it, so it must never be reused. */
  id: string;
  label: string;
  /** Russian form of the label, shown after the English one to a Russian reader. */
  ru?: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  max?: number;
  formula?: string;
  /** Show a computed number with a plus sign, as modifiers are written. */
  signed?: boolean;
  visibility?: Audience;
  /** Seen by the DM and the entity's owner only, unless the entity overrides this node's audience. */
  ownerOnly?: boolean;
  /** Only the DM may edit, even on a player's own entity. */
  dmEditOnly?: boolean;
};

export type SchemaGroup = {
  kind: 'group';
  id: string;
  label: string;
  ru?: string;
  /** 'row' lays the children out side by side as one line of the sheet, e.g. "Strength: score, modifier". */
  layout?: 'row';
  visibility?: Audience;
  /** Seen by the DM and the entity's owner only, unless the entity overrides this node's audience. */
  ownerOnly?: boolean;
  children: SchemaNode[];
};

export type SchemaNode = SchemaGroup | SchemaField;

export type EntitySchema = {
  key: string;
  name: string;
  /** Plural name for the tab that lists these entities. */
  plural: string;
  /** Players may create entities of this type; they become the owner. */
  playerCreatable: boolean;
  groups: SchemaGroup[];
};

/** A reusable piece of sheet that the DM attaches to single entities: "Spellcasting", "Monk"… */
export type SheetModule = {
  key: string;
  name: string;
  /** Entity type this module can be attached to. */
  forType: string;
  groups: SchemaGroup[];
};

export function allFields(schema: EntitySchema): SchemaField[] {
  const out: SchemaField[] = [];
  const walk = (nodes: SchemaNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'field') out.push(n);
      else walk(n.children);
    }
  };
  walk(schema.groups);
  return out;
}

export function findField(schema: EntitySchema, fieldId: string): SchemaField | undefined {
  return allFields(schema).find((f) => f.id === fieldId);
}

export function hasNode(schema: EntitySchema, nodeId: string): boolean {
  const walk = (nodes: SchemaNode[]): boolean =>
    nodes.some((n) => n.id === nodeId || (n.kind === 'group' && walk(n.children)));
  return walk(schema.groups);
}
