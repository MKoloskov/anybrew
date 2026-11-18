import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DB } from '../db';
import { members, requestMessages, requests, users } from '../db/schema';
import { cleanHtml, htmlToText } from '../richtext';
import { authedProcedure, requireDm, router, viewerFor } from '../trpc';
import type { Viewer } from '../visibility';

// Player Requests (PLAN.md 10.4): a thread between one player and the DMs of a System.
// A player receives only their own requests; a DM receives all of them. Anything else answers
// "not found", the same as a request that does not exist.

const subject = z.string().trim().min(1).max(120);
/** Largest message, counted on the HTML as it arrives. */
const MAX_BODY = 50_000;
const body = z.string().max(MAX_BODY);

type RequestRow = typeof requests.$inferSelect;

/** The cleaned message text. A message with nothing written in it is refused. */
function cleanBody(html: string): string {
  const cleaned = cleanHtml(html);
  if (!htmlToText(cleaned)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Write a message first' });
  return cleaned;
}

/** The request and the caller's standing in its System, or NOT_FOUND when the caller may not see it. */
function requestFor(db: DB, userId: string, id: string): { row: RequestRow; viewer: Viewer } {
  const row = db.select().from(requests).where(eq(requests.id, id)).get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  const viewer = viewerFor(db, userId, row.systemId);
  if (viewer.role !== 'dm' && row.playerId !== userId) throw new TRPCError({ code: 'NOT_FOUND' });
  return { row, viewer };
}

function messagesOf(db: Pick<DB, 'select'>, requestIds: string[]) {
  if (!requestIds.length) return [];
  return db
    .select()
    .from(requestMessages)
    .where(inArray(requestMessages.requestId, requestIds))
    .orderBy(requestMessages.createdAt, sql`rowid`)
    .all();
}

/** Display names of accounts, also of people who have left the System. */
function namesOf(db: DB, userIds: string[]): Map<string, string> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  return new Map(
    db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)).all().map((u) => [u.id, u.displayName]),
  );
}

function rolesIn(db: DB, systemId: string): Map<string, 'dm' | 'player'> {
  return new Map(db.select().from(members).where(eq(members.systemId, systemId)).all().map((m) => [m.userId, m.role]));
}

/**
 * The requests the viewer may see, each with whose turn it is.
 * A message written by anyone but the request's player counts as "from the DM".
 */
function visibleRequests(db: DB, viewer: Viewer, systemId: string) {
  const rows = db
    .select()
    .from(requests)
    .where(viewer.role === 'dm' ? eq(requests.systemId, systemId) : and(eq(requests.systemId, systemId), eq(requests.playerId, viewer.userId)))
    .all();
  const roles = rolesIn(db, systemId);
  const byRequest = new Map<string, (typeof requestMessages.$inferSelect)[]>();
  for (const m of messagesOf(db, rows.map((r) => r.id))) byRequest.set(m.requestId, [...(byRequest.get(m.requestId) ?? []), m]);
  return rows.map((row) => {
    const messages = byRequest.get(row.id) ?? [];
    const last = messages[messages.length - 1];
    const lastFrom: 'player' | 'dm' = last && last.authorId !== row.playerId ? 'dm' : 'player';
    const playerFormer = roles.get(row.playerId) !== 'player';
    const waiting =
      row.status === 'open' && (viewer.role === 'dm' ? lastFrom === 'player' && !playerFormer : lastFrom === 'dm');
    return { row, messages, lastFrom, playerFormer, waiting };
  });
}

