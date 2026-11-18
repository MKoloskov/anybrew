import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useBilingual } from '../lang';
import { trpc, type System } from '../trpc';
import { markNew } from './EntityEditor';
import { EmptyState } from './Icons';
import type { ListRow } from './Lists';

const KINDS = [
  { key: 'pc', title: 'PC' },
  { key: 'npc', title: 'NPC' },
  { key: 'aux', title: 'Aux' },
] as const;
type Kind = (typeof KINDS)[number]['key'];
type Tab = 'all' | Kind;

/** A character with no kind chosen counts as a PC when a player owns it, otherwise as an NPC. */
export const kindOf = (e: ListRow): Kind => (KINDS.find((k) => k.key === e.info.kind)?.key ?? (e.ownerId ? 'pc' : 'npc'));

/** What a viewer narrowed the list to. Kept per viewer in their own browser, one set per System. */
type Filters = { tab: Tab; tags: string[]; campaign: string; search: string };
const EMPTY: Filters = { tab: 'all', tags: [], campaign: '', search: '' };

function useFilters(systemId: string): [Filters, (change: Partial<Filters>) => void] {
  const key = `character-list:${systemId}`;
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Filters> | null;
      return { ...EMPTY, ...saved };
    } catch {
      return EMPTY;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(filters));
    } catch {
      /* private window or blocked storage: the filters just are not remembered */
    }
  }, [key, filters]);
  return [filters, (change) => setFilters((f) => ({ ...f, ...change }))];
}

/**
 * The character list: a full-width page of cards with All / PC / NPC / Aux tabs, a tag filter, the
 * campaign filter and a name search. A card opens the character's sheet. The DM chooses which
 * further fields every card shows, for everyone in the System.
 */
