import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { destroyUserSessions, hashPassword, newToken } from '../auth';
import type { DB } from '../db';
import { IMAGE_TYPES } from '../images';
import {
  campaignMembers,
  campaigns,
  changes,
  entities,
  files,
  invites,
  links,
  members,
  parties,
  partyMembers,
  requestMessages,
  requests,
  systems,
  translations,
  users,
} from '../db/schema';
import { CARD_FIELDS } from '../schemas/character';
import { assertKnownVersion, migrateSystem } from '../schemas/migrate';
import { currentSchemaVersion } from '../schemas/versions';
import { authedProcedure, requireDm, router, viewerFor } from '../trpc';
import { cleanHtml } from '../richtext';
import { cardFieldsOf } from './entity';

const INVITE_DAYS = 14;
const EXPORT_FORMAT = 'anybrew-cm-export';
const EXPORT_VERSION = 2;

const systemId = z.string();
const systemName = z.string().trim().min(1).max(80);
const groupName = z.string().trim().min(1).max(60);

type Reader = Pick<DB, 'select'>;

function campaignIn(db: Reader, sysId: string, campaignId: string) {
  const row = db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.systemId, sysId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const systemRouter = router({
  list: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: systems.id, name: systems.name, role: members.role })
      .from(members)
      .innerJoin(systems, eq(systems.id, members.systemId))
      .where(eq(members.userId, ctx.user.id))
      .orderBy(systems.createdAt)
      .all(),
  ),

  /** A new, empty rule system. Only someone who already runs a system may create another. */
  create: authedProcedure.input(z.object({ name: systemName })).mutation(({ ctx, input }) => {
    const runsOne = ctx.db
      .select({ systemId: members.systemId })
      .from(members)
      .where(and(eq(members.userId, ctx.user.id), eq(members.role, 'dm')))
      .get();
    if (!runsOne) throw new TRPCError({ code: 'FORBIDDEN' });
    const id = nanoid();
    ctx.db.transaction((tx) => {
      tx.insert(systems).values({ id, name: input.name, schemaVersion: currentSchemaVersion(), createdAt: Date.now() }).run();
      tx.insert(members).values({ systemId: id, userId: ctx.user.id, role: 'dm' }).run();
    });
    return { systemId: id };
  }),

  get: authedProcedure.input(z.object({ systemId })).query(({ ctx, input }) => {
    const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
    const isDm = viewer.role === 'dm';
    const system = ctx.db.select().from(systems).where(eq(systems.id, input.systemId)).get()!;
    const memberRows = ctx.db
      .select({ userId: users.id, displayName: users.displayName, username: users.username, role: members.role })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.systemId, input.systemId))
      .all();

    // A player is told only about their own campaigns, the parties in them and the people they share them with.
    const campaignList = loadCampaigns(ctx.db, input.systemId).filter((c) => isDm || viewer.campaignIds.includes(c.id));
    const partyList = loadParties(ctx.db, input.systemId).filter((p) => isDm || viewer.campaignIds.includes(p.campaignId));
    const known = new Set<string>([viewer.userId, ...campaignList.flatMap((c) => c.memberIds)]);

    return {
      id: system.id,
      name: system.name,
      role: viewer.role,
      members: memberRows
        .filter((m) => isDm || m.role === 'dm' || known.has(m.userId))
        .map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          role: m.role,
          // Login names are shown to the DM only.
          username: isDm ? m.username : undefined,
        })),
      campaigns: campaignList,
      parties: partyList,
      // What the DM chose to show on the cards of the character list, and what there is to choose from.
      cardFields: cardFieldsOf(ctx.db, input.systemId),
      cardFieldOptions: CARD_FIELDS.map((f) => ({ key: f.key, label: f.label })),
    };
  }),

  /** The fields shown on every character card, beyond portrait, name and allegiance. One choice for everyone. */
  setCardFields: authedProcedure
    .input(z.object({ systemId, fields: z.array(z.enum(CARD_FIELDS.map((f) => f.key))) }))
    .mutation(({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      const system = ctx.db.select().from(systems).where(eq(systems.id, input.systemId)).get()!;
      const cardFields = CARD_FIELDS.map((f) => f.key).filter((key) => input.fields.includes(key));
      ctx.db.update(systems).set({ settings: { ...system.settings, cardFields } }).where(eq(systems.id, system.id)).run();
      return { ok: true };
    }),

  rename: authedProcedure.input(z.object({ systemId, name: systemName })).mutation(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    ctx.db.update(systems).set({ name: input.name }).where(eq(systems.id, input.systemId)).run();
    return { ok: true };
  }),

  // ---- Invites ----

  createInvite: authedProcedure
    .input(z.object({ systemId, role: z.enum(['dm', 'player']), campaignId: z.string().nullish() }))
    .mutation(({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      // A DM sees every campaign anyway, so only a player invite carries one.
      const campaignId = input.role === 'player' && input.campaignId ? campaignIn(ctx.db, input.systemId, input.campaignId).id : null;
      const token = newToken();
      const now = Date.now();
      ctx.db
        .insert(invites)
        .values({
          token,
          systemId: input.systemId,
          role: input.role,
          campaignId,
          createdBy: ctx.user.id,
          createdAt: now,
          expiresAt: now + INVITE_DAYS * 24 * 60 * 60 * 1000,
        })
        .run();
      return { token };
    }),

  listInvites: authedProcedure.input(z.object({ systemId })).query(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    return ctx.db
      .select({ token: invites.token, role: invites.role, campaignId: invites.campaignId, expiresAt: invites.expiresAt })
      .from(invites)
      .where(and(eq(invites.systemId, input.systemId), isNull(invites.usedBy)))
      .all()
      .filter((i) => i.expiresAt > Date.now());
  }),

  revokeInvite: authedProcedure.input(z.object({ systemId, token: z.string() })).mutation(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    ctx.db
      .delete(invites)
      .where(and(eq(invites.token, input.token), eq(invites.systemId, input.systemId)))
      .run();
    return { ok: true };
  }),

  // ---- Members ----

  removeMember: authedProcedure.input(z.object({ systemId, userId: z.string() })).mutation(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    if (input.userId === ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot remove yourself' });
    ctx.db.transaction((tx) => {
      const partyIds = tx.select({ id: parties.id }).from(parties).where(eq(parties.systemId, input.systemId)).all();
      if (partyIds.length)
        tx.delete(partyMembers)
          .where(and(eq(partyMembers.userId, input.userId), inArray(partyMembers.partyId, partyIds.map((p) => p.id))))
          .run();
      const campaignIds = tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.systemId, input.systemId)).all();
      if (campaignIds.length)
        tx.delete(campaignMembers)
          .where(and(eq(campaignMembers.userId, input.userId), inArray(campaignMembers.campaignId, campaignIds.map((c) => c.id))))
          .run();
      tx.delete(members)
        .where(and(eq(members.systemId, input.systemId), eq(members.userId, input.userId)))
        .run();
    });
    return { ok: true };
  }),

  /** The DM sets a new password for a player who forgot theirs. */
  resetPassword: authedProcedure
    .input(z.object({ systemId, userId: z.string(), newPassword: z.string().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      const target = ctx.db
        .select()
        .from(members)
        .where(and(eq(members.systemId, input.systemId), eq(members.userId, input.userId)))
        .get();
      // Never another DM: a DM changes their own password themselves.
      if (!target || target.role !== 'player') throw new TRPCError({ code: 'FORBIDDEN' });
      const passwordHash = await hashPassword(input.newPassword);
      ctx.db.update(users).set({ passwordHash }).where(eq(users.id, input.userId)).run();
      destroyUserSessions(ctx.db, input.userId);
      return { ok: true };
    }),

  // ---- Campaigns ----

  createCampaign: authedProcedure.input(z.object({ systemId, name: groupName })).mutation(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    const id = nanoid();
    ctx.db.insert(campaigns).values({ id, systemId: input.systemId, name: input.name, createdAt: Date.now() }).run();
    return { id };
  }),

  updateCampaign: authedProcedure
    .input(z.object({ systemId, campaignId: z.string(), name: groupName.optional(), memberIds: z.array(z.string()).optional() }))
    .mutation(({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      ctx.db.transaction((tx) => {
        const campaign = campaignIn(tx, input.systemId, input.campaignId);
        if (input.name) tx.update(campaigns).set({ name: input.name }).where(eq(campaigns.id, campaign.id)).run();
        if (input.memberIds) {
          const systemMembers = new Set(
            tx.select({ userId: members.userId }).from(members).where(eq(members.systemId, input.systemId)).all().map((m) => m.userId),
          );
          const next = [...new Set(input.memberIds)].filter((u) => systemMembers.has(u));
          tx.delete(campaignMembers).where(eq(campaignMembers.campaignId, campaign.id)).run();
          for (const userId of next) tx.insert(campaignMembers).values({ campaignId: campaign.id, userId }).run();
          // Someone who left the campaign also leaves its parties.
          const partyIds = tx.select({ id: parties.id }).from(parties).where(eq(parties.campaignId, campaign.id)).all().map((p) => p.id);
          if (partyIds.length)
            for (const row of tx.select().from(partyMembers).where(inArray(partyMembers.partyId, partyIds)).all())
              if (!next.includes(row.userId))
                tx.delete(partyMembers)
                  .where(and(eq(partyMembers.partyId, row.partyId), eq(partyMembers.userId, row.userId)))
                  .run();
        }
      });
      return { ok: true };
    }),

  /**
   * Refused while any content is tagged with the campaign: dropping the tag would open
   * that content to players of other campaigns.
   */
  deleteCampaign: authedProcedure.input(z.object({ systemId, campaignId: z.string() })).mutation(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    const campaign = campaignIn(ctx.db, input.systemId, input.campaignId);
    const tagged = ctx.db
      .select({ campaignIds: entities.campaignIds })
      .from(entities)
      .where(eq(entities.systemId, input.systemId))
      .all()
      .filter((e) => e.campaignIds.includes(campaign.id)).length;
    if (tagged)
      throw new TRPCError({
        code: 'CONFLICT',
        message: `${tagged} item(s) still belong to this campaign, including deleted ones. Move or untag them first.`,
      });
    ctx.db.delete(campaigns).where(eq(campaigns.id, campaign.id)).run();
    return { ok: true };
  }),

  // ---- Parties ----

  createParty: authedProcedure
    .input(z.object({ systemId, campaignId: z.string(), name: groupName }))
    .mutation(({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      const campaign = campaignIn(ctx.db, input.systemId, input.campaignId);
      const id = nanoid();
      ctx.db.insert(parties).values({ id, systemId: input.systemId, campaignId: campaign.id, name: input.name }).run();
      return { id };
    }),

  updateParty: authedProcedure
    .input(z.object({ systemId, partyId: z.string(), name: groupName.optional(), memberIds: z.array(z.string()).optional() }))
    .mutation(({ ctx, input }) => {
      requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
      ctx.db.transaction((tx) => {
        const party = tx
          .select()
          .from(parties)
          .where(and(eq(parties.id, input.partyId), eq(parties.systemId, input.systemId)))
          .get();
        if (!party) throw new TRPCError({ code: 'NOT_FOUND' });
        if (input.name) tx.update(parties).set({ name: input.name }).where(eq(parties.id, party.id)).run();
        if (input.memberIds) {
          // Only players of the party's campaign can be in it.
          const allowed = new Set(
            tx
              .select({ userId: campaignMembers.userId })
              .from(campaignMembers)
              .where(eq(campaignMembers.campaignId, party.campaignId))
              .all()
              .map((m) => m.userId),
          );
          tx.delete(partyMembers).where(eq(partyMembers.partyId, party.id)).run();
          for (const userId of new Set(input.memberIds))
            if (allowed.has(userId)) tx.insert(partyMembers).values({ partyId: party.id, userId }).run();
        }
      });
      return { ok: true };
    }),

  deleteParty: authedProcedure.input(z.object({ systemId, partyId: z.string() })).mutation(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    ctx.db
      .delete(parties)
      .where(and(eq(parties.id, input.partyId), eq(parties.systemId, input.systemId)))
      .run();
    return { ok: true };
  }),

  // ---- Export and import ----

  /** Everything in the system as one JSON document. DM only. */
  export: authedProcedure.input(z.object({ systemId })).query(({ ctx, input }) => {
    requireDm(viewerFor(ctx.db, ctx.user.id, input.systemId));
    return buildExport(ctx.db, input.systemId);
  }),

  /** Creates a new system from an export. The caller becomes its DM. */
  import: authedProcedure.input(z.object({ data: z.unknown() })).mutation(({ ctx, input }) => {
    const parsed = exportSchema.safeParse(input.data);
    if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This is not a system export file' });
    return { systemId: importSystem(ctx.db, parsed.data, ctx.user.id) };
  }),
});

