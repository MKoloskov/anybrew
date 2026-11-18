// One-time conversion, 2026-11-16: features were filed under one "Category" text ("Monk features",
// "Feats"…). They now have a Type and a Class. This fills both from the old category of every
// feature that has no Type yet, as logged field changes, and leaves everything else alone.
// Run: npm run convert:feature-types -w server [-- --dry]

import { and, eq, isNull } from 'drizzle-orm';
import path from 'node:path';
import { openDb } from '../db';
import { changes, entities, members } from '../db/schema';
import { typeAndClassOf } from '../schemas/library';

const dry = process.argv.includes('--dry');
const db = openDb(process.env.DB_FILE ?? path.resolve(import.meta.dirname, '../../data/anybrew.db'));
const rows = db.select().from(entities).where(and(eq(entities.typeKey, 'feature'), isNull(entities.deletedAt))).all();
const counts = new Map<string, number>();
let changed = 0;

db.transaction((tx) => {
  for (const row of rows) {
    const category = row.values.category;
    if (typeof category !== 'string' || !category.trim() || row.values.ftype) continue;
    const next = typeAndClassOf(category);
    const label = next.class ? `${next.ftype} / ${next.class}` : next.ftype;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    changed++;
    if (dry) continue;
    const dm = tx.select().from(members).where(eq(members.systemId, row.systemId)).all().find((m) => m.role === 'dm');
    if (!dm) throw new Error(`System ${row.systemId} has no DM to log the change under.`);
    const values = { ...row.values, ftype: next.ftype, ...(next.class ? { class: next.class } : {}) };
    const now = Date.now();
    tx.update(entities).set({ values, updatedAt: now }).where(eq(entities.id, row.id)).run();
    const log = (key: string, value: string) =>
      tx.insert(changes).values({ systemId: row.systemId, entityId: row.id, target: 'field', key, oldValue: null, newValue: value, userId: dm.userId, at: now }).run();
    log('ftype', next.ftype);
    if (next.class) log('class', next.class);
  }
});

console.log(`${dry ? 'Would convert' : 'Converted'} ${changed} of ${rows.length} features:`);
for (const [label, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}  ${label}`);
