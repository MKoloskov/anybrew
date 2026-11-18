import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Centered } from '../App';
import { ClassImport } from '../components/Classes';
import { EntityEditor, markNew } from '../components/EntityEditor';
import { CharacterFolders, FeatureBrowser, type ListRow } from '../components/Lists';
import { LangProvider, useBilingual, type Lang } from '../lang';
import { ENTITY_TABS, type EntityTabDef } from '../tabs';
import { useTheme, type ThemeChoice } from '../theme';
import { trpc, type System } from '../trpc';
import { DataTab } from './Data';
import { PeopleTab } from './People';

type Props = { systemId: string; tab: string; entityId?: string; user: { id: string; displayName: string; language: Lang } };

export function SystemPage({ systemId, tab, entityId, user }: Props) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [theme, setTheme] = useTheme();
  // Polling stands in for live updates until phase 5: other people's changes appear within 10 seconds.
  const system = trpc.system.get.useQuery({ systemId }, { refetchInterval: 10_000 });
  const systems = trpc.system.list.useQuery();
  const createSystem = trpc.system.create.useMutation({
    onSuccess: async ({ systemId: id }) => {
      await utils.system.list.invalidate();
      navigate(`/s/${id}`);
    },
  });
  const setLanguage = trpc.auth.setLanguage.useMutation({ onSuccess: () => utils.auth.status.invalidate() });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      navigate('/');
      await utils.invalidate();
    },
  });

  if (system.error) return <Centered>This system does not exist, or you are not a member of it.</Centered>;
  if (!system.data) return <Centered>Loading…</Centered>;
  const c = system.data;
  const isDm = c.role === 'dm';
  const tabs = [
    ...ENTITY_TABS.map((t) => ({ key: t.key, label: t.label })),
    { key: 'people', label: 'People' },
    ...(isDm ? [{ key: 'data', label: 'Data' }] : []),
  ];

  return (
    <LangProvider lang={user.language} systemId={systemId}>
    <div className="flex min-h-dvh flex-col">
      <header className="bar border-b border-accent bg-bar text-bar-fg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-2.5">
        {systems.data && systems.data.length > 1 ? (
          <select className="input display mb-2.5 w-auto text-base" value={c.id} onChange={(e) => navigate(`/s/${e.target.value}`)}>
            {systems.data.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="display mb-2.5 text-xl">{c.name}</h1>
        )}
        {isDm && (
          <button
            className="btn mb-2.5 px-2 py-0.5 text-xs"
            title="A system is a separate rule set with its own content, for example a different game"
            onClick={() => {
              const name = prompt('Name of the new system (a separate rule set with its own content):');
              if (name?.trim()) createSystem.mutate({ name });
            }}
          >
            + System
          </button>
        )}
        <nav className="flex flex-wrap gap-x-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/s/${c.id}/${t.key}`}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`border-b-2 px-3 pt-1.5 pb-2.5 text-sm font-medium ${
                tab === t.key ? 'border-accent text-bar-fg' : 'border-transparent text-bar-fg/70 hover:text-bar-fg'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="mb-2.5 ml-auto flex flex-wrap items-center gap-3 text-sm">
          <span className="text-bar-fg/70">
            {user.displayName} · {isDm ? 'DM' : 'player'}
          </span>
          <select
            className="input w-auto"
            aria-label="Reading language"
            title="Reading language: Russian adds Russian names and labels and shows translated texts"
            value={user.language}
            onChange={(e) => setLanguage.mutate({ language: e.target.value as Lang })}
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
          <select
            className="input w-auto"
            aria-label="Light or dark mode"
            title="Light or dark mode, kept on this device. System follows the device setting."
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <button className="btn" onClick={() => logout.mutate()}>
            Log out
          </button>
        </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">

      {tab === 'people' ? (
        <PeopleTab system={c} userId={user.id} />
      ) : tab === 'data' && isDm ? (
        <DataTab system={c} />
      ) : (
        <EntityTab
          key={tab}
          system={c}
          entityId={entityId}
          def={ENTITY_TABS.find((t) => t.key === tab) ?? ENTITY_TABS[0]!}
        />
      )}
      </div>
    </div>
    </LangProvider>
  );
}

type EntityTabProps = { system: System; entityId?: string; def: EntityTabDef };

