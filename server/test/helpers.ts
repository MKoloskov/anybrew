import { userFromToken } from '../src/auth';
import { openDb, type DB } from '../src/db';
import { appRouter } from '../src/router';

export type Client = ReturnType<typeof appRouter.createCaller> & { userId: () => string };

/** A caller that keeps its own session cookie, like one browser. */
export function client(db: DB): Client {
  const session: { token: string | null } = { token: null };
  const caller = appRouter.createCaller(() => ({
    db,
    token: session.token,
    user: userFromToken(db, session.token ?? undefined),
    setSession: (next) => {
      session.token = next;
    },
  }));
  // The caller is a proxy that treats every property as a procedure path, so userId is answered in front of it.
  const userId = () => userFromToken(db, session.token ?? undefined)!.id;
  return new Proxy(caller, {
    get: (target, prop, receiver) => (prop === 'userId' ? userId : Reflect.get(target, prop, receiver)),
  }) as Client;
}

/** A fresh in-memory world: one DM, one system, and as many players as asked for. */
export async function world(playerNames: string[] = ['alice', 'bob']) {
  const db = openDb(':memory:');
  const dm = client(db);
  const { systemId } = await dm.auth.setup({
    username: 'dm',
    displayName: 'The DM',
    password: 'dm-password',
    systemName: 'Test System',
  });
  const players: Record<string, Client> = {};
  for (const name of playerNames) {
    const { token } = await dm.system.createInvite({ systemId, role: 'player' });
    const p = client(db);
    await p.auth.acceptInvite({ token, username: name, displayName: name, password: `${name}-password` });
    players[name] = p;
  }
  return { db, dm, systemId, players };
}

export async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERROR';
  }
}
