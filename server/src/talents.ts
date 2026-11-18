// Reads a talent-tree note written as nested numbered lists (the owner's Obsidian format)
// into the data a character's talent tree field stores.
//
//   PATRON NAME                              a line in capitals starts a patron
//   1) Seal of Darkness Tree (Nine Hells)    top-level item: a tree; text after " - " or ":" says what it is about
//   	1) Name: First Seal (+) {4.5 PP}      second level: a talent. "(+)" = taken, "{n PP}" = cost
//   		1) Type: Milestone Upgrade
//   		2) Prereq: First Seal, Other Talent | any 2 talents in this tree | -
//   		3) Tier: 1
//   		4) Description: …                    deeper lines belong to the description
//
// Everything before the line "Talent Branches" is kept apart as notes for the DM (balance commentary).

export type Talent = {
  id: string;
  name: string;
  type: 'Minor' | 'Major' | 'Milestone' | '';
  cost: number;
  tier: number | null;
  /** The prerequisite as written. */
  prereq: string;
  /** Ids of the talents that must be taken first. */
  requires: string[];
  /** How many other talents of the same tree must be taken first. */
  anyOfTree: number;
  description: string;
};
export type TalentTree = { id: string; name: string; about: string; talents: Talent[] };
export type TalentData = {
  pointsTotal: number | null;
  rules: string[];
  tracks: { name: string; levels: string[] }[];
  patrons: { name: string; trees: TalentTree[] }[];
};
export type TalentPicks = Record<string, { level: number | null }>;

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '');
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
const ITEM = /^(\s*)(?:\d+[.)]|[-*])\s+(.*)$/;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function depthOf(indent: string): number {
  let width = 0;
  for (const ch of indent) width += ch === '\t' ? 4 : 1;
  return Math.round(width / 4);
}