function loadCampaigns(db: DB, sysId: string) {
  const rows = db.select().from(campaigns).where(eq(campaigns.systemId, sysId)).orderBy(campaigns.createdAt).all();
  if (!rows.length) return [];
  const memberRows = db
    .select()
    .from(campaignMembers)
    .where(inArray(campaignMembers.campaignId, rows.map((c) => c.id)))
    .all();
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    memberIds: memberRows.filter((m) => m.campaignId === c.id).map((m) => m.userId),
  }));
}

function loadParties(db: DB, sysId: string) {
  const rows = db.select().from(parties).where(eq(parties.systemId, sysId)).all();
  if (!rows.length) return [];
  const memberRows = db
    .select()
    .from(partyMembers)
    .where(inArray(partyMembers.partyId, rows.map((p) => p.id)))
    .all();
  return rows.map((p) => ({
    id: p.id,
    campaignId: p.campaignId,
    name: p.name,
    memberIds: memberRows.filter((m) => m.partyId === p.id).map((m) => m.userId),
  }));
}

const audience = z.object({ all: z.boolean(), players: z.array(z.string()), parties: z.array(z.string()) });

export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  // The version of the schemas the data fits (schemas/versions.ts). Files from before versioning are at 0.
  schemaVersion: z.number().int().min(0).default(0),
  // Settings arrived after the first exports were made, so a file without them still imports.
  system: z.object({ id: z.string(), name: z.string(), createdAt: z.number(), settings: z.object({ cardFields: z.array(z.string()).optional() }).default({}) }),
  members: z.array(z.object({ userId: z.string(), username: z.string(), displayName: z.string(), role: z.enum(['dm', 'player']) })),
  campaigns: z.array(z.object({ id: z.string(), name: z.string(), memberIds: z.array(z.string()) })),
  parties: z.array(z.object({ id: z.string(), campaignId: z.string(), name: z.string(), memberIds: z.array(z.string()) })),
  entities: z.array(
    z.object({
      id: z.string(),
      typeKey: z.string(),
      name: z.string(),
      ownerId: z.string().nullable(),
      campaignIds: z.array(z.string()),
      modules: z.array(z.string()).default([]),
      nameRu: z.string().nullable().default(null),
      customSchema: z.array(z.any()).default([]),
      visibility: audience,
      fieldVisibility: z.record(z.string(), audience),
      values: z.record(z.string(), z.unknown()),
      createdAt: z.number(),
      updatedAt: z.number(),
      deletedAt: z.number().nullable(),
    }),
  ),
  links: z.array(
    z.object({
      id: z.string(),
      fromId: z.string(),
      kind: z.string(),
      toId: z.string(),
      data: z.record(z.string(), z.unknown()),
      createdAt: z.number(),
    }),
  ),
  translations: z
    .array(
      z.object({
        entityId: z.string(),
        fieldId: z.string(),
        lang: z.enum(['en', 'ru']),
        text: z.string(),
        sourceSnapshot: z.string(),
        updatedBy: z.string(),
        updatedAt: z.number(),
      }),
    )
    .default([]),
  // The list of uploaded pictures. Their bytes travel only in the ZIP export (see archive.ts);
  // a plain JSON export lists them too, but its import has no bytes and leaves them out.
  files: z
    .array(
      z.object({
        id: z.string(),
        entityId: z.string(),
        fieldId: z.string(),
        mime: z.string(),
        size: z.number(),
        createdBy: z.string(),
        createdAt: z.number(),
      }),
    )
    .default([]),
  // Player Requests arrived after the first exports were made, so a file without them still imports.
  requests: z
    .array(
      z.object({
        id: z.string(),
        playerId: z.string(),
        subject: z.string(),
        status: z.enum(['open', 'resolved']),
        createdBy: z.string(),
        createdAt: z.number(),
        updatedAt: z.number(),
        resolvedAt: z.number().nullable(),
        messages: z.array(z.object({ id: z.string(), authorId: z.string(), body: z.string(), createdAt: z.number() })),
      }),
    )
    .default([]),
  changes: z.array(
    z.object({
      entityId: z.string(),
      target: z.string(),
      key: z.string().nullable(),
      oldValue: z.unknown(),
      newValue: z.unknown(),
      userId: z.string(),
      at: z.number(),
    }),
  ),
});

