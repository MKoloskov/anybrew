// The single place that decides what a viewer may see.
// Every read endpoint must pass its data through these functions before returning it.

import type { EntitySchema, SchemaField, SchemaGroup, SchemaNode } from './schemas/types';

/** Who may see something. The DM always may. Empty lists and all=false means DM only. */
export type Audience = { all: boolean; players: string[]; parties: string[] };

export const DM_ONLY: Audience = { all: false, players: [], parties: [] };
export const EVERYONE: Audience = { all: true, players: [], parties: [] };

export type Viewer = { userId: string; role: 'dm' | 'player'; campaignIds: string[]; partyIds: string[] };

export function inAudience(viewer: Viewer, audience: Audience): boolean {
  if (viewer.role === 'dm') return true;
  if (audience.all) return true;
  if (audience.players.includes(viewer.userId)) return true;
  return audience.parties.some((p) => viewer.partyIds.includes(p));
}

type EntityAccess = {
  ownerId: string | null;
  campaignIds: string[];
  visibility: Audience;
  fieldVisibility: Record<string, Audience>;
};

/**
 * The owner always sees their own entity, but not groups or fields narrowed below it.
 * An entity tagged with campaigns is closed to every player outside those campaigns,
 * whatever its audience says: "all players" then means all players of those campaigns.
 */
export function canSeeEntity(viewer: Viewer, entity: EntityAccess): boolean {
  if (viewer.role === 'dm' || entity.ownerId === viewer.userId) return true;
  if (entity.campaignIds.length && !entity.campaignIds.some((c) => viewer.campaignIds.includes(c))) return false;
  return inAudience(viewer, entity.visibility);
}

export function canEditEntity(viewer: Viewer, entity: EntityAccess): boolean {
  return viewer.role === 'dm' || entity.ownerId === viewer.userId;
}

export type FilteredSchema = {
  /** The schema with every group and field the viewer may not see removed. */
  schema: EntitySchema;
  visibleFields: SchemaField[];
};

/**
 * Removes hidden groups and fields from a schema for one entity and one viewer.
 * A node's audience is the entity's override for that node, else the schema's default.
 * A hidden group hides everything inside it, so a child can only narrow, never widen.
 *
 * A type with an outside view (`schema.outside`) sends a viewer who is neither the owner nor the DM
 * only the fields of that view. A part that carries an audience of its own is the exception:
 * the audience decides, and what it opens stays open inside. A group that is itself closed is
 * still sent, with only those children, when a field of the outside view or an opened part lies in it.
 */
export function filterSchema(schema: EntitySchema, entity: EntityAccess, viewer: Viewer): FilteredSchema {
  const visibleFields: SchemaField[] = [];
  const outsider = isOutsider(viewer, entity);
  const outside = schema.outside ? new Set(schema.outside) : null;
  const audienceOf = (node: SchemaNode) => entity.fieldVisibility[node.id] ?? node.visibility;
  // Something of the outside view, or a part with an audience of its own, lies in or under this node.
  const leadsOutside = (node: SchemaNode): boolean => {
    const audience = audienceOf(node);
    if (audience) return inAudience(viewer, audience);
    return node.kind === 'field' ? outside!.has(node.id) : node.children.some(leadsOutside);
  };

  const visit = (node: SchemaNode, opened: boolean): SchemaNode | null => {
    const audience = audienceOf(node);
    if (audience && !inAudience(viewer, audience)) return null;
    if (!audience && outsider) {
      // Owner-only parts stay closed to other players unless the DM opened them on this entity.
      if (node.ownerOnly) return null;
      if (outside && !opened && !leadsOutside(node)) return null;
    }
    if (node.kind === 'field') {
      visibleFields.push(node);
      return viewer.role === 'dm' ? node : stripAudience(node);
    }
    const children = node.children.map((c) => visit(c, opened || !!audience)).filter((c): c is SchemaNode => c !== null);
    const group: SchemaGroup = { ...node, children };
    return viewer.role === 'dm' ? group : stripAudience(group);
  };

  const groups = schema.groups.map((g) => visit(g, false)).filter((g): g is SchemaGroup => g !== null && g.kind === 'group');
  return { schema: { ...schema, groups }, visibleFields };
}

/** Someone who may see the entity but is neither its owner nor the DM. */
export function isOutsider(viewer: Viewer, entity: { ownerId: string | null }): boolean {
  return viewer.role !== 'dm' && entity.ownerId !== viewer.userId;
}

/** Players are not told who else can see a field. */
function stripAudience<T extends SchemaNode>(node: T): T {
  const { visibility: _hidden, ...rest } = node;
  return rest as T;
}

/** Keeps only the values of fields the viewer may see. Unknown keys are dropped. */
export function filterValues(values: Record<string, unknown>, visibleFields: SchemaField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of visibleFields) if (f.id in values) out[f.id] = values[f.id];
  return out;
}
