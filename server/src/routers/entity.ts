import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DB } from '../db';
import { campaigns, changes, entities, links, members, users, type ChangeTarget } from '../db/schema';
import { evaluate, type Tables } from '../formula';
import { effectiveSchema, getSchema, listModules, listSchemas } from '../schemas';
import { allFields, findField, hasNode, type EntitySchema, type SchemaField } from '../schemas/types';
import { authedProcedure, requireDm, router, viewerFor } from '../trpc';
import { canEditEntity, canSeeEntity, DM_ONLY, filterSchema, filterValues, type Viewer } from '../visibility';

type EntityRow = typeof entities.$inferSelect;
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

const audience = z.object({ all: z.boolean(), players: z.array(z.string()), parties: z.array(z.string()) });

function loadEntity(db: DB | Tx, id: string): EntityRow {
  const row = db.select().from(entities).where(and(eq(entities.id, id), isNull(entities.deletedAt))).get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

/** Loads an entity the caller may see. Hidden and missing entities give the same NOT_FOUND. */
function loadVisible(db: DB, userId: string, id: string): { row: EntityRow; viewer: Viewer } {
  const row = loadEntity(db, id);
  const viewer = viewerFor(db, userId, row.systemId);
  if (!canSeeEntity(viewer, row)) throw new TRPCError({ code: 'NOT_FOUND' });
  return { row, viewer };
}

function schemaOf(row: EntityRow) {
  const schema = effectiveSchema(row.typeKey, row.modules);
  if (!schema) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Unknown entity type ${row.typeKey}` });
  return schema;
}

/** The only shape in which an entity leaves the server. */
function toDto(db: DB, row: EntityRow, viewer: Viewer) {
  const full = schemaOf(row);
  const { schema, visibleFields } = filterSchema(full, row, viewer);
  const canEdit = canEditEntity(viewer, row);
  const values = filterValues(row.values, visibleFields);
  const computed = computeAll(full, row.values, ruleTables(db, row.systemId));
  for (const field of visibleFields) if (field.type === 'computed') values[field.id] = computed(field.id);
  return {
    id: row.id,
    systemId: row.systemId,
    typeKey: row.typeKey,
    name: row.name,
    ownerId: row.ownerId,
    campaignIds: visibleCampaigns(row, viewer),
    updatedAt: row.updatedAt,
    schema,
    values,
    canEdit,
    editableFields: canEdit
      ? visibleFields.filter((f) => f.type !== 'computed' && (viewer.role === 'dm' || !f.dmEditOnly)).map((f) => f.id)
      : [],
    modules: row.modules,
    // Which modules exist is sheet-building information, so only the DM gets the list.
    availableModules: viewer.role === 'dm' ? listModules(row.typeKey).map((m) => ({ key: m.key, name: m.name })) : [],
    // Audiences name other players, so only the DM receives them.
    access: viewer.role === 'dm' ? { visibility: row.visibility, fieldVisibility: row.fieldVisibility } : null,
  };
}

function logChange(
  tx: Tx,
  row: { id: string; systemId: string },
  userId: string,
  target: ChangeTarget,
  key: string | null,
  oldValue: unknown,
  newValue: unknown,
) {
  tx.insert(changes)
    .values({ systemId: row.systemId, entityId: row.id, target, key, oldValue, newValue, userId, at: Date.now() })
    .run();
}

function checkValue(field: SchemaField, value: unknown): unknown {
  if (value === null) return null;
  const isCount = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
  const ok = (() => {
    switch (field.type) {
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'text':
        return typeof value === 'string' && value.length <= 500;
      case 'longtext':
        return typeof value === 'string' && value.length <= 200_000;
      case 'select':
        return typeof value === 'string' && (field.options ?? []).some((o) => o.value === value);
      case 'pips':
        return isCount(value, field.max ?? 0);
      case 'pool': {
        const v = value as { cur?: unknown; max?: unknown };
        return typeof v === 'object' && Object.keys(v).length === 2 && isCount(v.max, 999) && isCount(v.cur, 999);
      }
      case 'table': {
        const v = value as { columns?: unknown; rows?: unknown };
        const cell = (x: unknown) => typeof x === 'string' && x.length <= 500;
        return (
          typeof v === 'object' &&
          Object.keys(v).length === 2 &&
          Array.isArray(v.columns) &&
          v.columns.length >= 1 &&
          v.columns.length <= 20 &&
          v.columns.every(cell) &&
          Array.isArray(v.rows) &&
          v.rows.length <= 500 &&
          v.rows.every((r) => Array.isArray(r) && r.length === (v.columns as unknown[]).length && r.every(cell))
        );
      }
      case 'list':
        return Array.isArray(value) && value.length <= 200 && value.every((x) => typeof x === 'string' && x.length <= 500);
      default:
        return false; // computed fields are never written
    }
  })();
  if (!ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Value does not fit a ${field.type} field` });
  return value;
}