export type SystemExport = z.infer<typeof exportSchema>;

export function buildExport(db: DB, id: string): SystemExport {
  const system = db.select().from(systems).where(eq(systems.id, id)).get()!;
  const strip = <T extends { systemId: string }>({ systemId: _c, ...rest }: T) => rest;
  const entityRows = db.select().from(entities).where(eq(entities.systemId, id)).all();
  const requestRows = db.select().from(requests).where(eq(requests.systemId, id)).orderBy(requests.createdAt).all();
  const messageRows = requestRows.length
    ? db
        .select()
        .from(requestMessages)
        .where(inArray(requestMessages.requestId, requestRows.map((r) => r.id)))
        .orderBy(requestMessages.createdAt, sql`rowid`)
        .all()
    : [];
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: system.schemaVersion,
    system,
    members: db
      .select({ userId: users.id, username: users.username, displayName: users.displayName, role: members.role })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.systemId, id))
      .all(),
    campaigns: loadCampaigns(db, id),
    parties: loadParties(db, id),
    entities: entityRows.map(strip),
    links: db.select().from(links).where(eq(links.systemId, id)).all().map(strip),
    translations: entityRows.length
      ? db.select().from(translations).where(inArray(translations.entityId, entityRows.map((e) => e.id))).all()
      : [],
    files: db.select().from(files).where(eq(files.systemId, id)).orderBy(files.createdAt).all().map(strip),
    requests: requestRows.map((r) => ({
      ...strip(r),
      messages: messageRows.filter((m) => m.requestId === r.id).map(({ requestId: _r, ...rest }) => rest),
    })),
    changes: db
      .select()
      .from(changes)
      .where(eq(changes.systemId, id))
      .orderBy(changes.id)
      .all()
      .map(({ id: _id, systemId: _c, ...rest }) => rest),
  };
}

