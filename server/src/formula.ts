// A small, safe formula language for computed fields. No code is ever evaluated.
//
//   numbers        12  1.5
//   text           'dex'
//   field ids      str   skill_athletics_prof     (a ticked box counts as 1, an empty field as 0)
//   operators      + - * /   == != < <= > >=
//   functions      floor ceil round abs min max  if(condition, then, else)  mod(score)
//
// lookup('name', x) reads the rules table with that formula name: it finds the last row whose first
// column is not above x and gives that row's second column (or column n with lookup('name', x, n)).
//
// mod(score) is the ability modifier: floor((score - 10) / 2), or 0 while the score is empty.

type Value = number | string;
export type Lookup = (fieldId: string) => unknown;
/** Rows of the rules table with the given formula name, or null when there is none. */
export type Tables = (name: string) => string[][] | null;

type Token = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|[-+*/(),<>]))/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (src.slice(pos).trim() === '') break;
      throw new Error(`Formula: unexpected text at ${pos}: ${src.slice(pos, pos + 10)}`);
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'id', v: m[3] });
    else out.push({ t: 'op', v: m[4]! });
  }
  return out;
}

type Node =
  | { k: 'lit'; v: Value }
  | { k: 'ref'; id: string }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'neg'; a: Node };

const FUNCTIONS = new Set(['floor', 'ceil', 'round', 'abs', 'min', 'max', 'if', 'mod', 'lookup']);

function parse(src: string): Node {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Formula: expected ${v}`);
    i++;
  };

  const primary = (): Node => {
    const tok = tokens[i++];
    if (!tok) throw new Error('Formula: unexpected end');
    if (tok.t === 'num' || tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'id') {
      if (isOp('(')) {
        if (!FUNCTIONS.has(tok.v)) throw new Error(`Formula: unknown function ${tok.v}`);
        i++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(comparison());
          while (isOp(',')) {
            i++;
            args.push(comparison());
          }
        }
        expect(')');
        return { k: 'call', fn: tok.v, args };
      }
      return { k: 'ref', id: tok.v };
    }
    if (tok.v === '(') {
      const inner = comparison();
      expect(')');
      return inner;
    }
    if (tok.v === '-') return { k: 'neg', a: primary() };
    throw new Error(`Formula: unexpected ${tok.v}`);
  };
  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let left = next();
    while (peek()?.t === 'op' && ops.includes(String(peek()!.v))) {
      const op = String(tokens[i++]!.v);
      left = { k: 'bin', op, a: left, b: next() };
    }
    return left;
  };
  const product = binary(primary, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const comparison: () => Node = binary(sum, ['==', '!=', '<', '<=', '>', '>=']);

  const tree = comparison();
  if (i < tokens.length) throw new Error('Formula: unexpected text after the end');
  return tree;
}

const cache = new Map<string, Node>();

function toValue(raw: unknown): Value {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'string') {
    const n = Number(raw.replace(',', '.'));
    return raw.trim() !== '' && Number.isFinite(n) ? n : raw;
  }
  // A pool ({ cur, max }) counts as what is left in it.
  if (raw && typeof raw === 'object' && typeof (raw as { cur?: unknown }).cur === 'number') return (raw as { cur: number }).cur;
  return 0;
}

const num = (v: Value): number => (typeof v === 'number' ? v : 0);

function run(node: Node, lookup: Lookup, tables: Tables): Value {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'ref':
      return toValue(lookup(node.id));
    case 'neg':
      return -num(run(node.a, lookup, tables));
    case 'bin': {
      const a = run(node.a, lookup, tables);
      const b = run(node.b, lookup, tables);
      switch (node.op) {
        case '+':
          return num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
          return num(b) === 0 ? 0 : num(a) / num(b);
        case '==':
          return a === b ? 1 : 0;
        case '!=':
          return a !== b ? 1 : 0;
        case '<':
          return num(a) < num(b) ? 1 : 0;
        case '<=':
          return num(a) <= num(b) ? 1 : 0;
        case '>':
          return num(a) > num(b) ? 1 : 0;
        default:
          return num(a) >= num(b) ? 1 : 0;
      }
    }
    case 'call': {
      if (node.fn === 'if') {
        const cond = run(node.args[0]!, lookup, tables);
        const truthy = typeof cond === 'number' ? cond !== 0 : cond !== '';
        return run(node.args[truthy ? 1 : 2]!, lookup, tables);
      }
      if (node.fn === 'lookup') {
        const rows = tables(String(run(node.args[0]!, lookup, tables)));
        const x = num(run(node.args[1]!, lookup, tables));
        const column = node.args[2] ? num(run(node.args[2], lookup, tables)) - 1 : 1;
        let best: { key: number; value: Value } | null = null;
        for (const r of rows ?? []) {
          const key = Number((r[0] ?? '').replace(',', '.'));
          if ((r[0] ?? '').trim() === '' || !Number.isFinite(key) || key > x) continue;
          if (!best || key >= best.key) best = { key, value: toValue(r[column] ?? '') };
        }
        return best ? best.value : 0;
      }
      const args = node.args.map((a) => num(run(a, lookup, tables)));
      switch (node.fn) {
        case 'floor':
          return Math.floor(args[0] ?? 0);
        case 'ceil':
          return Math.ceil(args[0] ?? 0);
        case 'round':
          return Math.round(args[0] ?? 0);
        case 'abs':
          return Math.abs(args[0] ?? 0);
        case 'min':
          return Math.min(...args);
        case 'max':
          return Math.max(...args);
        default:
          // mod: an ability score that is not filled in yet gives 0, not -5.
          return args[0] ? Math.floor((args[0] - 10) / 2) : 0;
      }
    }
  }
}

/** Evaluates a formula. A broken formula gives null instead of failing the whole sheet. */
export function evaluate(formula: string, lookup: Lookup, tables: Tables = () => null): number | string | null {
  try {
    let tree = cache.get(formula);
    if (!tree) {
      tree = parse(formula);
      cache.set(formula, tree);
    }
    const result = run(tree, lookup, tables);
    return typeof result === 'number' && !Number.isFinite(result) ? null : result;
  } catch {
    return null;
  }
}

/** Throws when the formula cannot be parsed. Used by tests to check every schema formula. */
export function checkFormula(formula: string): string[] {
  const ids: string[] = [];
  const walk = (n: Node) => {
    if (n.k === 'ref') ids.push(n.id);
    else if (n.k === 'call') n.args.forEach(walk);
    else if (n.k === 'bin') {
      walk(n.a);
      walk(n.b);
    } else if (n.k === 'neg') walk(n.a);
  };
  walk(parse(formula));
  return ids;
}
