import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { SESSION_MAX_AGE_SECONDS, userFromToken } from './auth';
import { openDb } from './db';
import { appRouter, type AppRouter } from './router';
import type { Ctx } from './trpc';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_FILE = process.env.DB_FILE ?? path.resolve(import.meta.dirname, '../data/anybrew.db');
const isProduction = process.env.NODE_ENV === 'production';
const COOKIE = 'sid';

const db = openDb(DB_FILE);

// A system export can be large, so the body limit is 50 MB.
const app = Fastify({
  logger: { level: 'warn' },
  bodyLimit: 50 * 1024 * 1024,
  routerOptions: { maxParamLength: 5000 },
});
await app.register(cookie);

await app.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext: ({ req, res }): Ctx => {
      const token = req.cookies[COOKIE] ?? null;
      return {
        db,
        token,
        user: userFromToken(db, token ?? undefined),
        setSession: (next) => {
          if (next)
            res.setCookie(COOKIE, next, {
              httpOnly: true,
              sameSite: 'lax',
              secure: isProduction,
              path: '/',
              maxAge: SESSION_MAX_AGE_SECONDS,
            });
          else res.clearCookie(COOKIE, { path: '/' });
        },
      };
    },
    onError: ({ error, path: procedure }) => {
      if (error.code === 'INTERNAL_SERVER_ERROR') app.log.error({ procedure, err: error }, 'request failed');
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
});

// In production the built web app is served by this same process.
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/trpc')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: HOST });
console.log(`AnyBrew server on http://${HOST}:${PORT}  (database: ${DB_FILE})`);