/**
 * Imports into a brand-new system. Every system, campaign, party, entity, link, request and message id is replaced
 * with a fresh one across the whole document, so references inside values stay consistent
 * and nothing collides with the system the export came from.
 *
 * Pictures come in only when their bytes are given (from a ZIP export): each is written to the
 * uploads folder under its new id. A picture without bytes, or of a type we do not accept, is left
 * out, and a field that held it shows an empty frame.
 */
export function importSystem(
  db: DB,
  source: SystemExport,
  importerId: string,
  pictures?: { dir: string; bytes: Map<string, Uint8Array> },
): string {
  // A file from a newer version of the app holds data this version has no schemas for.
  try {
    assertKnownVersion(source.schemaVersion, 'This export');
  } catch (e) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message });
  }
  const picturesIn = source.files.filter((f) => IMAGE_TYPES[f.mime] && pictures?.bytes.has(f.id));
  const oldIds = [
    source.system.id,
    ...source.campaigns.map((c) => c.id),
    ...source.parties.map((p) => p.id),
    ...source.entities.map((e) => e.id),
    ...source.links.map((l) => l.id),
    ...source.requests.flatMap((r) => [r.id, ...r.messages.map((m) => m.id)]),
    ...picturesIn.map((f) => f.id),
  ];
  const newIds = new Map(oldIds.map((oldId) => [oldId, nanoid()]));
  let text = JSON.stringify(source);
  for (const [oldId, newId] of newIds) text = text.split(JSON.stringify(oldId)).join(JSON.stringify(newId));
  const data = JSON.parse(text) as SystemExport;
  const newSystemId = data.system.id;

  // The bytes are written first and taken away again if the database part fails.
  const written: string[] = [];
  const fileRows = picturesIn.map((f) => {
    const id = newIds.get(f.id)!;
    const bytes = pictures!.bytes.get(f.id)!;
    const target = path.join(pictures!.dir, `${id}.${IMAGE_TYPES[f.mime]}`);
    fs.mkdirSync(pictures!.dir, { recursive: true });
    fs.writeFileSync(target, bytes);
    written.push(target);
    return {
      ...f,
      id,
      systemId: newSystemId,
      entityId: newIds.get(f.entityId) ?? f.entityId,
      size: bytes.length,
    };
  });

  try {
    insertImport(db, data, importerId, fileRows);
  } catch (e) {
    for (const f of written) fs.rmSync(f, { force: true });
    throw e;
  }
  return newSystemId;
}

