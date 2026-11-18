import type { Audience } from '../visibility';
import { listModules, listSchemas } from './index';
import type { EntitySchema, FieldType, SchemaGroup, SchemaNode } from './types';
import type { SchemaMigration, SchemaOp } from './versions';

// The fingerprint of the schemas: every node id of every type with what stored data depends on.
// `snapshot.json` holds the fingerprint that was last accepted. Comparing the two shows every
// change that needs a migration (see versions.ts).

export type NodePrint = {
  k: 'group' | 'field';
  /** Id of the group it lies in; null at the top. */
  p: string | null;
  t?: FieldType;
  /** Option values of a select. */
  o?: string[];
  /** Who sees it by default: 'dm', 'all' or an audience as JSON, and 'owner' for owner-only. */
  a?: string;
  /** Part of the outside view of its type. */
  x?: true;
};

export type TypePrint = {
  /** The type has an outside view: other players receive only the nodes marked `x`. */
  outside: boolean;
  modules: string[];
  nodes: Record<string, NodePrint>;
  /** Ids that were used once. They are never given to a new node. */
  retired: string[];
};

export type Snapshot = { version: number; types: Record<string, TypePrint> };

const audienceText = (a: Audience) => (a.all ? 'all' : !a.players.length && !a.parties.length ? 'dm' : JSON.stringify(a));

export const accessText = (visibility: Audience | undefined, ownerOnly: boolean | undefined) =>
  [visibility ? audienceText(visibility) : '', ownerOnly ? 'owner' : ''].filter(Boolean).join('+');

/** The fingerprint of one type: its own groups and the groups of all its modules, which share one id space. */
export function printOf(schema: EntitySchema, modules: { key: string; groups: SchemaGroup[] }[], errors: string[] = []): TypePrint {
  const nodes: Record<string, NodePrint> = {};
  const outside = new Set(schema.outside ?? []);
  const walk = (list: SchemaNode[], parent: string | null) => {
    for (const n of list) {
      if (nodes[n.id]) errors.push(`${schema.key}: the id "${n.id}" is used by two nodes. Ids must be unique inside a type, modules included.`);
      const print: NodePrint = { k: n.kind, p: parent };
      if (n.kind === 'field') {
        print.t = n.type;
        if (n.options) print.o = n.options.map((o) => o.value);
        if (outside.has(n.id)) print.x = true;
      }
      const access = accessText(n.visibility, n.ownerOnly);
      if (access) print.a = access;
      nodes[n.id] = print;
      if (n.kind === 'group') walk(n.children, n.id);
    }
  };
  walk(schema.groups, null);
  for (const m of modules) walk(m.groups, null);
  const sorted = Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { outside: !!schema.outside, modules: modules.map((m) => m.key).sort(), nodes: sorted, retired: [] };
}

/** The fingerprint of the schemas in the code. */
export function fingerprint(): { types: Record<string, TypePrint>; errors: string[] } {
  const errors: string[] = [];
  const types: Record<string, TypePrint> = {};
  for (const s of listSchemas().sort((a, b) => (a.key < b.key ? -1 : 1))) types[s.key] = printOf(s, listModules(s.key), errors);
  return { types, errors };
}

const ancestorsOf = (print: TypePrint, id: string): string[] => {
  const out: string[] = [];
  for (let p = print.nodes[id]?.p ?? null; p !== null; p = print.nodes[p]?.p ?? null) out.push(p);
  return out;
};

/** Who receives a field by default: the audiences on it and on the groups above it, and the outside view. */
const signature = (print: TypePrint, id: string): string =>
  [id, ...ancestorsOf(print, id)]
    .map((n) => print.nodes[n]?.a)
    .filter(Boolean)
    .sort()
    .join('|') + (print.outside ? (print.nodes[id]?.x ? '#outside' : '#closed') : '');

const opText = (op: Record<string, unknown>) => JSON.stringify(op).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ');

function audienceOfText(a: string): { default?: Audience; ownerOnly?: true } {
  const out: { default?: Audience; ownerOnly?: true } = {};
  for (const part of a ? a.split('+') : []) {
    if (part === 'owner') out.ownerOnly = true;
    else if (part === 'dm') out.default = { all: false, players: [], parties: [] };
    else if (part === 'all') out.default = { all: true, players: [], parties: [] };
    else out.default = JSON.parse(part) as Audience;
  }
  return out;
}