function EntityTab({ system, entityId, def }: EntityTabProps) {
  const { key: tab, typeKey, noun, plural } = def;
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const list = trpc.entity.list.useQuery({ systemId: system.id, typeKey }, { refetchInterval: 10_000 });
  const [name, setName] = useState('');
  const create = trpc.entity.create.useMutation({
    onSuccess: async ({ id }) => {
      setName('');
      markNew(id);
      await utils.entity.list.invalidate();
      navigate(`/s/${system.id}/${tab}/${id}`);
    },
  });
  const types = trpc.entity.types.useQuery({ systemId: system.id });
  const canCreate = types.data?.find((t) => t.key === typeKey)?.canCreate ?? false;
  const bilingual = useBilingual();
  const memberName = (id: string | null) => system.members.find((m) => m.userId === id)?.displayName;
  // The campaign filter only narrows the list. '' shows everything, 'none' what is outside campaigns.
  const [filter, setFilter] = useState('');
  const chosen = system.campaigns.find((c) => c.id === filter);
  const shown = list.data?.filter((e) => (filter === '' ? true : filter === 'none' ? !e.campaignIds.length : e.campaignIds.includes(filter)));
  const campaignNames = (ids: string[]) => system.campaigns.filter((c) => ids.includes(c.id)).map((c) => c.name).join(', ');

  const href = (id: string) => `/s/${system.id}/${tab}/${id}`;
  const row = (e: ListRow) => (
    <li key={e.id} data-entity={e.name}>
      <Link
        href={href(e.id)}
        className={`block rounded-md px-3 py-2 text-sm ${e.id === entityId ? 'bg-accent/15' : 'hover:bg-surface-2'}`}
      >
        <span className="font-medium">{bilingual(e.name, e.nameRu)}</span>
        <span className="block text-xs text-muted">
          {e.isClass && 'Class · '}
          {e.dmOnly ? 'DM only' : e.ownerId ? `Owner: ${memberName(e.ownerId) ?? 'former member'}` : 'Shared'}
          {e.campaignIds.length > 0 && ` · ${campaignNames(e.campaignIds)}`}
        </span>
      </Link>
    </li>
  );

  return (
    // The feature table needs more room than a list of names.
    <div className={`grid flex-1 ${typeKey === 'feature' ? 'md:grid-cols-[22rem_1fr] lg:grid-cols-[34rem_1fr]' : 'md:grid-cols-[18rem_1fr]'}`}>
      {/* On a phone the list and the editor are separate screens. */}
      <aside className={`border-line p-4 md:border-r ${entityId ? 'hidden md:block' : ''}`}>
        {canCreate && (
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate({ systemId: system.id, typeKey, name, campaignIds: chosen ? [chosen.id] : [] });
            }}
          >
            <input className="input" placeholder={`New ${noun}…`} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={!name.trim() || create.isPending}>
              Add
            </button>
          </form>
        )}
        {typeKey === 'rule' && system.role === 'dm' && <ClassImport systemId={system.id} onImported={(id) => navigate(href(id))} />}
        {system.campaigns.length > 0 && (
          <div className="mb-3">
            <select className="input" aria-label="Campaign filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Everything</option>
              {system.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  Campaign: {c.name}
                </option>
              ))}
              <option value="none">Outside campaigns</option>
            </select>
            {chosen && <p className="mt-1 text-xs text-muted">New {plural} are filed under {chosen.name}.</p>}
          </div>
        )}
        {list.data?.length === 0 && <p className="muted">No {plural} yet.</p>}
        {list.data && list.data.length > 0 && shown?.length === 0 && <p className="muted">Nothing here.</p>}
        {typeKey === 'character' ? (
          <CharacterFolders system={system} rows={shown ?? []} filter={filter} renderRow={row} />
        ) : typeKey === 'feature' ? (
          <FeatureBrowser system={system} rows={shown ?? []} selectedId={entityId} href={href} />
        ) : (
          <ul className="space-y-1">{shown?.map(row)}</ul>
        )}
      </aside>
      <main className={`min-w-0 ${entityId ? '' : 'hidden md:block'}`}>
        {entityId ? (
          <EntityEditor key={entityId} entityId={entityId} system={system} noun={noun} onClose={() => navigate(`/s/${system.id}/${tab}`)} />
        ) : (
          <p className="muted p-6">
            Choose a {noun}, or add one.
          </p>
        )}
      </main>
    </div>
  );
}