function insertImport(db: DB, data: SystemExport, importerId: string, fileRows: (typeof files.$inferInsert)[]) {
  const newSystemId = data.system.id;
  db.transaction((tx) => {
    const knownUsers = new Set(tx.select({ id: users.id }).from(users).all().map((u) => u.id));
    const nameTaken = tx.select({ id: systems.id }).from(systems).where(eq(systems.name, data.system.name)).get();
    tx.insert(systems)
      .values({
        id: newSystemId,
        name: nameTaken ? `${data.system.name} (imported)` : data.system.name,
        settings: { cardFields: data.system.settings.cardFields ?? [] },
        schemaVersion: data.schemaVersion,
        createdAt: Date.now(),
      })
      .run();

    tx.insert(members).values({ systemId: newSystemId, userId: importerId, role: 'dm' }).run();
    for (const m of data.members)
      if (m.userId !== importerId && knownUsers.has(m.userId))
        tx.insert(members).values({ systemId: newSystemId, userId: m.userId, role: m.role }).run();

    for (const c of data.campaigns) {
      tx.insert(campaigns).values({ id: c.id, systemId: newSystemId, name: c.name, createdAt: Date.now() }).run();
      for (const userId of c.memberIds)
        if (knownUsers.has(userId)) tx.insert(campaignMembers).values({ campaignId: c.id, userId }).run();
    }
    for (const p of data.parties) {
      tx.insert(parties).values({ id: p.id, systemId: newSystemId, campaignId: p.campaignId, name: p.name }).run();
      for (const userId of p.memberIds)
        if (knownUsers.has(userId)) tx.insert(partyMembers).values({ partyId: p.id, userId }).run();
    }
    for (const e of data.entities)
      tx.insert(entities)
        .values({ ...e, systemId: newSystemId, ownerId: e.ownerId && knownUsers.has(e.ownerId) ? e.ownerId : null })
        .run();
    for (const l of data.links) tx.insert(links).values({ ...l, systemId: newSystemId }).run();
    for (const t of data.translations) tx.insert(translations).values(t).run();
    for (const c of data.changes)
      tx.insert(changes)
        .values({ ...c, target: c.target as (typeof changes.$inferInsert)['target'], systemId: newSystemId })
        .run();
    for (const f of fileRows) tx.insert(files).values(f).run();
    // The file may be older than the schemas in the code: its data is brought up to date like any System.
    migrateSystem(tx, newSystemId, data.schemaVersion);

    // A request belongs to a player's account. It comes in when that account exists on this server
    // and is not a DM of the new System (the importer is one); otherwise it is left out, like the membership.
    const dms = new Set(tx.select().from(members).where(and(eq(members.systemId, newSystemId), eq(members.role, 'dm'))).all().map((m) => m.userId));
    for (const { messages, ...r } of data.requests) {
      if (!knownUsers.has(r.playerId) || dms.has(r.playerId)) continue;
      tx.insert(requests).values({ ...r, systemId: newSystemId }).run();
      // Cleaned again: an export file can be edited by hand, and message text is shown as it is stored.
      for (const m of messages) tx.insert(requestMessages).values({ ...m, requestId: r.id, body: cleanHtml(m.body) }).run();
    }
  });
}