function checkType(type: string, S: TypePrint, C: TypePrint, ops: SchemaOp[], errors: string[]) {
  const say = (text: string) => errors.push(`${type}: ${text}`);
  const renames = new Map<string, string>();
  const removed = new Set<string>();
  const moves = new Map<string, Extract<SchemaOp, { op: 'move' }>>();
  const converts = new Map<string, Extract<SchemaOp, { op: 'convert' }>>();
  const acks = new Set<string>();
  const moduleOps = new Map<string, string | null>();

  for (const op of ops) {
    if (op.op === 'access') acks.add(op.id);
    else if (op.op === 'renameModule') moduleOps.set(op.from, op.to);
    else if (op.op === 'removeModule') moduleOps.set(op.key, null);
    else {
      const id = op.op === 'rename' ? op.from : op.id;
      if (!S.nodes[id]) {
        say(`the migration names "${id}" (${op.op}), which was not a node before it.`);
        continue;
      }
      if (op.op === 'rename') {
        if (S.nodes[op.to] || S.retired.includes(op.to)) say(`"${op.from}" cannot be renamed to "${op.to}": that id is or was in use.`);
        renames.set(op.from, op.to);
      } else if (op.op === 'remove') removed.add(op.id);
      else if (op.op === 'move') moves.set(op.id, op);
      else converts.set(op.id, op);
    }
  }

  const image = (s: string): string | null => (removed.has(s) ? null : (renames.get(s) ?? s));
  const images = new Set<string>();
  const lostOf = new Map<string, string[]>();
  const survivors: [string, string][] = [];

  for (const [s, sn] of Object.entries(S.nodes)) {
    const c = image(s);
    if (c === null) {
      if (C.nodes[s]) say(`"${s}" is removed by the migration but still in the schema. A removed id is never used again.`);
      continue;
    }
    const cn = C.nodes[c];
    if (!cn) {
      say(
        `the ${sn.k} "${s}" is gone. What is stored under it would be orphaned. ` +
          `If it got a new id: ${opText({ op: 'rename', type, from: s, to: '<new id>' })}. If it is deleted: ${opText({ op: 'remove', type, id: s })}.`,
      );
      continue;
    }
    images.add(c);
    if (cn.k !== sn.k) {
      say(`"${s}" was a ${sn.k} and is now a ${cn.k}. Give the new node a new id and remove the old one.`);
      continue;
    }
    survivors.push([s, c]);
    const above = ancestorsOf(C, c);
    lostOf.set(s, ancestorsOf(S, s).filter((a) => { const ia = image(a); return ia === null || !above.includes(ia); }));

    if (sn.k === 'field') {
      const convert = converts.get(s);
      const lostOptions = (sn.o ?? []).filter((o) => !(cn.o ?? []).includes(o));
      if (sn.t !== cn.t) {
        if (!convert || convert.to !== cn.t)
          say(`the field "${s}" changed type from ${sn.t} to ${cn.t}. Stored values must be rewritten: ${opText({ op: 'convert', type, id: s, to: cn.t })} with an fn that turns an old value into a new one.`);
      } else if (lostOptions.length && !convert) {
        say(`the field "${s}" lost the options ${lostOptions.join(', ')}. Values that hold them must be rewritten: ${opText({ op: 'convert', type, id: s, to: cn.t })} with an fn.`);
      } else if (convert && convert.to !== cn.t) {
        say(`the convert of "${s}" says ${convert.to}, but the field is ${cn.t}.`);
      }
    } else if (converts.has(s)) say(`"${s}" is a group and cannot be converted.`);
  }

  for (const [s, c] of survivors) {
    const sn = S.nodes[s]!;
    const cn = C.nodes[c]!;
    const lost = lostOf.get(s)!;
    const move = moves.get(s);
    if (move) {
      const extra = move.lost.filter((g) => !lost.includes(g));
      if (extra.length) say(`the move of "${s}" lists ${extra.join(', ')}, which it did not leave.`);
      if (accessText(move.default, move.ownerOnly) !== (cn.a ?? ''))
        say(`the move of "${s}" must repeat the node's default audience in the new schema: ${opText({ op: 'move', type, id: s, lost: move.lost, ...audienceOfText(cn.a ?? '') })}.`);
    }
    if (lost.length) {
      // A move on the node, or on a group that is still above it, carries the overrides along.
      const stillAbove = ancestorsOf(S, s).filter((a) => !lost.includes(a));
      const covered = new Set([...(move?.lost ?? []), ...stillAbove.flatMap((a) => moves.get(a)?.lost ?? [])]);
      const missing = lost.filter((g) => !covered.has(g));
      const parent = sn.p;
      const parentReports = parent !== null && stillAbove.includes(parent) && missing.every((g) => (lostOf.get(parent) ?? []).includes(g));
      if (missing.length && !parentReports)
        say(
          `the ${sn.k} "${s}" is no longer inside ${lost.join(', ')}. An entity that narrowed such a group would show "${s}" to more people. ` +
            `Carry the audience along: ${opText({ op: 'move', type, id: s, lost, ...audienceOfText(cn.a ?? '') })}.`,
        );
    }
    if (sn.k === 'field' && signature(S, s) !== signature(C, c)) {
      const named = [s, '*', ...ancestorsOf(S, s), ...ancestorsOf(C, c)].some((id) => acks.has(id));
      if (!named)
        say(
          `who sees the field "${s}" by default changed, from [${signature(S, s) || 'open'}] to [${signature(C, c) || 'open'}]. ` +
            `If that is intended, state it: ${opText({ op: 'access', type, id: s, why: '<reason>' })} (the id of a group above it, or "*", covers everything inside).`,
        );
    }
  }

  const spent = new Set([...S.retired, ...removed, ...renames.keys()]);
  for (const c of Object.keys(C.nodes)) if (!images.has(c) && spent.has(c)) say(`the new node "${c}" uses an id that was in use before. Old values and history would attach to it; choose a new id.`);

  for (const m of S.modules) {
    const to = moduleOps.has(m) ? moduleOps.get(m)! : m;
    if (!moduleOps.has(m) && !C.modules.includes(m))
      say(`the module "${m}" is gone. ${opText({ op: 'renameModule', type, from: m, to: '<new key>' })} or ${opText({ op: 'removeModule', type, key: m })}.`);
    else if (to !== null && !C.modules.includes(to)) say(`the module "${m}" is renamed to "${to}", which does not exist.`);
  }
}