export const requestRouter = router({
  /** Every request the caller may see, newest activity first. The browser files them into Open and Archive. */
  list: authedProcedure.input(z.object({ systemId: z.string() })).query(({ ctx, input }) => {
    const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
    const found = visibleRequests(ctx.db, viewer, input.systemId);
    const names = namesOf(ctx.db, found.map((f) => f.row.playerId));
    return found
      .map(({ row, messages, lastFrom, playerFormer, waiting }) => ({
        id: row.id,
        subject: row.subject,
        status: row.status,
        playerId: row.playerId,
        playerName: names.get(row.playerId) ?? 'Unknown',
        playerFormer,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messageCount: messages.length,
        lastFrom,
        /** Open, and the last message is from the other side. */
        waiting,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }),

  /** How many open requests wait for the caller: the number beside "Requests" in the navigation. */
  waiting: authedProcedure.input(z.object({ systemId: z.string() })).query(({ ctx, input }) => {
    const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
    return { count: visibleRequests(ctx.db, viewer, input.systemId).filter((f) => f.waiting).length };
  }),

  get: authedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const { row, viewer } = requestFor(ctx.db, ctx.user.id, input.id);
    const messages = messagesOf(ctx.db, [row.id]);
    const names = namesOf(ctx.db, [row.playerId, ...messages.map((m) => m.authorId)]);
    const roles = rolesIn(ctx.db, row.systemId);
    const isDm = viewer.role === 'dm';
    return {
      id: row.id,
      systemId: row.systemId,
      subject: row.subject,
      status: row.status,
      playerId: row.playerId,
      playerName: names.get(row.playerId) ?? 'Unknown',
      playerFormer: roles.get(row.playerId) !== 'player',
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      messages: messages.map((m) => ({
        id: m.id,
        authorId: m.authorId,
        authorName: names.get(m.authorId) ?? 'Unknown',
        from: m.authorId === row.playerId ? ('player' as const) : ('dm' as const),
        body: m.body,
        createdAt: m.createdAt,
      })),
      canReply: row.status === 'open',
      /** Only the DM resolves, reopens and deletes. */
      canManage: isDm,
    };
  }),

  /**
   * A new thread with its first message. A player starts their own;
   * a DM starts one addressed to a chosen player of the System.
   */
  create: authedProcedure
    .input(z.object({ systemId: z.string(), subject, body, playerId: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      const viewer = viewerFor(ctx.db, ctx.user.id, input.systemId);
      let playerId = ctx.user.id;
      if (viewer.role === 'dm') {
        if (!input.playerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose the player this is for' });
        if (rolesIn(ctx.db, input.systemId).get(input.playerId) !== 'player') throw new TRPCError({ code: 'NOT_FOUND' });
        playerId = input.playerId;
      } else if (input.playerId && input.playerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const text = cleanBody(input.body);
      const id = nanoid();
      const now = Date.now();
      ctx.db.transaction((tx) => {
        tx.insert(requests)
          .values({ id, systemId: input.systemId, playerId, subject: input.subject, status: 'open', createdBy: ctx.user.id, createdAt: now, updatedAt: now })
          .run();
        tx.insert(requestMessages).values({ id: nanoid(), requestId: id, authorId: ctx.user.id, body: text, createdAt: now }).run();
      });
      return { id };
    }),

  /** A further message, from the player or a DM, while the request is open. */
  reply: authedProcedure.input(z.object({ id: z.string(), body })).mutation(({ ctx, input }) => {
    const { row } = requestFor(ctx.db, ctx.user.id, input.id);
    if (row.status !== 'open')
      throw new TRPCError({ code: 'CONFLICT', message: 'This request is resolved. Only the DM can reopen it.' });
    const text = cleanBody(input.body);
    const now = Date.now();
    ctx.db.transaction((tx) => {
      tx.insert(requestMessages).values({ id: nanoid(), requestId: row.id, authorId: ctx.user.id, body: text, createdAt: now }).run();
      tx.update(requests).set({ updatedAt: now }).where(eq(requests.id, row.id)).run();
    });
    return { ok: true };
  }),

  /** DM only: the matter is settled; the request moves to the Archive. */
  resolve: authedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const { row, viewer } = requestFor(ctx.db, ctx.user.id, input.id);
    requireDm(viewer);
    const now = Date.now();
    if (row.status !== 'resolved')
      ctx.db.update(requests).set({ status: 'resolved', resolvedAt: now, updatedAt: now }).where(eq(requests.id, row.id)).run();
    return { ok: true };
  }),

  /** DM only: back to Open. */
  reopen: authedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const { row, viewer } = requestFor(ctx.db, ctx.user.id, input.id);
    requireDm(viewer);
    if (row.status !== 'open')
      ctx.db.update(requests).set({ status: 'open', resolvedAt: null, updatedAt: Date.now() }).where(eq(requests.id, row.id)).run();
    return { ok: true };
  }),

  /** DM only: the request and its messages are gone for both sides, for good. */
  remove: authedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const { row, viewer } = requestFor(ctx.db, ctx.user.id, input.id);
    requireDm(viewer);
    ctx.db.delete(requests).where(eq(requests.id, row.id)).run();
    return { ok: true };
  }),
});
