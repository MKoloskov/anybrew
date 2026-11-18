import { trpc, type Entity } from '../trpc';
import { Label, useBilingual } from '../lang';
import { D20 } from './Icons';
import type { ClassPick } from './Classes';

/** The main portrait in its engraved brass frame, or the first letter of the name in the same frame. */
export function FramedPortrait({ fileId, name, className }: { fileId: unknown; name: string; className: string }) {
  return (
    <div className={`portrait-frame shrink-0 overflow-hidden rounded-sm bg-surface-2 ${className}`} data-portrait>
      {typeof fileId === 'string' && fileId ? (
        <img src={`/api/file/${fileId}`} alt={`Portrait of ${name}`} className="h-full w-full object-cover" />
      ) : (
        <span className="display flex h-full w-full items-center justify-center text-muted" style={{ fontSize: '2.5em' }} aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

/** A thin rule with a small d20 in its middle, between the main parts of a sheet. */
export function D20Divider() {
  return (
    <div className="my-4 flex items-center gap-3 text-accent" role="separator" data-d20-divider>
      <span className="h-px flex-1 bg-line" />
      <D20 className="size-4 opacity-80" />
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

const ABILITIES = [
  ['str', 'STR', 'Strength'],
  ['dex', 'DEX', 'Dexterity'],
  ['con', 'CON', 'Constitution'],
  ['int', 'INT', 'Intelligence'],
  ['wis', 'WIS', 'Wisdom'],
  ['cha', 'CHA', 'Charisma'],
] as const;

// Numbers are set in the text font: the heading font draws the digit 0 like the letter O.
const signed = (n: unknown) => (typeof n === 'number' ? (n >= 0 ? `+${n}` : `${n}`) : '–');
const plain = (n: unknown) => (n === null || n === undefined || n === '' ? '–' : String(n));

/**
 * Home, first version (PLAN.md section 10.2): class and level, AC, HP and initiative, the six
 * abilities and the tags. It stores nothing: every value is a field of another page, and a value
 * this viewer may not see is simply not there.
 */
export function HomeSummary({ entity: e }: { entity: Entity }) {
  const has = (id: string) => id in e.values || hasField(e, id);
  const v = e.values;
  const bilingual = useBilingual();
  const classInfo = trpc.entity.classInfo.useQuery({ id: e.id }, { enabled: has('classes') });
  const picks = Array.isArray(v.classes) ? (v.classes as ClassPick[]) : [];
  const classLine = picks
    .map((p) => {
      const c = classInfo.data?.find((x) => x.classId === p.classId);
      if (!c?.found) return null;
      return `${bilingual(c.name, c.nameRu)} ${p.level}${p.subclass ? ` (${p.subclass})` : ''}`;
    })
    .filter(Boolean)
    .join(' / ');
  const classText = classLine || (typeof v.class === 'string' ? v.class : '');
  const tags = Array.isArray(v.tags) ? (v.tags as string[]) : [];

  const tiles = [
    has('level') && { key: 'level', label: 'Level', value: plain(v.level) },
    has('ac') && { key: 'ac', label: 'Armor Class', value: plain(v.ac) },
    has('hp') && {
      key: 'hp',
      label: 'Hit Points',
      value: `${plain(v.hp)} / ${plain(v.hp_max)}`,
      note: typeof v.hp_temp === 'number' && v.hp_temp ? `+${v.hp_temp} temp` : undefined,
    },
    has('initiative') && { key: 'initiative', label: 'Initiative', value: signed(v.initiative) },
    has('prof_bonus') && { key: 'prof_bonus', label: 'Proficiency', value: signed(v.prof_bonus) },
  ].filter((t): t is { key: string; label: string; value: string; note?: string } => !!t);

  return (
    <div data-home>
      {(classText || has('classes')) && (
        <p className="mb-4 text-lg" data-home-class>
          {classText || <span className="muted">No class chosen yet.</span>}
        </p>
      )}
      {tiles.length > 0 && (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.key} className="card border-t-2 border-t-accent px-3 py-2 text-center" data-tile={t.key}>
              <dt className="text-xs text-muted">{t.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{t.value}</dd>
              {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
            </div>
          ))}
        </dl>
      )}
      {ABILITIES.some(([id]) => has(id)) && (
        <dl className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {ABILITIES.filter(([id]) => has(id)).map(([id, short, long]) => (
            <div key={id} className="card px-2 py-2 text-center" data-ability={id} title={long}>
              <dt className="display text-sm text-muted">
                <Label text={short} />
              </dt>
              <dd className="text-2xl leading-tight font-semibold tabular-nums">{signed(v[`${id}_mod`])}</dd>
              <dd className="text-sm text-muted">{plain(v[id])}</dd>
            </div>
          ))}
        </dl>
      )}
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((t) => (
            <li key={t} className="rounded-sm border border-line bg-surface px-2 py-0.5 text-xs" data-home-tag={t}>
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** True when the viewer received this field in the sheet, even if it holds nothing yet. */
export function hasField(e: Entity, id: string): boolean {
  type N = { kind: string; id: string; children?: N[] };
  const walk = (nodes: N[]): boolean => nodes.some((n) => (n.kind === 'field' ? n.id === id : walk(n.children ?? [])));
  return walk(e.schema.groups as N[]);
}