export type SchemaCheck = {
  /** What must be fixed before the schemas can be accepted. */
  errors: string[];
  /** The snapshot matches the code: nothing to accept. */
  upToDate: boolean;
  /** The snapshot to store when there are no errors. */
  next: Snapshot;
};

/** Compares the accepted snapshot with the schemas in the code, given the migrations written so far. */
export function checkSchemas(snapshot: Snapshot | null, current: { types: Record<string, TypePrint>; errors: string[] }, migrations: SchemaMigration[]): SchemaCheck {
  const errors = [...current.errors];
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) errors.push(`Migration number ${i + 1} in the list has version ${m.version}. Versions run 1, 2, 3… with no gaps.`);
  });
  const old: Snapshot = snapshot ?? { version: migrations.length, types: {} };
  const pending = migrations.filter((m) => m.version > old.version);
  if (old.version > migrations.length) errors.push(`The snapshot is at version ${old.version}, but only ${migrations.length} migrations exist. A migration was deleted.`);
  if (pending.length > 1) errors.push(`${pending.length} migrations were added since the snapshot was accepted. Accept the snapshot after each migration.`);
  const ops = pending[0]?.ops ?? [];

  for (const op of ops) if (!old.types[op.type]) errors.push(`The migration names the type "${op.type}", which did not exist before it.`);
  const next: Snapshot = { version: migrations.length, types: {} };
  for (const [type, S] of Object.entries(old.types)) {
    const C = current.types[type];
    if (!C) {
      errors.push(`The type "${type}" is gone. Its entities could no longer be opened. Removing or renaming a type is not supported by migrations yet.`);
      continue;
    }
    const mine = ops.filter((op) => op.type === type);
    checkType(type, S, C, mine, errors);
    const retired = new Set(S.retired);
    for (const op of mine) {
      if (op.op === 'remove') retired.add(op.id);
      if (op.op === 'rename') retired.add(op.from);
    }
    next.types[type] = { ...C, retired: [...retired].sort() };
  }
  for (const [type, C] of Object.entries(current.types)) if (!next.types[type]) next.types[type] = C;
  next.types = Object.fromEntries(Object.entries(next.types).sort(([a], [b]) => (a < b ? -1 : 1)));

  return { errors, upToDate: !!snapshot && JSON.stringify(snapshot) === JSON.stringify(next), next };
}
