import type { FastifyInstance } from 'fastify';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { userFromToken } from './auth';
import type { DB } from './db';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './images';
import { buildExport, exportSchema, importSystem } from './routers/system';
import { requireDm, viewerFor } from './trpc';

// A whole System with its pictures as one ZIP file:
//   export.json          the same document as the JSON export
//   pictures/<id>.<ext>  every uploaded picture of the System that is still on disk,
//                        replaced ones included, so an undo in the change log finds its picture.
// A plain .json export (no pictures) still imports through the tRPC route.

const JSON_NAME = 'export.json';
const PICTURES = 'pictures/';
const MAX_JSON_BYTES = 200 * 1024 * 1024;
/** Largest ZIP accepted for import. */
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

export function buildExportZip(db: DB, systemId: string, uploadsDir: string): Uint8Array {
  const data = buildExport(db, systemId);
  const pictures: Zippable = {};
  data.files = data.files.filter((f) => {
    const name = `${f.id}.${IMAGE_TYPES[f.mime]}`;
    const diskPath = path.join(uploadsDir, name);
    if (!IMAGE_TYPES[f.mime] || !fs.existsSync(diskPath)) return false;
    pictures[name] = fs.readFileSync(diskPath);
    return true;
  });
  // Pictures are already compressed, so they are stored as they are.
  return zipSync(
    { [JSON_NAME]: [new TextEncoder().encode(JSON.stringify(data, null, 2)), { level: 6 }], pictures },
    { level: 0 },
  );
}

/** Reads a ZIP export. Throws on anything that is not one. */
export function readExportZip(zip: Uint8Array) {
  const entries = unzipSync(zip, {
    filter: (f) =>
      (f.name === JSON_NAME && f.originalSize <= MAX_JSON_BYTES) ||
      (/^pictures\/[\w-]+\.\w+$/.test(f.name) && f.originalSize <= MAX_IMAGE_BYTES),
  });
  const json = entries[JSON_NAME];
  if (!json) throw new Error('No export.json in the file');
  const data = exportSchema.parse(JSON.parse(new TextDecoder().decode(json)));
  const bytes = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(entries))
    if (name.startsWith(PICTURES)) bytes.set(name.slice(PICTURES.length).replace(/\.[^.]+$/, ''), content);
  return { data, bytes };
}

export function registerArchiveRoutes(app: FastifyInstance, db: DB, cookieName: string, uploadsDir: string) {
  const userOf = (cookies: Record<string, string | undefined>) => userFromToken(db, cookies[cookieName] ?? undefined);
  for (const mime of ['application/zip', 'application/x-zip-compressed'])
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: MAX_ARCHIVE_BYTES }, (_req, body, done) => done(null, body));

  /** The System with its pictures. DM only; anyone else gets "not found". */
  app.get('/api/export/:systemId', (req, reply) => {
    const user = userOf(req.cookies);
    const { systemId } = req.params as { systemId: string };
    try {
      if (!user) throw new Error();
      requireDm(viewerFor(db, user.id, systemId));
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="anybrew-export.zip"')
      .header('cache-control', 'no-store')
      .send(Buffer.from(buildExportZip(db, systemId, uploadsDir)));
  });

  /** Creates a new System from a ZIP export. The caller becomes its DM. */
  app.post('/api/import', { bodyLimit: MAX_ARCHIVE_BYTES }, (req, reply) => {
    const user = userOf(req.cookies);
    if (!user) return reply.code(401).send({ error: 'Log in first' });
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'Send a ZIP export file' });
    let parsed: ReturnType<typeof readExportZip>;
    try {
      parsed = readExportZip(new Uint8Array(req.body));
    } catch {
      return reply.code(400).send({ error: 'This is not a system export file' });
    }
    const systemId = importSystem(db, parsed.data, user.id, { dir: uploadsDir, bytes: parsed.bytes });
    return reply.send({ systemId });
  });
}
