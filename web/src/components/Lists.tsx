import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { isClassFeature, plural } from '../features';
import { useBilingual } from '../lang';
import { trpc, type Out, type System } from '../trpc';

export type ListRow = Out['entity']['list'][number];

/** A folder of a list: a heading that opens and closes. Open or closed is remembered per browser. */
function Folder(props: { id: string; title: string; count: number; depth?: number; children: React.ReactNode }) {
  const key = `folder-open:${props.id}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '0');
  const toggle = () => {
    localStorage.setItem(key, open ? '0' : '1');
    setOpen(!open);
  };
  return (
    <div className={props.depth ? 'ml-3' : ''} data-folder={props.title}>
      <button
        type="button"
        className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left ${
          props.depth ? 'text-xs font-semibold tracking-wide text-muted uppercase' : 'text-sm font-semibold'
        } hover:bg-surface-2`}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="w-3 text-xs text-muted">{open ? '▼' : '▶'}</span>
        {props.title}
        <span className="font-normal text-muted">{props.count}</span>
      </button>
      {open && <div className="mb-1">{props.children}</div>}
    </div>
  );
}

// ---------- Characters: campaign, then PC / NPC / Aux ----------

const KINDS = [
  { key: 'pc', title: 'PC' },
  { key: 'npc', title: 'NPC' },
  { key: 'aux', title: 'Aux' },
];
/** A character with no kind chosen counts as a PC when a player owns it, otherwise as an NPC. */
export const kindOf = (e: ListRow) => (KINDS.some((k) => k.key === e.info.kind) ? e.info.kind! : e.ownerId ? 'pc' : 'npc');

type CharacterFoldersProps = {
  system: System;
  rows: ListRow[];
  /** A campaign id narrows the list to that campaign, 'none' to characters outside campaigns, '' shows all. */
  filter: string;
  renderRow: (e: ListRow) => React.ReactNode;
};

/**
 * Characters filed by campaign, and inside a campaign by PC, NPC and Aux.
 * A character of several campaigns is listed under each of them.
 */
export function CharacterFolders({ system, rows, filter, renderRow }: CharacterFoldersProps) {
  const byKind = (list: ListRow[], id: string, depth: number) =>
    KINDS.map((k) => {
      const mine = list.filter((e) => kindOf(e) === k.key);
      if (!mine.length) return null;
      return (
        <Folder key={k.key} id={`${id}:${k.key}`} title={k.title} count={mine.length} depth={depth}>
          <ul className="space-y-1">{mine.map(renderRow)}</ul>
        </Folder>
      );
    });

  // Without campaigns there is nothing to file under, so the list is PC / NPC / Aux only.
  if (!system.campaigns.length) return <div className="space-y-1">{byKind(rows, 'characters', 0)}</div>;

  const sections = [
    ...system.campaigns.map((c) => ({ id: c.id, title: c.name, list: rows.filter((e) => e.campaignIds.includes(c.id)) })),
    { id: 'none', title: 'No campaign', list: rows.filter((e) => !e.campaignIds.length) },
  ].filter((s) => (filter ? s.id === filter : s.list.length > 0));

  return (
    <div className="space-y-2">
      {sections.map((s) => (
        <Folder key={s.id} id={`characters:${s.id}`} title={s.title} count={s.list.length}>
          {s.list.length ? byKind(s.list, `characters:${s.id}`, 1) : <p className="muted ml-6">Nobody here.</p>}
        </Folder>
      ))}
    </div>
  );
}

// ---------- Features: a table with search, filters and sorting, or folders ----------

type SortKey = 'name' | 'ftype' | 'class' | 'tier' | 'holders';
const COLUMNS: { key: SortKey; title: string; className: string }[] = [
  { key: 'name', title: 'Name', className: '' },
  { key: 'ftype', title: 'Type', className: 'w-24' },
  { key: 'class', title: 'Class', className: 'w-20' },
  { key: 'tier', title: 'Lvl', className: 'w-10 text-right' },
  { key: 'holders', title: 'Characters', className: 'w-28' },
];
const NONE = '(none)';

type FeatureBrowserProps = { system: System; rows: ListRow[]; selectedId?: string; href: (id: string) => string };

