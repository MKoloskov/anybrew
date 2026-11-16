import { initTRPC, TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { DB } from './db';
import { campaignMembers, campaigns, members, partyMembers, parties } from './db/schema';
import type { SessionUser } from './auth';
import type { Viewer } from './visibility';

export type Ctx = {
  db: DB;
  user: SessionUser | null;
  /** The raw cookie token of the current session, if any. */
  token: string | null;
  /** Sets the session cookie, or clears it when given null. */
  setSession: (token: string | null) => void;
};

// isDev: false keeps server stack traces out of error responses in every environment.
const t = initTRPC.context<Ctx>().create({ isDev: false });

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Resolves the caller's role, campaigns and parties in a system.
 * A non-member gets NOT_FOUND, the same answer as for a system that does not exist.
 */
export function viewerFor(db: DB, userId: string, systemId: string): Viewer {
  const member = db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.systemId, systemId), eq(members.userId, userId)))
    .get();
  if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
  const partyIds = db
    .select({ id: parties.id })
    .from(partyMembers)
    .innerJoin(parties, eq(parties.id, partyMembers.partyId))
    .where(and(eq(parties.systemId, systemId), eq(partyMembers.userId, userId)))
    .all()
    .map((p) => p.id);
  const campaignIds = db
    .select({ id: campaigns.id })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
    .where(and(eq(campaigns.systemId, systemId), eq(campaignMembers.userId, userId)))
    .all()
    .map((c) => c.id);
  return { userId, role: member.role, campaignIds, partyIds };
}

export function requireDm(viewer: Viewer): void {
  if (viewer.role !== 'dm') throw new TRPCError({ code: 'FORBIDDEN' });
}
