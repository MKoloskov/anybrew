import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { DB } from './db';
import { sessions, users } from './db/schema';

const SESSION_DAYS = 90;
export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Creates a session and returns the cookie token. Only its hash is stored. */
export function createSession(db: DB, userId: string): string {
  const token = newToken();
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  db.insert(sessions)
    .values({ tokenHash: sha256(token), userId, expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 })
    .run();
  return token;
}

export function destroySession(db: DB, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
}

export function destroyUserSessions(db: DB, userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export type SessionUser = { id: string; username: string; displayName: string; language: 'en' | 'ru' };

export function userFromToken(db: DB, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      language: users.language,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .get();
  if (!row || row.expiresAt < Date.now()) return null;
  const { expiresAt: _unused, ...user } = row;
  return user;
}