/**
 * The feature library as a table: search, filters by type, class and character, sorting by any
 * column. The chosen feature opens beside the table. "Folders" shows the same features as
 * Class features → class → features, with every other type as its own folder.
 */
export function FeatureBrowser({ system, rows, selectedId, href }: FeatureBrowserProps) {
  const [, navigate] = useLocation();
  const bilingual = useBilingual();
  const characters = trpc.entity.list.useQuery({ systemId: system.id, typeKey: 'character' }, { refetchInterval: 10_000 });
  const [view, setView] = useState<'table' | 'folders'>(() => (localStorage.getItem('features-view') === 'folders' ? 'folders' : 'table'));
  const [search, setSearch] = useState('');
  const [fType, setFType] = useState('');
  const [fClass, setFClass] = useState('');
  const [fCharacter, setFCharacter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: 'name', down: false });

  const characterName = useMemo(() => new Map((characters.data ?? []).map((c) => [c.id, c.name])), [characters.data]);
  const holders = (e: ListRow) =>
    e.holderIds
      .map((id) => characterName.get(id))
      .filter((n): n is string => !!n)
      .sort();
  const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const types = distinct(rows.map((e) => e.info.ftype));
  const classes = distinct(rows.map((e) => e.info.class));
  const holderOptions = (characters.data ?? []).filter((c) => rows.some((e) => e.holderIds.includes(c.id)));

  const q = search.trim().toLowerCase();
  const pick = (wanted: string, value: string | null) => wanted === '' || (wanted === NONE ? !value : value === wanted);
  const shown = rows.filter(
    (e) =>
      pick(fType, e.info.ftype) &&
      pick(fClass, e.info.class) &&
      (fCharacter === '' || e.holderIds.includes(fCharacter)) &&
      (!q || [e.name, e.nameRu, e.info.ftype, e.info.class].some((t) => t?.toLowerCase().includes(q))),
  );
  const filtered = shown.length !== rows.length;

  const sortValue = (e: ListRow): string | number =>
    sort.key === 'name' ? e.name : sort.key === 'tier' ? (e.info.tier ?? -1) : sort.key === 'holders' ? holders(e).join(', ') : (e.info[sort.key] ?? '');
  const compare = (a: string | number, b: string | number) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
  // Empty cells go last whichever way the column is sorted.
  const sorted = [...shown].sort((a, b) => {
    const [x, y] = [sortValue(a), sortValue(b)];
    const [emptyX, emptyY] = [x === '' || x === -1, y === '' || y === -1];
    if (emptyX !== emptyY) return emptyX ? 1 : -1;
    return (sort.down ? -1 : 1) * compare(x, y) || a.name.localeCompare(b.name);
  });

  const select = (label: string, value: string, set: (v: string) => void, options: { value: string; label: string }[], withNone: boolean) => (
    <select className="input w-auto min-w-0 flex-1 px-2 py-1 text-xs" aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {withNone && <option value={NONE}>{label}: none</option>}
    </select>
  );
  const same = (v: string) => ({ value: v, label: v });

  const folderRow = (e: ListRow) => (
    <li key={e.id}>
      <Link
        href={href(e.id)}
        className={`block rounded-md px-2 py-1 text-sm ${e.id === selectedId ? 'bg-accent/15' : 'hover:bg-surface-2'}`}
      >
        {e.info.tier !== null && <span className="mr-1 text-xs text-muted">[{e.info.tier}]</span>}
        {bilingual(e.name, e.nameRu)}
        {!isClassFeature(e.info.ftype) && e.info.class && <span className="ml-1 text-xs text-muted">· {e.info.class}</span>}
        {e.info.subclass && <span className="ml-1 text-xs text-muted">· {e.info.subclass}</span>}
      </Link>
    </li>
  );
  const byLevel = (list: ListRow[]) => [...list].sort((a, b) => (a.info.tier ?? 0) - (b.info.tier ?? 0) || a.name.localeCompare(b.name));
  const classFeatures = shown.filter((e) => isClassFeature(e.info.ftype));
  const otherTypes = distinct(shown.filter((e) => !isClassFeature(e.info.ftype)).map((e) => e.info.ftype));
  const untyped = shown.filter((e) => !e.info.ftype);

  return (
    <div data-features={view}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1 px-2 py-1"
          type="search"
          placeholder="Search features…"
          aria-label="Search features"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex overflow-hidden rounded-md border border-line text-xs">
          {(['table', 'folders'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`cursor-pointer px-2 py-1 ${view === v ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`}
              aria-pressed={view === v}
              onClick={() => {
                localStorage.setItem('features-view', v);
                setView(v);
              }}
            >
              {v === 'table' ? 'Table' : 'Folders'}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        {select('Type', fType, setFType, types.map(same), true)}
        {select('Class', fClass, setFClass, classes.map(same), true)}
        {select('Character', fCharacter, setFCharacter, holderOptions.map((c) => ({ value: c.id, label: c.name })), false)}
      </div>
      <p className="mb-1 flex items-center gap-2 text-xs text-muted">
        {filtered ? `${shown.length} of ${rows.length} features` : `${rows.length} features`}
        {filtered && (
          <button
            type="button"
            className="cursor-pointer text-accent underline"
            onClick={() => {
              setSearch('');
              setFType('');
              setFClass('');
              setFCharacter('');
            }}
          >
            Reset filters
          </button>
        )}
      </p>

      {view === 'table' ? (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              {COLUMNS.map((c) => (
                <th key={c.key} className={`p-0 font-semibold ${c.className}`} aria-sort={sort.key === c.key ? (sort.down ? 'descending' : 'ascending') : undefined}>
                  <button
                    type="button"
                    className="w-full cursor-pointer px-1 py-1 text-inherit hover:text-fg"
                    style={{ textAlign: 'inherit' }}
                    onClick={() => setSort({ key: c.key, down: sort.key === c.key ? !sort.down : false })}
                  >
                    {c.title}
                    {sort.key === c.key ? (sort.down ? ' ▼' : ' ▲') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const who = holders(e);
              return (
                <tr
                  key={e.id}
                  data-feature={e.name}
                  className={`cursor-pointer border-b border-line ${
                    e.id === selectedId ? 'bg-accent/15' : 'hover:bg-surface-2'
                  }`}
                  onClick={() => navigate(href(e.id))}
                >
                  <td className="truncate px-1 py-1 font-medium">
                    <Link href={href(e.id)}>{bilingual(e.name, e.nameRu)}</Link>
                  </td>
                  <td className="truncate px-1 py-1 text-xs text-muted">{e.info.ftype ?? ''}</td>
                  <td className="truncate px-1 py-1 text-xs text-muted">{e.info.class ?? ''}</td>
                  <td className="px-1 py-1 text-right text-xs">{e.info.tier ?? ''}</td>
                  <td className="truncate px-1 py-1 text-xs text-muted" title={who.join(', ')}>
                    {who.map((n) => n.split(' ')[0]).join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="space-y-1">
          {classFeatures.length > 0 && (
            <Folder id="features:class" title="Class features" count={classFeatures.length}>
              {[...distinct(classFeatures.map((e) => e.info.class)), ...(classFeatures.some((e) => !e.info.class) ? [NONE] : [])].map((cls) => {
                const list = classFeatures.filter((e) => (cls === NONE ? !e.info.class : e.info.class === cls));
                return (
                  <Folder key={cls} id={`features:class:${cls}`} title={cls === NONE ? 'No class' : cls} count={list.length} depth={1}>
                    <ul className="ml-3">{byLevel(list).map(folderRow)}</ul>
                  </Folder>
                );
              })}
            </Folder>
          )}
          {otherTypes.map((t) => {
            const list = shown.filter((e) => e.info.ftype === t);
            return (
              <Folder key={t} id={`features:type:${t}`} title={plural(t)} count={list.length}>
                <ul className="ml-3">{byLevel(list).map(folderRow)}</ul>
              </Folder>
            );
          })}
          {untyped.length > 0 && (
            <Folder id="features:untyped" title="No type" count={untyped.length}>
              <ul className="ml-3">{byLevel(untyped).map(folderRow)}</ul>
            </Folder>
          )}
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="muted mt-2">Nothing matches.</p>}
    </div>
  );
}
