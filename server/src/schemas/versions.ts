import type { Audience } from '../visibility';
import type { FieldType } from './types';

// Schema versioning.
//
// Stored data is keyed by the ids of schema nodes: the values of an entity, its audience overrides,
// its translations, its pictures and its change log. Adding a field needs nothing. Every other
// change to a schema (renaming an id, removing a node, moving a node out of a group, changing a
// field's type or options, changing who sees a node by default) needs a migration here, so the
// stored data follows the schema.
//
// How to change a schema:
//   1. Edit the schema files.
//   2. Run `npm run schema:check -w server`. It lists what changed and prints the ops to write.
//   3. Add ONE migration with those ops to the end of `schemaMigrations`, numbered one higher.
//   4. Run `npm run schema:accept -w server` and commit `snapshot.json` with the code.
// A test (test/schema-versioning.test.ts) fails until this is done.
//
// Every System records the version its data is at. On start the server brings each System up to
// date (after a safety copy of the database); an import does the same for the imported file.
//
// All ids in the ops of one migration are the ids from BEFORE that migration, except `rename.to`.
// Inside one migration the ops take effect in this order: move, convert, rename, remove, modules.

export type SchemaOp =
  /** A group or field gets a new id. Values, overrides, translations, pictures and history follow. */
  | { op: 'rename'; type: string; from: string; to: string }
  /** A group or field is gone. Its value, override and translations are deleted; its id is never used again. */
  | { op: 'remove'; type: string; id: string }
  /**
   * A group or field left the groups in `lost` (they are no longer above it). Where an entity
   * narrowed one of those groups, the node gets that audience itself, so nothing becomes wider.
   * `default` and `ownerOnly` repeat what the node carries in the new schema.
   */
  | { op: 'move'; type: string; id: string; lost: string[]; default?: Audience; ownerOnly?: boolean }
  /** A field changes its type or loses options. `fn` rewrites each stored value and the values in the history. */
  | { op: 'convert'; type: string; id: string; to: FieldType; fn?: (value: unknown) => unknown }
  | { op: 'renameModule'; type: string; from: string; to: string }
  | { op: 'removeModule'; type: string; key: string }
  /**
   * States on purpose that the default audience of a node changed (who sees it without an override),
   * or of everything under a group, or of the whole type with id '*'. Changes no data.
   */
  | { op: 'access'; type: string; id: string; why: string };

export type SchemaMigration = {
  /** 1, 2, 3… with no gaps. */
  version: number;
  date: string;
  what: string;
  ops: SchemaOp[];
};

/** Version 0 is the schemas as they stood on 2026-11-18. Tests add their own entries. */
export const schemaMigrations: SchemaMigration[] = [];

export const currentSchemaVersion = () => schemaMigrations.length;