export function CharacterList({ system }: { system: System }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const bilingual = useBilingual();
  const isDm = system.role === 'dm';
  const list = trpc.entity.list.useQuery({ systemId: system.id, typeKey: 'character' }, { refetchInterval: 10_000 });
  const types = trpc.entity.types.useQuery({ systemId: system.id });
  const canCreate = types.data?.find((t) => t.key === 'character')?.canCreate ?? false;
  const [filters, setFilters] = useFilters(system.id);
  const [name, setName] = useState('');
  const [choosing, setChoosing] = useState(false);

  // A remembered campaign that no longer exists (or is no longer the viewer's) is ignored.
  const campaign = filters.campaign === 'none' || system.campaigns.some((c) => c.id === filters.campaign) ? filters.campaign : '';
  const chosenCampaign = system.campaigns.find((c) => c.id === campaign);

  const create = trpc.entity.create.useMutation({
    onSuccess: async ({ id }) => {
      setName('');
      markNew(id);
      await utils.entity.list.invalidate();
      // A new character opens on Basic Info, where its name, race and class are filled in.
      navigate(`/s/${system.id}/characters/${id}/basic`);
    },
  });

  const rows = list.data ?? [];
  // Tags are offered as chips only when some character the viewer may see has them.
  const tagsInUse = useMemo(
    () => [...new Set(rows.flatMap((e) => e.card?.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const tags = filters.tags.filter((t) => tagsInUse.includes(t));
  const q = filters.search.trim().toLowerCase();

  // Everything but the tab narrows the list; the tab counts are taken after that.
  const narrowed = rows.filter(
    (e) =>
      (campaign === '' ? true : campaign === 'none' ? !e.campaignIds.length : e.campaignIds.includes(campaign)) &&
      tags.every((t) => e.card?.tags.includes(t)) &&
      (!q || e.name.toLowerCase().includes(q) || !!e.nameRu?.toLowerCase().includes(q)),
  );
  const ofKind = (k: Kind) => narrowed.filter((e) => kindOf(e) === k).sort((a, b) => a.name.localeCompare(b.name));
  // PCs first, then NPCs, then Aux; alphabetical inside each.
  const groups = KINDS.map((k) => ({ ...k, rows: ofKind(k.key) })).filter((g) => filters.tab === 'all' || g.key === filters.tab);
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const isFiltered = campaign !== '' || tags.length > 0 || q !== '';

  const tabs: { key: Tab; title: string; count: number }[] = [
    { key: 'all', title: 'All', count: narrowed.length },
    ...KINDS.map((k) => ({ key: k.key, title: k.title, count: narrowed.filter((e) => kindOf(e) === k.key).length })),
  ];

  return (
    <div className="p-4" data-character-list>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="display mr-auto text-2xl">Characters</h1>
        {isDm && (
          <button type="button" className="btn" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
            Card fields…
          </button>
        )}
        {canCreate && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate({ systemId: system.id, typeKey: 'character', name, campaignIds: chosenCampaign ? [chosenCampaign.id] : [] });
            }}
          >
            <input className="input w-48" placeholder="New character…" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={!name.trim() || create.isPending}>
              Add
            </button>
          </form>
        )}
      </div>
      {chosenCampaign && canCreate && <p className="-mt-2 mb-3 text-right text-xs text-muted">New characters are filed under {chosenCampaign.name}.</p>}

      {isDm && choosing && <CardFieldChooser system={system} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-[3px] border border-line text-sm" role="group" aria-label="Kind of character">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              data-tab={t.key}
              aria-pressed={filters.tab === t.key}
              className={`cursor-pointer border-line px-3 py-1.5 not-first:border-l ${
                filters.tab === t.key ? 'bg-accent text-accent-ink' : 'bg-surface hover:bg-surface-2'
              }`}
              onClick={() => setFilters({ tab: t.key })}
            >
              {t.title} <span className={filters.tab === t.key ? '' : 'text-muted'}>{t.count}</span>
            </button>
          ))}
        </div>
        {system.campaigns.length > 0 && (
          <select
            className="input w-auto"
            aria-label="Campaign filter"
            value={campaign}
            onChange={(e) => setFilters({ campaign: e.target.value })}
          >
            <option value="">Everything</option>
            {system.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                Campaign: {c.name}
              </option>
            ))}
            <option value="none">Outside campaigns</option>
          </select>
        )}
        <input
          className="input min-w-40 flex-1 sm:max-w-72"
          type="search"
          placeholder="Search by name…"
          aria-label="Search characters"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
        {isFiltered && (
          <button type="button" className="cursor-pointer text-sm text-accent underline" onClick={() => setFilters({ campaign: '', tags: [], search: '' })}>
            Reset filters
          </button>
        )}
      </div>

      {tagsInUse.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
          <span className="mr-1 text-xs text-muted">Tags:</span>
          {tagsInUse.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                data-tag={t}
                className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs ${
                  on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface hover:bg-surface-2'
                }`}
                onClick={() => setFilters({ tags: on ? tags.filter((x) => x !== t) : [...tags, t] })}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      {list.data && rows.length === 0 && <EmptyState>No characters yet.</EmptyState>}
      {rows.length > 0 && shownCount === 0 && <EmptyState>Nothing matches.</EmptyState>}

      {groups.map(
        (g) =>
          g.rows.length > 0 && (
            <section key={g.key} className="mb-5" data-kind-group={g.key}>
              {/* On All the three kinds are told apart by a heading; a single kind needs none. */}
              {filters.tab === 'all' && (
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  {g.title} <span className="font-normal">{g.rows.length}</span>
                </h2>
              )}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
                {g.rows.map((e) => (
                  <CharacterCard key={e.id} system={system} row={e} bilingual={bilingual} />
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}

type CardProps = { system: System; row: ListRow; bilingual: (name: string, ru?: string | null) => string };

function CharacterCard({ system, row: e, bilingual }: CardProps) {
  const card = e.card;
  const memberName = (id: string | null) => system.members.find((m) => m.userId === id)?.displayName;
  const label = (key: string) => system.cardFieldOptions.find((o) => o.key === key)?.label ?? key;
  // The further fields the DM chose, in the order of the choice; empty or closed ones are left out.
  const lines = system.cardFields
    .map((key): [string, string | null] => {
      if (key === 'owner') return [key, e.ownerId ? (memberName(e.ownerId) ?? 'former member') : null];
      if (key === 'campaign') return [key, system.campaigns.filter((c) => e.campaignIds.includes(c.id)).map((c) => c.name).join(', ') || null];
      if (key === 'tags') return [key, card?.tags.length ? card.tags.join(', ') : null];
      const v = card?.values[key as keyof NonNullable<typeof card>['values']];
      return [key, v === null || v === undefined || v === '' ? null : String(v)];
    })
    .filter((l): l is [string, string] => l[1] !== null);

  return (
    <li data-entity={e.name}>
      <Link href={`/s/${system.id}/characters/${e.id}`} className="card flex h-full flex-col overflow-hidden hover:border-accent">
        <div className="portrait-frame aspect-square w-full bg-surface-2">
          {card?.portrait ? (
            <img src={`/api/file/${card.portrait}`} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="display flex h-full w-full items-center justify-center text-5xl text-muted" aria-hidden>
              {e.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-2.5">
          <span className="display text-base leading-tight" data-card-name>
            {bilingual(e.name, e.nameRu)}
          </span>
          {card?.allegiance && <span className="text-xs text-muted">{card.allegiance}</span>}
          {lines.length > 0 && (
            <dl className="mt-1 space-y-0.5 text-xs">
              {lines.map(([key, value]) => (
                <div key={key} className="flex gap-1" data-card-field={key}>
                  <dt className="text-muted">{label(key)}:</dt>
                  <dd className="min-w-0 truncate" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Link>
    </li>
  );
}

/** The DM's choice of further card fields: one choice for everyone in the System. */
function CardFieldChooser({ system }: { system: System }) {
  const utils = trpc.useUtils();
  const save = trpc.system.setCardFields.useMutation({
    onSuccess: async () => {
      await utils.system.get.invalidate({ systemId: system.id });
      await utils.entity.list.invalidate();
    },
  });
  // The tick shows at once; the saved choice from the server replaces it when it arrives.
  const saved = system.cardFields as string[];
  const [chosen, setChosen] = useState(saved);
  const savedKey = saved.join(',');
  useEffect(() => setChosen(savedKey ? savedKey.split(',') : []), [savedKey]);
  const toggle = (key: string) => {
    const next = chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key];
    setChosen(next);
    save.mutate({ systemId: system.id, fields: next as typeof system.cardFields });
  };
  return (
    <fieldset className="card mb-4 p-3" data-card-fields>
      <legend className="px-1 text-sm font-medium">Card fields</legend>
      <p className="mb-2 text-xs text-muted">
        Every card shows the portrait, name and allegiance. Tick what else the cards show, for everyone. A viewer sees a value only where they may see the field.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {system.cardFieldOptions.map((o) => (
          <label key={o.key} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" className="accent-accent" checked={chosen.includes(o.key)} onChange={() => toggle(o.key)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
