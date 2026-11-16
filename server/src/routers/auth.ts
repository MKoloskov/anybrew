import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { createSession, destroySession, destroyUserSessions, hashPassword, verifyPassword } from '../auth';
import { campaignMembers, campaigns, systems, invites, members, users } from '../db/schema';
import { authedProcedure, publicProcedure, router } from '../trpc';

const username = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\p{N}_.-]+$/u, 'Letters, digits, dot, dash and underscore only')
  .transform((s) => s.toLowerCase());
const displayName = z.string().trim().min(1).max(60);
const password = z.string().min(8).max(200);

export const authRouter = router({
  /** Tells the client which screen to show: first-run setup, login, or the app. */
  status: publicProcedure.query(({ ctx }) => {
    const count = ctx.db.select({ n: sql<number>`count(*)` }).from(users).get()!.n;
    return { needsSetup: count === 0, user: ctx.user };
  }),

  /** First run only: creates the DM account and the first system. */
  setup: publicProcedure
    .input(z.object({ username, displayName, password, systemName: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await hashPassword(input.password);
      const userId = nanoid();
      const systemId = nanoid();
      ctx.db.transaction((tx) => {
        const count = tx.select({ n: sql<number>`count(*)` }).from(users).get()!.n;
        if (count > 0) throw new TRPCError({ code: 'FORBIDDEN', message: 'Setup is already done' });
        tx.insert(users)
          .values({ id: userId, username: input.username, displayName: input.displayName, passwordHash, createdAt: Date.now() })
          .run();
        tx.insert(systems).values({ id: systemId, name: input.systemName, createdAt: Date.now() }).run();
        tx.insert(members).values({ systemId, userId, role: 'dm' }).run();
      });
      ctx.setSession(createSession(ctx.db, userId));
      return { systemId };
    }),

  login: publicProcedure.input(z.object({ username, password: z.string().max(200) })).mutation(async ({ ctx, input }) => {
    const user = ctx.db.select().from(users).where(eq(users.username, input.username)).get();
    const ok = user ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!user || !ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong name or password' });
    ctx.setSession(createSession(ctx.db, user.id));
    return { ok: true };
  }),

  logout: publicProcedure.mutation(({ ctx }) => {
    if (ctx.token) destroySession(ctx.db, ctx.token);
    ctx.setSession(null);
    return { ok: true };
  }),

  setLanguage: authedProcedure.input(z.object({ language: z.enum(['en', 'ru']) })).mutation(({ ctx, input }) => {
    ctx.db.update(users).set({ language: input.language }).where(eq(users.id, ctx.user.id)).run();
    return { ok: true };
  }),

  changePassword: authedProcedure
    .input(z.object({ current: z.string().max(200), next: password }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).get()!;
      if (!(await verifyPassword(user.passwordHash, input.current)))
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong current password' });
      ctx.db.update(users).set({ passwordHash: await hashPassword(input.next) }).where(eq(users.id, user.id)).run();
      destroyUserSessions(ctx.db, user.id);
      ctx.setSession(createSession(ctx.db, user.id));
      return { ok: true };
    }),

  /** What an invite link leads to. Shown before the player creates an account. */
  inviteInfo: publicProcedure.input(z.object({ token: z.string() })).query(({ ctx, input }) => {
    const invite = findOpenInvite(ctx.db, input.token);
    if (!invite) return { valid: false as const };
    const system = ctx.db.select().from(systems).where(eq(systems.id, invite.systemId)).get()!;
    const campaign = invite.campaignId
      ? ctx.db.select().from(campaigns).where(eq(campaigns.id, invite.campaignId)).get()
      : undefined;
    return { valid: true as const, systemName: system.name, campaignName: campaign?.name ?? null, role: invite.role };
  }),

  /** Creates an account from an invite link and joins the system. */
  acceptInvite: publicProcedure
    .input(z.object({ token: z.string(), username, displayName, password }))
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await hashPassword(input.password);
      const userId = nanoid();
      const systemId = ctx.db.transaction((tx) => {
        const invite = findOpenInvite(tx, input.token);
        if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'This invite link is used or expired' });
        if (tx.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get())
          throw new TRPCError({ code: 'CONFLICT', message: 'This login name is taken' });
        tx.insert(users)
          .values({ id: userId, username: input.username, displayName: input.displayName, passwordHash, createdAt: Date.now() })
          .run();
        tx.insert(members).values({ systemId: invite.systemId, userId, role: invite.role }).run();
        if (invite.campaignId) tx.insert(campaignMembers).values({ campaignId: invite.campaignId, userId }).run();
        tx.update(invites).set({ usedBy: userId }).where(eq(invites.token, invite.token)).run();
        return invite.systemId;
      });
      ctx.setSession(createSession(ctx.db, userId));
      return { systemId };
    }),

  /** An already logged-in user joins another system through an invite link. */
  joinWithInvite: authedProcedure.input(z.object({ token: z.string() })).mutation(({ ctx, input }) => {
    return ctx.db.transaction((tx) => {
      const invite = findOpenInvite(tx, input.token);
      if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'This invite link is used or expired' });
      const existing = tx
        .select()
        .from(members)
        .where(and(eq(members.systemId, invite.systemId), eq(members.userId, ctx.user.id)))
        .get();
      // Someone already in the system keeps their role; the link can still add them to its campaign.
      if (!existing) tx.insert(members).values({ systemId: invite.systemId, userId: ctx.user.id, role: invite.role }).run();
      const inCampaign =
        invite.campaignId &&
        tx
          .select()
          .from(campaignMembers)
          .where(and(eq(campaignMembers.campaignId, invite.campaignId), eq(campaignMembers.userId, ctx.user.id)))
          .get();
      if (invite.campaignId && !inCampaign)
        tx.insert(campaignMembers).values({ campaignId: invite.campaignId, userId: ctx.user.id }).run();
      if (!existing || (invite.campaignId && !inCampaign))
        tx.update(invites).set({ usedBy: ctx.user.id }).where(eq(invites.token, invite.token)).run();
      return { systemId: invite.systemId };
    });
  }),
});

type Reader = Pick<import('../db').DB, 'select'>;

function findOpenInvite(db: Reader, token: string) {
  const invite = db
    .select()
    .from(invites)
    .where(and(eq(invites.token, token), isNull(invites.usedBy)))
    .get();
  if (!invite || invite.expiresAt < Date.now()) return null;
  return invite;
}
