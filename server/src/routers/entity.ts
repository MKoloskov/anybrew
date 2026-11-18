import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { CLASS_MODULE, classFile, classPicks, featureKey, parseSaves, picksOf, tableRowFor, type ClassPick } from '../classes';
import type { DB } from '../db';
import { campaigns, changes, entities, files, links, members, systems, translations, users, type ChangeTarget } from '../db/schema';
import { evaluate, type Tables } from '../formula';
import { cleanHtml, htmlToText } from '../richtext';
import { effectiveSchema, getSchema, listModules, listSchemas } from '../schemas';
import { CARD_FIELDS, type CardFieldKey } from '../schemas/character';
import { CLASS_FEATURE, LINK_KIND } from '../schemas/library';
import { allFields, findField, hasNode, type EntitySchema, type SchemaField, type SchemaGroup } from '../schemas/types';
import { parseTalents, type TalentPicks } from '../talents';
import { authedProcedure, requireDm, router, viewerFor } from '../trpc';
import { canEditEntity, canSeeEntity, DM_ONLY, EVERYONE, filterSchema, filterValues, isOutsider, type Viewer } from '../visibility';

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
  const schema = effectiveSchema(row.typeKey, row.modules, row.customSchema);
  if (!schema) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Unknown entity type ${row.typeKey}` });
  return schema;
}

/**
 * A type with an outside view keeps what it is linked to (its features, spells and items) and its
 * sheet modules for the owner and the DM.
 */
function closedTo(viewer: Viewer, row: EntityRow): boolean {
  return !!getSchema(row.typeKey)?.outside && isOutsider(viewer, row);
}

export const GALLERY_MAX = 30;

/** The pictures of a gallery. A main picture that was set outside the gallery counts as its first picture. */
export function galleryOf(field: SchemaField, values: Record<string, unknown>): string[] {
  const stored = Array.isArray(values[field.id]) ? (values[field.id] as string[]) : [];
  const main = field.main ? values[field.main] : null;
  return typeof main === 'string' && main && !stored.includes(main) ? [main, ...stored] : stored;
}

/** The only shape in which an entity leaves the server. */
function toDto(db: DB, row: EntityRow, viewer: Viewer) {
  const full = schemaOf(row);
  const { schema, visibleFields } = filterSchema(full, row, viewer);
  const canEdit = canEditEntity(viewer, row);
  const values = filterValues(row.values, visibleFields);
  const computed = computeAll(full, row.values, ruleTables(db, row.systemId));
  for (const field of visibleFields) {
    if (field.type === 'computed') values[field.id] = computed(field.id);
    // Rich text is cleaned again on the way out, so nothing stored by an older version or an import can carry a script.
    else if (field.type === 'richtext' && typeof values[field.id] === 'string') values[field.id] = cleanHtml(values[field.id] as string);
    else if (field.type === 'gallery') {
      const pictures = galleryOf(field, row.values);
      if (pictures.length) values[field.id] = pictures;
    }
  }
  // Russian texts of the long fields this viewer may see. A translation is never wider than its source.
  const translated: Record<string, { text: string; outdated: boolean }> = {};
  const visibleIds = new Set(visibleFields.map((f) => f.id));
  for (const t of db.select().from(translations).where(eq(translations.entityId, row.id)).all())
    if (t.lang === 'ru' && visibleIds.has(t.fieldId))
      translated[t.fieldId] = { text: t.text, outdated: t.sourceSnapshot !== String(row.values[t.fieldId] ?? '') };
  return {
    id: row.id,
    systemId: row.systemId,
    typeKey: row.typeKey,
    name: row.name,
    nameRu: row.nameRu,
    translations: translated,
    ownerId: row.ownerId,
    campaignIds: visibleCampaigns(row, viewer),
    updatedAt: row.updatedAt,
    schema,
    values,
    canEdit,
    editableFields: canEdit
      ? visibleFields.filter((f) => f.type !== 'computed' && (viewer.role === 'dm' || !f.dmEditOnly)).map((f) => f.id)
      : [],
    modules: closedTo(viewer, row) ? [] : row.modules,
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

export function checkValue(field: SchemaField, value: unknown): unknown {
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
      case 'richtext':
        return typeof value === 'string' && value.length <= 500_000;
      case 'talents':
        return typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 400_000;
      case 'talentpicks':
        return (
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.entries(value as object).length <= 500 &&
          Object.values(value as TalentPicks).every(
            (v) => v && typeof v === 'object' && Object.keys(v).length === 1 && (v.level === null || isCount(v.level, 99)),
          )
        );
      case 'classes':
        return classPicks.safeParse(value).success;
      case 'list':
        return Array.isArray(value) && value.length <= 200 && value.every((x) => typeof x === 'string' && x.length <= 500);
      default:
        return false; // computed fields are never written, and an image is set by uploading a file
    }
  })();
  if (!ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Value does not fit a ${field.type} field` });
  if (field.type === 'richtext') {
    const html = cleanHtml(value as string);
    return htmlToText(html) === '' ? null : html;
  }
  if (field.type === 'classes') return (value as unknown[]).length ? value : null;
  return value;
}

