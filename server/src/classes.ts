// Classes: a rules document with the "Class" section attached is a class that characters can take.
// Its features live in the feature library (Type "Class feature", Class = the document's name).
// A class arrives either typed in by hand or as a class file: a PDF handbook converted to JSON.

import { z } from 'zod';

/** The key of the rule module that makes a rules document a class. */
export const CLASS_MODULE = 'class';

export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ABILITY_NAMES: Record<string, (typeof ABILITY_IDS)[number]> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

/** One class of a character: which class document, which subclass, and the level in that class. */
export type ClassPick = { classId: string; subclass: string | null; level: number };

export const classPicks = z
  .array(
    z.strictObject({
      classId: z.string().min(1).max(40),
      subclass: z.string().trim().min(1).max(200).nullable(),
      level: z.number().int().min(1).max(40),
    }),
  )
  .max(10);

export function picksOf(value: unknown): ClassPick[] {
  const parsed = classPicks.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** "INT, Wisdom" → ['int', 'wis']. */
export function parseSaves(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  const found = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    if ((ABILITY_IDS as readonly string[]).includes(word)) found.add(word);
    else if (ABILITY_NAMES[word]) found.add(ABILITY_NAMES[word]);
  }
  return ABILITY_IDS.filter((a) => found.has(a));
}

type Table = { columns: string[]; rows: string[][] };

/**
 * The line of a class table for a level: the row whose first cell is that level, or the nearest
 * one below it. Returned as heading and value pairs, without the level itself and without empty cells.
 */
export function tableRowFor(table: unknown, level: number): { column: string; value: string }[] {
  const t = table as Table | null;
  if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) return [];
  let best: { at: number; row: string[] } | null = null;
  for (const row of t.rows) {
    const at = Number.parseInt(String(row[0] ?? ''), 10);
    if (Number.isFinite(at) && at <= level && (!best || at > best.at)) best = { at, row };
  }
  if (!best) return [];
  return t.columns
    .map((column, i) => ({ column, value: (best!.row[i] ?? '').trim() }))
    .slice(1)
    .filter((c) => c.column.trim() && c.value && c.value !== '-' && c.value !== '—' && c.value !== '–');
}

const cell = z.string().max(500);
const short = z.string().trim().max(500).default('');

/** A class file: what a converted class handbook contains. Read by the review screen and the import. */
export const classFile = z.object({
  anybrew: z.literal('class'),
  name: z.string().trim().min(1).max(200),
  nameRu: z.string().trim().max(200).nullable().default(null),
  /** The readable text of the document, as HTML. */
  body: z.string().max(500_000).default(''),
  hitDie: z.number().int().min(1).max(100).nullable().default(null),
  saves: z.array(z.enum(ABILITY_IDS)).default([]),
  armor: short,
  weapons: short,
  tools: short,
  skills: z.string().trim().max(5000).default(''),
  /** What the class calls its subclasses: "Arcane Tradition", "Monastic Tradition"… */
  subclassTitle: z.string().trim().max(100).default(''),
  subclasses: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  /** The class table. The first column is the level. */
  table: z
    .object({ columns: z.array(cell).min(1).max(20), rows: z.array(z.array(cell)).max(500) })
    .refine((t) => t.rows.every((r) => r.length === t.columns.length), 'Every row of the table needs one cell per column')
    .nullable()
    .default(null),
  features: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        nameRu: z.string().trim().max(200).nullable().default(null),
        level: z.number().int().min(1).max(40).nullable().default(null),
        /** Null for a feature of the class itself. */
        subclass: z.string().trim().min(1).max(200).nullable().default(null),
        action: z.string().trim().max(500).nullable().default(null),
        summary: z.string().max(5000).default(''),
        description: z.string().max(500_000).default(''),
      }),
    )
    .max(500)
    .default([]),
});
export type ClassFile = z.infer<typeof classFile>;

/** How a feature of a class file is told apart in the review screen. */
export const featureKey = (f: { name: string; subclass: string | null }) => `${f.subclass ?? ''}|${f.name}`.toLowerCase();
