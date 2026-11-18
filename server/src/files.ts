import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { userFromToken } from './auth';
import type { DB } from './db';
import { files } from './db/schema';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './images';
import { attachImage, canSeeFile, fieldAccess, GALLERY_MAX, galleryOf } from './routers/entity';

// Uploaded images. They are stored as files next to the database and served only to people
// who may see a field that holds them, through the same visibility rules as everything else.

export function registerFileRoutes(app: FastifyInstance, db: DB, cookieName: string, uploadsDir: string) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (const mime of Object.keys(IMAGE_TYPES))
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));

  const userOf = (cookies: Record<string, string | undefined>) => userFromToken(db, cookies[cookieName] ?? undefined);

  app.post('/api/upload', (req, reply) => {
    const user = userOf(req.cookies);
    if (!user) return reply.code(401).send({ error: 'Log in first' });
    const { entityId, fieldId } = req.query as { entityId?: string; fieldId?: string };
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    const extension = IMAGE_TYPES[mime];
    if (!entityId || !fieldId || !extension || !Buffer.isBuffer(req.body))
      return reply.code(400).send({ error: 'Send a PNG, JPEG, WebP or GIF image' });

    const access = fieldAccess(db, user.id, entityId, fieldId);
    // A field the caller cannot see or edit answers exactly like one that does not exist.
    if (!access || !access.canEdit || (access.field.type !== 'image' && access.field.type !== 'gallery'))
      return reply.code(404).send({ error: 'Not found' });
    if (access.field.type === 'gallery' && galleryOf(access.field, access.row.values).length >= GALLERY_MAX)
      return reply.code(400).send({ error: `A gallery holds ${GALLERY_MAX} pictures at most` });

    const id = nanoid();
    fs.writeFileSync(path.join(uploadsDir, `${id}.${extension}`), req.body);
    attachImage(db, access.row, fieldId, user.id, { id, mime, size: req.body.length });
    return reply.send({ id });
  });

  app.get('/api/file/:id', (req, reply) => {
    const user = userOf(req.cookies);
    const { id } = req.params as { id: string };
    const file = user && /^[\w-]{10,40}$/.test(id) ? db.select().from(files).where(eq(files.id, id)).get() : undefined;
    const allowed = !!file && !!user && canSeeFile(db, user.id, file);
    const diskPath = file ? path.join(uploadsDir, `${file.id}.${IMAGE_TYPES[file.mime]}`) : '';
    if (!file || !allowed || !fs.existsSync(diskPath)) return reply.code(404).send({ error: 'Not found' });
    return reply
      .header('content-type', file.mime)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .send(fs.readFileSync(diskPath));
  });
}
