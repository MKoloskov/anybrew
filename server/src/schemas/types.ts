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
  /** Formatted text, stored as cleaned HTML. */
  | 'richtext'
  /** An uploaded picture. Stored as the id of the file. */
  | 'image'
  /** Several uploaded pictures. Stored as the ids of the files, in order. */
  | 'gallery'
  /** A talent tree: its trees, talents, costs and prerequisites. Stored as TalentData. */
  | 'talents'
  /** Which talents of the tree in the field before it are taken, and on which level. */
  | 'talentpicks'
  /** A free table: headings and rows of text cells. Stored as { columns: string[], rows: string[][] }. */
  | 'table'
  /** The classes of a character: class document, subclass and level each. Stored as ClassPick[]. */
  | 'classes'
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
  /** Headings a new table starts with. */
  columns?: string[];
  /** On a gallery: the id of the image field that holds the picture chosen as the main one. */
  main?: string;
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
  /** Added to one entity by the DM, not part of the shared sheet. */
  custom?: boolean;
  /** Key of the sheet page a top-level group is shown on, for a type that has pages. */
  page?: string;
  visibility?: Audience;
  /** Seen by the DM and the entity's owner only, unless the entity overrides this node's audience. */
  ownerOnly?: boolean;
  children: SchemaNode[];
};

export type SchemaNode = SchemaGroup | SchemaField;

/** One page of a sheet. Pages are a layout, never a permission: a page shows what the server sent. */
export type SchemaPage = {
  key: string;
  label: string;
  /**
   * Ids of groups or fields that live on another page and are shown here as well.
   * The value is stored once; the audience of its own group decides who receives it.
   */
  shows?: string[];
};

export type EntitySchema = {
  key: string;
  name: string;
  /** Plural name for the tab that lists these entities. */
  plural: string;
  /** Players may create entities of this type; they become the owner. */
  playerCreatable: boolean;
  /** New entities of this type are open to all players (rules, glossary) instead of DM-only. */
  openByDefault?: boolean;
  /** The pages of the sheet, in menu order. A type without pages is one long sheet. */
  pages?: SchemaPage[];
  /** The page that sections added to a single entity go to. */
  customPage?: string;
  /**
   * The outside view: ids of the only fields that a player who is neither the owner nor the DM
   * receives. Everything else is closed to them, unless the DM opened a part on that one entity.
   * Their links to other entities are closed as well. Without this list the whole sheet is open.
   */
  outside?: string[];
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