/**
 * The rules tables of a system that formulas can read, found by their formula name.
 * They are loaded on first use only, and read whatever the viewer may see: a table that feeds
 * sheets is game rules, not a secret.
 */
function ruleTables(db: DB, systemId: string): Tables {
  let byName: Map<string, string[][]> | null = null;
  return (name) => {
    if (!byName) {
      byName = new Map();
      const rules = db
        .select({ values: entities.values })
        .from(entities)
        .where(and(eq(entities.systemId, systemId), eq(entities.typeKey, 'rule'), isNull(entities.deletedAt)))
        .all();
      for (const r of rules) {
        const key = r.values.formula_name;
        const table = r.values.table as { rows?: string[][] } | undefined;
        if (typeof key === 'string' && key.trim() && table?.rows) byName.set(key.trim(), table.rows);
      }
    }
    return byName.get(name) ?? null;
  };
}

/**
 * Returns a function giving the value of any field, working out computed ones on demand.
 * A formula may use other computed fields; a formula that leads back to itself gives null.
 */
function computeAll(schema: EntitySchema, stored: Record<string, unknown>, tables: Tables) {
  const formulas = new Map(allFields(schema).filter((f) => f.type === 'computed' && f.formula).map((f) => [f.id, f.formula!]));
  const done = new Map<string, unknown>();
  const running = new Set<string>();
  const get = (id: string): unknown => {
    const formula = formulas.get(id);
    if (!formula) return stored[id] ?? null;
    if (done.has(id)) return done.get(id);
    if (running.has(id)) return null;
    running.add(id);
    const result = evaluate(formula, get, tables);
    running.delete(id);
    done.set(id, result);
    return result;
  };
  return get;
}

/** Writes one field and its change-log entry. Returns false when the value did not change. */
function writeField(tx: Tx, entityId: string, fieldId: string, value: unknown, userId: string): boolean {
  const row = loadEntity(tx, entityId);
  const oldValue = row.values[fieldId] ?? null;
  if (JSON.stringify(oldValue) === JSON.stringify(value)) return false;
  const values = { ...row.values };
  if (value === null) delete values[fieldId];
  else values[fieldId] = value;
  tx.update(entities).set({ values, updatedAt: Date.now() }).where(eq(entities.id, entityId)).run();
  logChange(tx, row, userId, 'field', fieldId, oldValue, value);
  return true;
}