export function parseTalents(markdown: string): { data: TalentData; picks: TalentPicks; dmNotes: string } {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => /talent branches/i.test(stripHtml(l)));
  const head = lines.slice(0, Math.max(start, 0));
  const body = lines.slice(start + 1);

  const data: TalentData = { pointsTotal: null, rules: [], tracks: [], patrons: [] };
  const picks: TalentPicks = {};

  // Levelled tracks ("**Protection Protocol:**" followed by a list) sit above the trees.
  const dmLines: string[] = [];
  let track: { name: string; levels: string[] } | null = null;
  for (const raw of head) {
    const line = stripHtml(raw).trim();
    const title = /^\*\*(.+?):?\*\*:?$/.exec(line);
    if (title && /protocol/i.test(title[1]!)) {
      track = { name: title[1]!.replace(/:$/, '').trim(), levels: [] };
      data.tracks.push(track);
      continue;
    }
    const item = ITEM.exec(raw);
    if (track && item) {
      track.levels.push(item[2]!.replace(/^->\s*/, '').trim());
      continue;
    }
    if (track && line === '') continue;
    track = null;
    dmLines.push(raw);
  }

  let patron: TalentData['patrons'][number] | null = null;
  let tree: TalentTree | null = null;
  let talent: Talent | null = null;
  let inDescription = false;
  const usedIds = new Set<string>();
  const uniqueId = (base: string) => {
    let id = base || 'talent';
    for (let n = 2; usedIds.has(id); n++) id = `${base}_${n}`;
    usedIds.add(id);
    return id;
  };
  const describe = (text: string, depth: number) => {
    if (!talent || !text) return;
    talent.description += `${talent.description ? '\n' : ''}${'  '.repeat(Math.max(0, depth - 3))}${depth > 2 ? '• ' : ''}${text}`;
  };

  for (const raw of body) {
    const plain = stripHtml(raw).replace(/\*\*/g, '');
    const text = plain.trim();
    if (!text || /^-{3,}$/.test(text)) continue;

    const points = /points total:\s*([\d.]+)/i.exec(text);
    if (points) {
      data.pointsTotal = Number(points[1]);
      continue;
    }
    const item = ITEM.exec(plain);
    if (!item) {
      if (/^\*?rule:/i.test(text)) data.rules.push(text.replace(/^\*|\*$/g, '').replace(/^rule:\s*/i, ''));
      else if (text === text.toUpperCase() && /[A-Z]/.test(text)) {
        patron = { name: text.toLowerCase().replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()), trees: [] };
        data.patrons.push(patron);
        tree = null;
        talent = null;
      } else describe(text, 3);
      continue;
    }
    const depth = depthOf(item[1]!);
    const content = item[2]!.trim();

    if (depth === 0) {
      if (!patron) {
        patron = { name: 'Talents', trees: [] };
        data.patrons.push(patron);
      }
      const cleaned = content.replace(/^name:\s*/i, '');
      const split = /^(.*?\))\s*(?:[-:–]\s*)?(.*)$/.exec(cleaned) ?? /^(.*?)\s+[-–]\s+(.*)$/.exec(cleaned);
      const name = (split ? split[1]! : cleaned).replace(/:$/, '').trim();
      tree = { id: uniqueId(`tree_${slug(name.replace(/\(.*?\)/g, ''))}`), name, about: split ? split[2]!.replace(/^about\s+/i, '').trim() : '', talents: [] };
      patron.trees.push(tree);
      talent = null;
      continue;
    }
    if (!tree) continue;

    const attribute = /^(type|prereq|tier|description)\s*:\s*(.*)$/i.exec(content);
    if (depth === 1 && !attribute) {
      const taken = /\(\+\)/.test(content);
      const cost = /\{\s*([\d.]+)\s*PP\s*\}/i.exec(content);
      const name = content
        .replace(/^name:\s*/i, '')
        .replace(/\(\+\)/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/:\s*$/, '')
        .trim();
      talent = { id: uniqueId(slug(name)), name, type: '', cost: cost ? Number(cost[1]) : 0, tier: null, prereq: '', requires: [], anyOfTree: 0, description: '' };
      tree.talents.push(talent);
      if (taken) picks[talent.id] = { level: null };
      inDescription = false;
      continue;
    }
    if (!talent) continue;
    if (depth === 2 && attribute) {
      const key = attribute[1]!.toLowerCase();
      const value = attribute[2]!.trim();
      inDescription = key === 'description';
      if (key === 'type') talent.type = (/(minor|major|milestone)/i.exec(value)?.[1] ?? '').replace(/^./, (c) => c.toUpperCase()) as Talent['type'];
      else if (key === 'tier') talent.tier = Number(value) || null;
      else if (key === 'prereq') talent.prereq = value === '-' ? '' : value;
      else describe(value, 2);
      continue;
    }
    // Anything else under a talent is part of its description, whatever heading it sits under.
    describe(content, inDescription ? depth : depth + 1);
  }

  // Resolve prerequisite names to talent ids. A name may be shortened ("First Seal") or point into another tree.
  const everyTalent = data.patrons.flatMap((p) => p.trees.flatMap((t) => t.talents));
  const find = (name: string, own: TalentTree): Talent | undefined => {
    const wanted = name.toLowerCase();
    const match = (list: Talent[]) => list.find((t) => t.name.toLowerCase() === wanted) ?? list.find((t) => t.name.toLowerCase().startsWith(wanted));
    return match(own.talents) ?? match(everyTalent);
  };
  for (const p of data.patrons)
    for (const t of p.trees)
      for (const tal of t.talents) {
        let rest = tal.prereq.replace(/\(.*?\)/g, '');
        const any = /any\s+(\d+|one|two|three|four|five)\s+(?:other\s+)?talents?/i.exec(rest);
        if (any) {
          tal.anyOfTree = NUMBER_WORDS[any[1]!.toLowerCase()] ?? Number(any[1]);
          rest = rest.replace(/(?:and\s+)?any\s+\S+\s+(?:other\s+)?talents?(\s+(?:in|of)\s+this\s+tree)?/i, '');
        }
        for (const part of rest.split(/,|\band\b|&/i).map((s) => s.trim()).filter(Boolean)) {
          const hit = find(part, t);
          if (hit && hit.id !== tal.id && !tal.requires.includes(hit.id)) tal.requires.push(hit.id);
        }
      }

  return { data, picks, dmNotes: dmLines.join('\n').trim() };
}