const sameText = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
const isClass = (row: EntityRow) => row.typeKey === 'rule' && row.modules.includes(CLASS_MODULE);

/** The class document behind a pick, when the viewer may see it; null otherwise. */
function classOf(db: DB | Tx, viewer: Viewer, systemId: string, classId: string): EntityRow | null {
  const row = db.select().from(entities).where(and(eq(entities.id, classId), isNull(entities.deletedAt))).get();
  return row && row.systemId === systemId && isClass(row) && canSeeEntity(viewer, row) ? row : null;
}

/**
 * What choosing classes writes into the sheet, each as its own logged change that can be undone:
 * the Level (sum of the class levels) and the hit dice every time; saving throw and other
 * proficiencies from the first class, only when the first class itself changes, so later hand
 * edits are not overwritten on a level-up.
 */
function applyClasses(tx: Tx, row: EntityRow, viewer: Viewer, before: ClassPick[], picks: ClassPick[], userId: string) {
  const schema = schemaOf(row);
  const set = (fieldId: string, value: unknown) => {
    if (findField(schema, fieldId)) writeField(tx, row.id, fieldId, value, userId);
  };
  const classes = picks.map((p) => ({ pick: p, doc: classOf(tx, viewer, row.systemId, p.classId) }));
  const total = picks.reduce((n, p) => n + p.level, 0);
  if (!total) return;
  set('level', total);
  const dice = classes
    .filter((c) => typeof c.doc?.values.hit_die === 'number')
    .map((c) => `${c.pick.level}d${c.doc!.values.hit_die as number}`)
    .join(' + ');
  if (dice) set('hit_dice_kind', dice);
  const pool = row.values.hit_dice as { cur: number; max: number } | undefined;
  set('hit_dice', { cur: pool ? Math.min(pool.cur, total) : total, max: total });

  const first = classes[0]?.doc;
  if (!first || before[0]?.classId === picks[0]!.classId) return;
  for (const ability of parseSaves(first.values.class_saves)) set(`save_${ability}_prof`, true);
  for (const [from, to] of [['class_armor', 'prof_armor_default'], ['class_weapons', 'prof_weapons_default'], ['class_tools', 'prof_tools_default']] as const) {
    const text = first.values[from];
    if (typeof text === 'string' && text.trim()) set(to, text.trim());
  }
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

const customId = z.string().regex(/^c_[a-z0-9]{4,24}$/);
const customGroup = z.object({
  id: customId,
  label: z.string().trim().min(1).max(80),
  children: z
    .array(
      z.object({
        id: customId,
        label: z.string().trim().min(1).max(80),
        type: z.enum(['text', 'longtext', 'richtext', 'number', 'boolean', 'pips', 'pool', 'list']),
        max: z.number().int().min(1).max(20).optional(),
      }),
    )
    .max(50),
});

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
      const holders = holdersOf(ctx.db, input.systemId, viewer);
      const card = cardsOf(ctx.db, input.systemId, viewer);
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
        .map((row) => ({ row, seen: filterValues(row.values, filterSchema(schemaOf(row), row, viewer).visibleFields) }))
        .map(({ row, seen }) => ({
          id: row.id,
          typeKey: row.typeKey,
          name: row.name,
          nameRu: row.nameRu,
          ownerId: row.ownerId,
          campaignIds: visibleCampaigns(row, viewer),
          dmOnly: viewer.role === 'dm' ? isDmOnly(row) : undefined,
          // What lists sort, group and filter by. Only values of fields this viewer may see.
          info: linkInfo(seen),
          // What the card of a character shows, again only from fields this viewer may see.
          card: row.typeKey === 'character' ? card(seen) : null,
          // The characters that have this feature, spell or item, as far as the viewer may see them.
          holderIds: row.typeKey in LINK_KIND ? holders(row.id) : [],
          // A rules document that characters can take as a class.
          isClass: isClass(row),
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
        nameRu: null,
        // A player owns what they create. What the DM creates starts unowned and DM-only,
        // except types that are reference material for everyone, such as rules and glossary terms.
        ownerId: viewer.role === 'dm' ? null : ctx.user.id,
        campaignIds,
        visibility: schema.openByDefault ? EVERYONE : DM_ONLY,
        fieldVisibility: {},
        modules: [],
        customSchema: [],
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
      const picks = field.type === 'classes' ? picksOf(value) : [];
      // A class that does not exist, or that the caller may not see, cannot be taken.
      if (picks.some((p) => !classOf(ctx.db, viewer, row.systemId, p.classId)))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a class of this system' });
      ctx.db.transaction((tx) => {
        const changed = writeField(tx, row.id, field.id, value, ctx.user.id);
        if (changed && field.type === 'classes') applyClasses(tx, row, viewer, picksOf(row.values[field.id]), picks, ctx.user.id);
      });
      return { ok: true };
    }),

  /** Takes one picture out of a gallery. When it was the main picture, the next one becomes the main. */
  removePicture: authedProcedure
    .input(z.object({ id: z.string(), fieldId: z.string(), fileId: z.string() }))
    .mutation(({ ctx, input }) => {
      const { row, field } = editableGallery(ctx.db, ctx.user.id, input);
      const left = galleryOf(field, row.values).filter((p) => p !== input.fileId);
      ctx.db.transaction((tx) => {
        writeField(tx, row.id, field.id, left.length ? left : null, ctx.user.id);
        if (field.main && row.values[field.main] === input.fileId) writeField(tx, row.id, field.main, left[0] ?? null, ctx.user.id);
      });
      return { ok: true };
    }),

  /** Chooses the main picture among those of a gallery: the one that cards and the sheet header show. */
  setMainPicture: authedProcedure
    .input(z.object({ id: z.string(), fieldId: z.string(), fileId: z.string() }))
    .mutation(({ ctx, input }) => {
      const { row, field, editable } = editableGallery(ctx.db, ctx.user.id, input);
      if (!field.main || !editable.includes(field.main)) throw new TRPCError({ code: 'FORBIDDEN' });
      const main = field.main;
      ctx.db.transaction((tx) => {
        // The list is stored in full first, so the picture that stops being the main one stays in the gallery.
        writeField(tx, row.id, field.id, galleryOf(field, row.values), ctx.user.id);
        writeField(tx, row.id, main, input.fileId, ctx.user.id);
      });
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

  /** The Russian form of the name. Empty removes it. */
  setNameRu: authedProcedure
    .input(z.object({ id: z.string(), nameRu: z.string().trim().max(200) }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      if (!canEditEntity(viewer, row)) throw new TRPCError({ code: 'FORBIDDEN' });
      const nameRu = input.nameRu || null;
      if (nameRu === row.nameRu) return { ok: true };
      ctx.db.transaction((tx) => {
        tx.update(entities).set({ nameRu, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
        logChange(tx, row, ctx.user.id, 'nameRu', null, row.nameRu, nameRu);
      });
      return { ok: true };
    }),

  /** The Russian text of one long field. Written by the DM; null removes it. */
  setTranslation: authedProcedure
    .input(z.object({ id: z.string(), fieldId: z.string(), text: z.string().max(500_000).nullable() }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      requireDm(viewer);
      const field = findField(schemaOf(row), input.fieldId);
      if (!field || (field.type !== 'longtext' && field.type !== 'richtext'))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only long texts are translated' });
      let text = input.text;
      if (text !== null && field.type === 'richtext') text = cleanHtml(text);
      if (text !== null && (field.type === 'richtext' ? htmlToText(text) : text.trim()) === '') text = null;
      const key = and(eq(translations.entityId, row.id), eq(translations.fieldId, field.id), eq(translations.lang, 'ru'));
      ctx.db.transaction((tx) => {
        const old = tx.select().from(translations).where(key).get();
        tx.delete(translations).where(key).run();
        if (text !== null)
          tx.insert(translations)
            .values({
              entityId: row.id,
              fieldId: field.id,
              lang: 'ru',
              text,
              sourceSnapshot: String(row.values[field.id] ?? ''),
              updatedBy: ctx.user.id,
              updatedAt: Date.now(),
            })
            .run();
        logChange(tx, row, ctx.user.id, 'translation', field.id, old?.text ?? null, text);
      });
      return { ok: true };
    }),

  /**
   * Replaces the sections and fields that belong to this one entity. Values of a removed field
   * stay stored, so putting a field back with the same id brings its value back.
   */
  setCustomSchema: authedProcedure.input(z.object({ id: z.string(), groups: z.array(customGroup).max(20) })).mutation(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    requireDm(viewer);
    const shared = effectiveSchema(row.typeKey, row.modules)!;
    const taken = new Set<string>();
    const claim = (id: string) => {
      if (taken.has(id) || hasNode(shared, id)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Two parts of the sheet share an id' });
      taken.add(id);
    };
    const groups: SchemaGroup[] = input.groups.map((g) => {
      claim(g.id);
      return {
        kind: 'group',
        id: g.id,
        label: g.label,
        custom: true,
        children: g.children.map((c) => {
          claim(c.id);
          return { kind: 'field', id: c.id, label: c.label, type: c.type, ...(c.type === 'pips' ? { max: c.max ?? 1 } : {}) };
        }),
      };
    });
    ctx.db.transaction((tx) => {
      tx.update(entities).set({ customSchema: groups, updatedAt: Date.now() }).where(eq(entities.id, row.id)).run();
      logChange(tx, row, ctx.user.id, 'customSchema', null, row.customSchema, groups);
    });
    return { ok: true };
  }),

  /**
   * Loads a talent tree from the text of the DM's note. The note is the master copy: trees, costs and
   * "(+)" taken marks come from it. Contract levels already entered for taken talents are kept.
   */
  importTalents: authedProcedure
    .input(z.object({ id: z.string(), markdown: z.string().max(500_000) }))
    .mutation(({ ctx, input }) => {
      const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
      requireDm(viewer);
      if (!findField(schemaOf(row), 'talents'))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Attach the Talent tree module to this character first' });
      const { data, picks, dmNotes } = parseTalents(input.markdown);
      const talentCount = data.patrons.reduce((n, p) => n + p.trees.reduce((m, t) => m + t.talents.length, 0), 0);
      if (!talentCount) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No talents were found in this text' });
      const before = (row.values.talents_taken ?? {}) as TalentPicks;
      for (const id of Object.keys(picks)) if (before[id]) picks[id] = before[id]!;
      ctx.db.transaction((tx) => {
        writeField(tx, row.id, 'talents', data, ctx.user.id);
        writeField(tx, row.id, 'talents_taken', picks, ctx.user.id);
        writeField(tx, row.id, 'talents_dm_notes', dmNotes || null, ctx.user.id);
      });
      return { trees: data.patrons.reduce((n, p) => n + p.trees.length, 0), talents: talentCount, taken: Object.keys(picks).length };
    }),

  /** The glossary terms the caller may see, for hover definitions and Russian forms of labels. */
  glossary: authedProcedure.input(z.object({ systemId: z.string() })).query(({ ctx, input }) => {
    const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
    return ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.systemId, input.systemId), eq(entities.typeKey, 'glossary'), isNull(entities.deletedAt)))
      .all()
      .filter((row) => canSeeEntity(viewer, row))
      .map((row) => ({
        id: row.id,
        term: row.name,
        ru: row.nameRu,
        definition: typeof row.values.definition === 'string' ? row.values.definition : '',
        aliases: Array.isArray(row.values.aliases) ? (row.values.aliases as string[]) : [],
      }));
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

  // ---- Classes ----

  /**
   * What a character gets from its classes: for each one the hit die, proficiencies, the line of
   * the class table for its level, the subclasses to choose from, and the class features up to
   * that level. Everything is read through the viewer's eyes.
   */
  classInfo: authedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const { row, viewer } = loadVisible(ctx.db, ctx.user.id, input.id);
    const picks = picksOf(toDto(ctx.db, row, viewer).values.classes);
    if (!picks.length) return [];
    const features = ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.systemId, row.systemId), eq(entities.typeKey, 'feature'), isNull(entities.deletedAt)))
      .all()
      .filter((f) => canSeeEntity(viewer, f))
      .map((f) => ({ id: f.id, name: f.name, nameRu: f.nameRu, info: linkInfo(toDto(ctx.db, f, viewer).values) }))
      .filter((f) => sameText(f.info.ftype, CLASS_FEATURE));
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return picks.map((pick) => {
      const doc = classOf(ctx.db, viewer, row.systemId, pick.classId);
      if (!doc) return { ...pick, found: false as const };
      const values = toDto(ctx.db, doc, viewer).values;
      return {
        ...pick,
        found: true as const,
        name: doc.name,
        nameRu: doc.nameRu,
        hitDie: typeof values.hit_die === 'number' ? values.hit_die : null,
        saves: text(values.class_saves),
        armor: text(values.class_armor),
        weapons: text(values.class_weapons),
        tools: text(values.class_tools),
        skills: text(values.class_skills),
        subclassTitle: text(values.subclass_title),
        subclasses: Array.isArray(values.subclasses) ? (values.subclasses as string[]) : [],
        tableRow: tableRowFor(values.table, pick.level),
        features: features
          .filter(
            (f) =>
              sameText(f.info.class, doc.name) &&
              (f.info.tier ?? 1) <= pick.level &&
              (f.info.subclass === null || sameText(f.info.subclass, pick.subclass)),
          )
          .sort((a, b) => (a.info.tier ?? 1) - (b.info.tier ?? 1) || a.name.localeCompare(b.name)),
      };
    });
  }),

  /**
   * Brings a class file into the system: the class becomes a rules document, its features become
   * features of the library. A class or feature that already exists under the same name is updated,
   * not doubled. With `dryRun` nothing is written: the answer is what the review screen shows.
   */
  importClass: authedProcedure
    .input(z.object({ systemId: z.string(), data: z.unknown(), dryRun: z.boolean(), skip: z.array(z.string()).default([]) }))
    .mutation(({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      const parsed = classFile.safeParse(input.data);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a class file: ${issue?.path.join('.') || 'file'}: ${issue?.message}` });
      }
      const data = parsed.data;
      const all = ctx.db.select().from(entities).where(and(eq(entities.systemId, input.systemId), isNull(entities.deletedAt))).all();
      const oldRule = all.find((e) => e.typeKey === 'rule' && sameText(e.name, data.name));
      const oldFeature = (f: { name: string }) => all.find((e) => e.typeKey === 'feature' && sameText(e.name, f.name) && sameText(e.values.class, data.name));
      const review = {
        name: data.name,
        status: oldRule ? ('update' as const) : ('new' as const),
        hitDie: data.hitDie,
        saves: data.saves.map((s) => s.toUpperCase()).join(', '),
        tableLevels: data.table?.rows.length ?? 0,
        subclasses: data.subclasses,
        features: data.features.map((f) => ({
          key: featureKey(f),
          name: f.name,
          level: f.level,
          subclass: f.subclass,
          status: oldFeature(f) ? ('update' as const) : ('new' as const),
        })),
      };
      if (input.dryRun) return { ...review, ruleId: null as string | null };

      const now = Date.now();
      const skip = new Set(input.skip);
      /** Values checked against the schema of the type, exactly as if typed into the sheet. */
      const clean = (typeKey: string, modules: string[], values: Record<string, unknown>) => {
        const schema = effectiveSchema(typeKey, modules)!;
        const out: Record<string, unknown> = {};
        for (const [key, raw] of Object.entries(values)) {
          const empty = raw === null || raw === '' || (Array.isArray(raw) && !raw.length);
          const value = empty ? null : checkValue(findField(schema, key)!, raw);
          if (value !== null) out[key] = value;
        }
        return out;
      };
      const ruleValues = clean('rule', [CLASS_MODULE], {
        body: data.body,
        table: data.table,
        hit_die: data.hitDie,
        class_saves: data.saves.map((s) => s.toUpperCase()).join(', '),
        class_armor: data.armor,
        class_weapons: data.weapons,
        class_tools: data.tools,
        class_skills: data.skills,
        subclass_title: data.subclassTitle,
        subclasses: data.subclasses,
      });
      let ruleId = oldRule?.id ?? nanoid();
      ctx.db.transaction((tx) => {
        const upsert = (old: EntityRow | undefined, id: string, typeKey: string, name: string, nameRu: string | null, modules: string[], values: Record<string, unknown>) => {
          if (old) {
            for (const [key, value] of Object.entries(values)) writeField(tx, old.id, key, value, ctx.user.id);
            const withModules = [...new Set([...old.modules, ...modules])];
            if (withModules.length !== old.modules.length) {
              tx.update(entities).set({ modules: withModules, updatedAt: now }).where(eq(entities.id, old.id)).run();
              logChange(tx, old, ctx.user.id, 'modules', null, old.modules, withModules);
            }
            return;
          }
          const row = {
            id,
            systemId: input.systemId,
            typeKey,
            name,
            nameRu,
            ownerId: null,
            campaignIds: [],
            visibility: EVERYONE,
            fieldVisibility: {},
            modules,
            customSchema: [],
            values,
            createdAt: now,
            updatedAt: now,
          };
          tx.insert(entities).values(row).run();
          logChange(tx, row, ctx.user.id, 'create', null, null, { name, typeKey, source: 'Class file' });
        };
        upsert(oldRule, ruleId, 'rule', data.name, data.nameRu, [CLASS_MODULE], ruleValues);
        for (const f of data.features) {
          if (skip.has(featureKey(f))) continue;
          const values = clean('feature', [], {
            ftype: CLASS_FEATURE,
            class: data.name,
            subclass: f.subclass,
            tier: f.level,
            action: f.action,
            summary: f.summary,
            description: f.description,
          });
          upsert(oldFeature(f), nanoid(), 'feature', f.name, f.nameRu, [], values);
        }
      });
      return { ...review, ruleId: ruleId as string | null };
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
    // What a character has is not part of its outside view.
    if (closedTo(viewer, row)) return [];
    const rows = ctx.db
      .select()
      .from(links)
      .where(or(eq(links.fromId, row.id), eq(links.toId, row.id)))
      .all();
    const out = [];
    for (const l of rows) {
      const otherId = l.fromId === row.id ? l.toId : l.fromId;
      const other = ctx.db.select().from(entities).where(and(eq(entities.id, otherId), isNull(entities.deletedAt))).get();
      if (!other || !canSeeEntity(viewer, other) || closedTo(viewer, other)) continue;
      out.push({
        id: l.id,
        kind: l.kind,
        direction: l.fromId === row.id ? ('out' as const) : ('in' as const),
        data: l.data,
        other: { id: other.id, name: other.name, nameRu: other.nameRu, typeKey: other.typeKey, info: linkInfo(toDto(ctx.db, other, viewer).values) },
      });
    }
    return out;
  }),
});

/** The few values shown next to a linked entity in a list: only ones the viewer may see arrive here. */
function linkInfo(values: Record<string, unknown>) {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const number = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    kind: text(values.kind),
    ftype: text(values.ftype),
    class: text(values.class),
    subclass: text(values.subclass),
    tier: number(values.tier),
    circle: number(values.circle),
    action: text(values.action),
  };
}

/**
 * The card of a character in the character list: the main portrait, the allegiance, the tags, and
 * the values of the card fields the DM chose for the System. It is built from the values the viewer
 * may see, so a closed field is simply absent. Owner and campaign travel with every list row already.
 */
function cardsOf(db: DB, systemId: string, viewer: Viewer) {
  const chosen = new Set<string>(cardFieldsOf(db, systemId));
  const classNames = new Map<string, string | null>();
  const className = (classId: string) => {
    if (!classNames.has(classId)) classNames.set(classId, classOf(db, viewer, systemId, classId)?.name ?? null);
    return classNames.get(classId)!;
  };
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const options = new Map(allFields(getSchema('character')!).map((f) => [f.id, f.options ?? []]));
  const option = (fieldId: string, v: unknown) => options.get(fieldId)?.find((o) => o.value === v)?.label ?? null;
  const read: Partial<Record<CardFieldKey, (seen: Record<string, unknown>) => string | number | null>> = {
    race: (seen) => text(seen.race),
    // The classes taken from the rules, with their levels; the typed-in class where none is chosen.
    class: (seen) =>
      picksOf(seen.classes)
        .map((p) => ({ name: className(p.classId), level: p.level }))
        .filter((c) => c.name)
        .map((c) => `${c.name} ${c.level}`)
        .join(' / ') || text(seen.class),
    level: (seen) => (typeof seen.level === 'number' ? seen.level : null),
    kind: (seen) => option('kind', seen.kind),
    status: (seen) => option('status', seen.status),
    disposition: (seen) => text(seen.disposition),
  };
  return (seen: Record<string, unknown>) => {
    const values: Partial<Record<CardFieldKey, string | number | null>> = {};
    for (const { key } of CARD_FIELDS) if (chosen.has(key) && read[key]) values[key] = read[key](seen);
    return {
      portrait: text(seen.portrait),
      allegiance: text(seen.faction),
      tags: Array.isArray(seen.tags) ? (seen.tags as string[]) : [],
      values,
    };
  };
}

/** The card fields the DM chose for a System, in the order of the list of possible ones. */
export function cardFieldsOf(db: DB, systemId: string): CardFieldKey[] {
  const chosen = db.select({ settings: systems.settings }).from(systems).where(eq(systems.id, systemId)).get()?.settings.cardFields ?? [];
  return CARD_FIELDS.map((f) => f.key).filter((key) => chosen.includes(key));
}

/**
 * For a library entity, the ids of the characters linked to it that the viewer may see.
 * A player is told only about their own characters: what another player's character has is closed.
 * The links of the system are read once, on first use.
 */
function holdersOf(db: DB, systemId: string, viewer: Viewer) {
  let byTarget: Map<string, string[]> | null = null;
  return (entityId: string): string[] => {
    if (!byTarget) {
      byTarget = new Map();
      const visible = new Set(
        db
          .select()
          .from(entities)
          .where(and(eq(entities.systemId, systemId), eq(entities.typeKey, 'character'), isNull(entities.deletedAt)))
          .all()
          .filter((c) => canSeeEntity(viewer, c) && !closedTo(viewer, c))
          .map((c) => c.id),
      );
      for (const l of db.select().from(links).where(eq(links.systemId, systemId)).all())
        if (visible.has(l.fromId) && HOLDING_KINDS.has(l.kind)) byTarget.set(l.toId, [...(byTarget.get(l.toId) ?? []), l.fromId]);
    }
    return byTarget.get(entityId) ?? [];
  };
}
const HOLDING_KINDS = new Set(Object.values(LINK_KIND));

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

/**
 * What a user may do with one field of one entity. Null when the entity or the field
 * does not exist for them. Used by the file routes, which live outside tRPC.
 */
export function fieldAccess(db: DB, userId: string, entityId: string, fieldId: string) {
  try {
    const { row, viewer } = loadVisible(db, userId, entityId);
    const dto = toDto(db, row, viewer);
    const field = allFields(dto.schema as EntitySchema).find((f) => f.id === fieldId);
    if (!field) return null;
    return { row, field, canEdit: dto.editableFields.includes(fieldId) };
  } catch {
    return null;
  }
}

/**
 * Whether a user may load an uploaded picture: only while a field they may see holds it.
 * A picture that was replaced or taken out of its gallery is no longer served.
 */
export function canSeeFile(db: DB, userId: string, file: { id: string; entityId: string }): boolean {
  try {
    const { row, viewer } = loadVisible(db, userId, file.entityId);
    const dto = toDto(db, row, viewer);
    return allFields(dto.schema).some((f) =>
      f.type === 'image' ? dto.values[f.id] === file.id : f.type === 'gallery' && ((dto.values[f.id] as string[] | undefined) ?? []).includes(file.id),
    );
  } catch {
    return false;
  }
}

/** A gallery the caller may change, with the picture that the call names. */
function editableGallery(db: DB, userId: string, input: { id: string; fieldId: string; fileId: string }) {
  const { row, viewer } = loadVisible(db, userId, input.id);
  const editable = toDto(db, row, viewer).editableFields;
  // A field the caller cannot see answers exactly like a field that does not exist.
  if (!editable.includes(input.fieldId)) throw new TRPCError({ code: 'FORBIDDEN' });
  const field = findField(schemaOf(row), input.fieldId)!;
  if (field.type !== 'gallery') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a gallery' });
  if (!galleryOf(field, row.values).includes(input.fileId)) throw new TRPCError({ code: 'NOT_FOUND' });
  return { row, field, editable };
}

/**
 * Records an uploaded picture and puts it into its field, as logged changes.
 * A gallery gets it as its last picture, and as its main picture when it has none.
 * A picture uploaded straight into the main field of a gallery joins that gallery too.
 */
export function attachImage(db: DB, row: EntityRow, fieldId: string, userId: string, file: { id: string; mime: string; size: number }) {
  const fields = allFields(schemaOf(row));
  const field = fields.find((f) => f.id === fieldId)!;
  const gallery = field.type === 'gallery' ? field : fields.find((f) => f.type === 'gallery' && f.main === field.id);
  db.transaction((tx) => {
    tx.insert(files)
      .values({ ...file, systemId: row.systemId, entityId: row.id, fieldId, createdBy: userId, createdAt: Date.now() })
      .run();
    const values = loadEntity(tx, row.id).values;
    if (gallery) writeField(tx, row.id, gallery.id, [...galleryOf(gallery, values), file.id].slice(-GALLERY_MAX), userId);
    if (field.type === 'image') writeField(tx, row.id, field.id, file.id, userId);
    else if (field.main && typeof values[field.main] !== 'string') writeField(tx, row.id, field.main, file.id, userId);
  });
}

function isDmOnly(row: EntityRow): boolean {
  return !row.ownerId && !row.visibility.all && !row.visibility.players.length && !row.visibility.parties.length;
}