export const entityRouter = router({
  /** Entity types that exist. Schemas themselves travel with each entity, already filtered. */
  types: authedProcedure.input(z.object({ systemId: z.string() })).query(({ ctx, input }) => {
    const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
    return listSchemas().map((s) => ({
      key: s.key,
      name: s.name,
      plural: s.plural,
      canCreate: viewer.role === 'dm' || s.playerCreatable,
    }));
  }),

  list: authedProcedure
    .input(z.object({ systemId: z.string(), typeKey: z.string().optional() }))
    .query(({ ctx, input }) => {
      const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
      return ctx.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.systemId, input.systemId),
            isNull(entities.deletedAt),
            input.typeKey ? eq(entities.typeKey, input.typeKey) : undefined,
          ),
        )
        .orderBy(entities.name)
        .all()
        .filter((row) => canSeeEntity(viewer, row))
        .map((row) => ({
          id: row.id,
          typeKey: row.typeKey,
          name: row.name,
          ownerId: row.ownerId,
          campaignIds: visibleCampaigns(row, viewer),
          dmOnly: viewer.role === 'dm' ? isDmOnly(row) : undefined,
        }));
    }),

  get: authedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    return toDto(ctx.db, row, viewer);
  }),

  create: authedProcedure
    .input(
      z.object({
        systemId: z.string(),
        typeKey: z.string(),
        name: z.string().trim().min(1).max(200),
        campaignIds: z.array(z.string()).default([]),
      }),
    )
    .mutation(({ ctx, input }) => {
      const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
      const campaignIds = checkCampaigns(ctx.db, input.systemId, input.campaignIds);
      // A player may only file things under campaigns they play in.
      if (viewer.role !== 'dm' && campaignIds.some((c) => !viewer.campaignIds.includes(c)))
        throw new TRPCError({ code: 'NOT_FOUND' });
      const schema = getSchema(input.typeKey);
      if (!schema) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown entity type' });
      if (viewer.role !== 'dm' && !schema.playerCreatable) throw new TRPCError({ code: 'FORBIDDEN' });
      const now = Date.now();
      const row = {
        id: nanoid(),
        systemId: input.systemId,
        typeKey: input.typeKey,
        name: input.name,
        // A player owns what they create. What the DM creates starts unowned and DM-only.
        ownerId: viewer.role === 'dm' ? null : ctx.user.id,
        campaignIds,
        visibility: DM_ONLY,
        fieldVisibility: {},
        modules: [],
        values: {},
        createdAt: now,
        updatedAt: now,
      };
      ctx.db.transaction((tx) => {
        tx.insert(entities).values(row).run();
        logChange(tx, row, ctx.user.id, 'create', null, null, { name: row.name, typeKey: row.typeKey });
      });
      return { id: row.id };
    }),

  rename: authedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(200) }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      if (!canEditEntity(viewer, row)) throw new TRPCError({ code: 'FORBIDDEN' });
      if (row.name === input.name) return { ok: true };
      ctx.db.transaction((tx) => {
        tx.update(entities).set({ name: input.name, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'name', null, row.name, input.name);
      });
      return { ok: true };
    }),

  /** One field, one change-log entry. Two people editing different fields never collide. */
  setField: authedProcedure
    .input(z.object({ id: z.string(), fieldId: z.string(), value: z.unknown() }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      const dto = toDto(ctx.db, row, viewer);
      // A field the caller cannot see answers exactly like a field that does not exist.
      if (!dto.editableFields.includes(input.fieldId)) throw new TRPCError({ code: 'FORBIDDEN' });
      const field = findField(schemaOf(row), input.fieldId)!;
      const value = checkValue(field, input.value ?? null);
      ctx.db.transaction((tx) => writeField(tx, row.id, field.id, value, ctx.user.id));
      return { ok: true };
    }),

  setOwner: authedProcedure
    .input(z.object({ id: z.string(), ownerId: z.string().nullable() }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      requireDm(viewer);
      if (input.ownerId) {
        const member = ctx.db
          .select()
          .from(members)
          .where(and(eq(members.systemId, row.systemId), eq(members.userId, input.ownerId)))
          .get();
        if (!member) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a member of this system' });
      }
      ctx.db.transaction((tx) => {
        tx.update(entities).set({ ownerId: input.ownerId, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'owner', null, row.ownerId, input.ownerId);
      });
      return { ok: true };
    }),

  /** Files the entity under campaigns. None means campaign-agnostic: its audience alone decides who sees it. */
  setCampaigns: authedProcedure
    .input(z.object({ id: z.string(), campaignIds: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      requireDm(viewer);
      const campaignIds = checkCampaigns(ctx.db, row.systemId, input.campaignIds);
      ctx.db.transaction((tx) => {
        tx.update(entities).set({ campaignIds, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'campaigns', null, row.campaignIds, campaignIds);
      });
      return { ok: true };
    }),

  /** Attaches or removes sheet modules. Values of a removed module are kept, so re-attaching brings them back. */
  setModules: authedProcedure
    .input(z.object({ id: z.string(), modules: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      requireDm(viewer);
      const known = new Set(listModules(row.typeKey).map((m) => m.key));
      const modules = [...new Set(input.modules)];
      if (modules.some((m) => !known.has(m))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown module' });
      ctx.db.transaction((tx) => {
        tx.update(entities).set({ modules, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'modules', null, row.modules, modules);
      });
      return { ok: true };
    }),

  setVisibility: authedProcedure.input(z.object({ id: z.string(), audience })).mutation(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    requireDm(viewer);
    ctx.db.transaction((tx) => {
      tx.update(entities).set({ visibility: input.audience, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
      logChange(tx, row, ctx.user.id, 'visibility', null, row.visibility, input.audience);
    });
    return { ok: true };
  }),

  /** Overrides the audience of one group or field on this entity. Null returns it to the schema default. */
  setFieldVisibility: authedProcedure
    .input(z.object({ id: z.string(), nodeId: z.string(), audience: audience.nullable() }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      requireDm(viewer);
      if (!hasNode(schemaOf(row), input.nodeId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown field or group' });
      const fieldVisibility = { ...row.fieldVisibility };
      const old = fieldVisibility[input.nodeId] ?? null;
      if (input.audience) fieldVisibility[input.nodeId] = input.audience;
      else delete fieldVisibility[input.nodeId];
      ctx.db.transaction((tx) => {
        tx.update(entities).set({ fieldVisibility, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'fieldVisibility', input.nodeId, old, input.audience);
      });
      return { ok: true };
    }),

  /** Soft delete: the entity and its history stay in the database and can be restored. */
  delete: authedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    if (!canEditEntity(viewer, row)) throw new TRPCError({ code: 'FORBIDDEN' });
    ctx.db.transaction((tx) => {
      tx.update(entities).set({ deletedAt: Date.now() }).where(eq(entities.id, row.id)).run();
      logChange(tx, row, ctx.user.id, 'delete', null, null, null);
    });
    return { ok: true };
  }),

  listDeleted: authedProcedure.input(z.object({ systemId: z.string() })).query(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    return ctx.db
      .select({ id: entities.id, name: entities.name, typeKey: entities.typeKey, deletedAt: entities.deletedAt })
      .from(entities)
      .where(eq(entities.systemId, input.systemId))
      .all()
      .filter((e) => e.deletedAt !== null);
  }),

  restore: authedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const row = ctx.db.select().from(entities).where(eq(entities.id, input.id)).get();
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    requireDm(viewerFor(ctx.db, ctx.user.id, row.systemId));
    ctx.db.transaction((tx) => {
      tx.update(entities).set({ deletedAt: null }).where(eq(entities.id, row.id)).run();
      logChange(tx, row, ctx.user.id, 'restore', null, null, null);
    });
    return { ok: true };
  }),

  // ---- History ----

  /** Who changed what and when. DM only, because it contains every field's past values. */
  history: authedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    requireDm(viewer);
    const schema = schemaOf(row);
    return ctx.db
      .select({
        id: changes.id,
        target: changes.target,
        key: changes.key,
        oldValue: changes.oldValue,
        newValue: changes.newValue,
        at: changes.at,
        userName: users.displayName,
      })
      .from(changes)
      .leftJoin(users, eq(users.id, changes.userId))
      .where(eq(changes.entityId, row.id))
      .orderBy(desc(changes.id))
      .limit(500)
      .all()
      .map((c) => ({
        ...c,
        label: c.target === 'field' && c.key ? (findField(schema, c.key)?.label ?? c.key) : null,
        canRevert: c.target === 'field' || c.target === 'name',
      }));
  }),

  /** Puts a field or the name back to what it was before the given change. Logged as a new change. */
  revert: authedProcedure.input(z.object({ changeId: z.number() })).mutation(({ ctx, input }) => {
    const change = ctx.db.select().from(changes).where(eq(changes.id, input.changeId)).get();
    if (!change) throw new TRPCError({ code: 'NOT_FOUND' });
    requireDm(viewerFor(ctx.db, ctx.user.id, change.systemId));
    ctx.db.transaction((tx) => {
      const row = loadEntity(tx, change.entityId);
      if (change.target === 'field' && change.key) {
        writeField(tx, row.id, change.key, change.oldValue ?? null, ctx.user.id);
      } else if (change.target === 'name' && typeof change.oldValue === 'string') {
        tx.update(entities).set({ name: change.oldValue, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'name', null, row.name, change.oldValue);
      } else {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This kind of change cannot be reverted' });
      }
    });
    return { ok: true };
  }),

  // ---- Links ----

  link: authedProcedure
    .input(
      z.object({
        fromId: z.string(),
        kind: z.string().trim().min(1).max(40),
        toId: z.string(),
        data: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(({ ctx, input }) => {
      const from = loadVisible(ctx.db, ctx.user.id, input.fromId);
      if (!canEditEntity(from.viewer, from.row)) throw new TRPCError({ code: 'FORBIDDEN' });
      const to = loadVisible(ctx.db, ctx.user.id, input.toId);
      if (to.row.systemId !== from.row.systemId) throw new TRPCError({ code: 'BAD_REQUEST' });
      const id = nanoid();
      ctx.db.transaction((tx) => {
        tx.insert(links)
          .values({ id, systemId: from.row.systemId, fromId: from.row.id, kind: input.kind, toId: to.row.id, data: input.data, createdAt: Date.now() })
          .run();
        logChange(tx, from.row, ctx.user.id, 'link', id, null, { kind: input.kind, toId: to.row.id, data: input.data });
      });
      return { id };
    }),

  unlink: authedProcedure.input(z.object({ linkId: z.string() })).mutation(({ ctx, input }) => {
    const link = ctx.db.select().from(links).where(eq(links.id, input.linkId)).get();
    if (!link) throw new TRPCError({ code: 'NOT_FOUND' });
    const from = loadVisible(ctx.db, ctx.user.id, link.fromId);
    if (!canEditEntity(from.viewer, from.row)) throw new TRPCError({ code: 'FORBIDDEN' });
    ctx.db.transaction((tx) => {
      tx.delete(links).where(eq(links.id, link.id)).run();
      logChange(tx, from.row, ctx.user.id, 'link', link.id, { kind: link.kind, toId: link.toId, data: link.data }, null);
    });
    return { ok: true };
  }),

  /** Links from and to an entity. A link is returned only when the caller may see both ends. */
  links: authedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    const rows = ctx.db
      .select()
      .from(links)
      .where(or(eq(links.fromId, row.id), eq(links.toId, row.id)))
      .all();
    const out = [];
    for (const l of rows) {
      const otherId = l.fromId === row.id ? l.toId : l.fromId;
      const other = ctx.db.select().from(entities).where(and(eq(entities.id, otherId), isNull(entities.deletedAt))).get();
      if (!other || !canSeeEntity(viewer, other)) continue;
      out.push({
        id: l.id,
        kind: l.kind,
        direction: l.fromId === row.id ? ('out' as const) : ('in' as const),
        data: l.data,
        other: { id: other.id, name: other.name, typeKey: other.typeKey },
      });
    }
    return out;
  }),
});

/** Campaign tags of an entity, without the campaigns a player is not part of. */
function visibleCampaigns(row: EntityRow, viewer: Viewer): string[] {
  return viewer.role === 'dm' ? row.campaignIds : row.campaignIds.filter((c) => viewer.campaignIds.includes(c));
}

/** Returns the ids without duplicates, or fails when one is not a campaign of this system. */
function checkCampaigns(db: DB, systemId: string, ids: string[]): string[] {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const known = new Set(db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.systemId, systemId)).all().map((c) => c.id));
  if (unique.some((id) => !known.has(id))) throw new TRPCError({ code: 'NOT_FOUND' });
  return unique;
}

function isDmOnly(row: EntityRow): boolean {
  return !row.ownerId && !row.visibility.all && !row.visibility.players.length && !row.visibility.parties.length;
}
