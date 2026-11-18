import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerArchiveRoutes } from '../src/archive';
import { mirrorUploads } from '../src/backup-uploads';
import { files } from '../src/db/schema';
import { registerFileRoutes } from '../src/files';
import { world, type Client } from './helpers';

// Uploaded pictures in the ZIP export and import, and in the backup command (task F3).

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anybrew-archive-'));
  dirs.push(dir);
  return dir;
};

/** A world with the real file and archive routes, and Alice's character with three pictures. */
async function pictured() {
  const w = await world(['alice', 'bob']);
  const alice = w.players.alice!;
  const uploads = tempDir();
  const app = Fastify();
  await app.register(cookie);
  registerFileRoutes(app, w.db, 'sid', uploads);
  registerArchiveRoutes(app, w.db, 'sid', uploads);
  const { id } = await alice.entity.create({ systemId: w.systemId, typeKey: 'character', name: 'Pictured' });

  const upload = async (c: Client, body: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/upload?entityId=${id}&fieldId=gallery`,
      headers: { 'content-type': 'image/png' },
      cookies: { sid: c.token() },
      payload: Buffer.from(body),
    });
    return res.json().id as string;
  };
  const main = await upload(alice, 'picture-main');
  const second = await upload(alice, 'picture-second');
  const removed = await upload(alice, 'picture-removed');
  // Taken out of the gallery: no field holds it, but the change log can bring it back.
  await alice.entity.removePicture({ id, fieldId: 'gallery', fileId: removed });

  const exportZip = (c: Client | null) =>
    app.inject({ method: 'GET', url: `/api/export/${w.systemId}`, cookies: c ? { sid: c.token() } : {} });
  const importZip = (c: Client, payload: Buffer | Uint8Array) =>
    app.inject({ method: 'POST', url: '/api/import', headers: { 'content-type': 'application/zip' }, cookies: { sid: c.token() }, payload: Buffer.from(payload) });
  const load = (c: Client, fileId: string) => app.inject({ method: 'GET', url: `/api/file/${fileId}`, cookies: { sid: c.token() } });

  return { ...w, alice, uploads, id, main, second, removed, exportZip, importZip, load };
}

describe('ZIP export with pictures', () => {
  it('holds export.json and every picture of the System, the removed one included', async () => {
    const { dm, exportZip, main, second, removed } = await pictured();
    const res = await exportZip(dm);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');

    const entries = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(entries).filter((n) => !n.endsWith('/')).sort()).toEqual(['export.json', `pictures/${main}.png`, `pictures/${removed}.png`, `pictures/${second}.png`].sort());
    expect(strFromU8(entries[`pictures/${second}.png`]!)).toBe('picture-second');
    const data = JSON.parse(strFromU8(entries['export.json']!));
    expect(data.files.map((f: { id: string }) => f.id)).toEqual([main, second, removed]);
  });

  it('is for the DM only: a player and a stranger get "not found"', async () => {
    const { alice, players, exportZip } = await pictured();
    expect((await exportZip(alice)).statusCode).toBe(404);
    expect((await exportZip(players.bob!)).statusCode).toBe(404);
    expect((await exportZip(null)).statusCode).toBe(404);
  });

  it('leaves out a picture whose file is missing from disk', async () => {
    const { dm, exportZip, uploads, second } = await pictured();
    fs.rmSync(path.join(uploads, `${second}.png`));
    const entries = unzipSync(new Uint8Array((await exportZip(dm)).rawPayload));
    expect(Object.keys(entries)).not.toContain(`pictures/${second}.png`);
    expect(JSON.parse(strFromU8(entries['export.json']!)).files).toHaveLength(2);
  });
});

describe('ZIP import with pictures', () => {
  it('creates a new System whose pictures load, under new ids, with the removed one kept for undo', async () => {
    const { db, dm, exportZip, importZip, load, uploads, main, second, removed, systemId } = await pictured();
    const res = await importZip(dm, (await exportZip(dm)).rawPayload);
    expect(res.statusCode).toBe(200);
    const copyId = res.json().systemId as string;
    expect(copyId).not.toBe(systemId);

    const [copy] = (await dm.entity.list({ systemId: copyId, typeKey: 'character' })) as { id: string }[];
    const values = (await dm.entity.get({ id: copy!.id })).values;
    const newMain = values.portrait as string;
    const newGallery = values.gallery as string[];
    expect(newGallery).toHaveLength(2);
    expect(newGallery[0]).toBe(newMain);
    for (const old of [main, second, removed]) expect(newGallery).not.toContain(old);

    // The pictures load in the new System with the same bytes.
    const loaded = await load(dm, newGallery[1]!);
    expect(loaded.statusCode).toBe(200);
    expect(loaded.body).toBe('picture-second');

    // Three picture rows in the copy, each with its file on disk; none reuses an old id.
    const rows = db.select().from(files).where(eq(files.systemId, copyId)).all();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect([main, second, removed]).not.toContain(r.id);
      expect(r.entityId).toBe(copy!.id);
      expect(fs.existsSync(path.join(uploads, `${r.id}.png`))).toBe(true);
    }
    // The removed picture is still named by the copied change log, so an undo can bring it back.
    const exported = await dm.system.export({ systemId: copyId });
    const removedCopy = rows.find((r) => fs.readFileSync(path.join(uploads, `${r.id}.png`), 'utf8') === 'picture-removed')!;
    expect(JSON.stringify(exported.changes)).toContain(removedCopy.id);
    // No old id is left anywhere in the copy.
    for (const old of [main, second, removed]) expect(JSON.stringify(exported)).not.toContain(old);
  });

  it('imports the same file twice side by side', async () => {
    const { db, dm, exportZip, importZip } = await pictured();
    const zip = (await exportZip(dm)).rawPayload;
    const a = (await importZip(dm, zip)).json().systemId as string;
    const b = (await importZip(dm, zip)).json().systemId as string;
    expect(a).not.toBe(b);
    expect(db.select().from(files).where(eq(files.systemId, b)).all()).toHaveLength(3);
  });

  it('a JSON export without pictures still imports, with no pictures', async () => {
    const { db, dm, systemId } = await pictured();
    const data = JSON.parse(JSON.stringify(await dm.system.export({ systemId })));
    const { systemId: copyId } = await dm.system.import({ data });
    expect(db.select().from(files).where(eq(files.systemId, copyId)).all()).toHaveLength(0);
  });

  it('rejects a file that is not a ZIP export, and a ZIP without export.json', async () => {
    const { dm, importZip } = await pictured();
    expect((await importZip(dm, Buffer.from('not a zip'))).statusCode).toBe(400);
    expect((await importZip(dm, zipSync({ 'notes.txt': strToU8('hello') }))).statusCode).toBe(400);
    expect((await importZip(dm, zipSync({ 'export.json': strToU8('{"hello":"world"}') }))).statusCode).toBe(400);
  });

  it('ignores a picture of a type we do not accept', async () => {
    const { db, dm, exportZip, importZip } = await pictured();
    const entries = unzipSync(new Uint8Array((await exportZip(dm)).rawPayload));
    const data = JSON.parse(strFromU8(entries['export.json']!));
    data.files[0].mime = 'text/html';
    entries['export.json'] = strToU8(JSON.stringify(data));
    const res = await importZip(dm, zipSync(entries));
    expect(res.statusCode).toBe(200);
    expect(db.select().from(files).where(eq(files.systemId, res.json().systemId)).all()).toHaveLength(2);
  });
});

describe('backup of pictures', () => {
  it('copies new pictures only, and never deletes from the backup', () => {
    const uploads = tempDir();
    const target = path.join(tempDir(), 'uploads');
    fs.writeFileSync(path.join(uploads, 'a.png'), 'a');
    fs.writeFileSync(path.join(uploads, 'b.png'), 'b');
    expect(mirrorUploads(uploads, target)).toBe(2);
    expect(mirrorUploads(uploads, target)).toBe(0);

    fs.writeFileSync(path.join(uploads, 'c.png'), 'c');
    fs.rmSync(path.join(uploads, 'a.png'));
    expect(mirrorUploads(uploads, target)).toBe(1);
    expect(fs.readdirSync(target).sort()).toEqual(['a.png', 'b.png', 'c.png']);
    expect(fs.readFileSync(path.join(target, 'c.png'), 'utf8')).toBe('c');
  });

  it('does nothing when there is no uploads folder yet', () => {
    expect(mirrorUploads(path.join(tempDir(), 'missing'), path.join(tempDir(), 'uploads'))).toBe(0);
  });
});
