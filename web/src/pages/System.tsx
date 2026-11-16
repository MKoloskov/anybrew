import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Centered } from '../App';
import { EntityEditor } from '../components/EntityEditor';
import { trpc, type System } from '../trpc';
import { DataTab } from './Data';
import { PeopleTab } from './People';

type Props = { systemId: string; tab: string; entityId?: string; user: { id: string; displayName: string } };

export function SystemPage({ systemId, tab, entityId, user }: Props) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  // Polling stands in for live updates until phase 5: other people's changes appear within 10 seconds.
  const system = trpc.system.get.useQuery({ systemId }, { refetchInterval: 10_000 });
  const systems = trpc.system.list.useQuery();
  const createSystem = trpc.system.create.useMutation({
    onSuccess: async ({ systemId: id }) => {
      await utils.system.list.invalidate();
      navigate(`/s/${id}`);
    },
  });
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
    { key: 'characters', label: 'Characters' },
    { key: 'rules', label: 'Rules' },
    { key: 'notes', label: 'Notes' },
    { key: 'people', label: 'People' },
    ...(isDm ? [{ key: 'data', label: 'Data' }] : []),
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        {systems.data && systems.data.length > 1 ? (
          <select className="input w-auto text-base font-semibold" value={c.id} onChange={(e) => navigate(`/s/${e.target.value}`)}>
            {systems.data.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="text-lg font-semibold">{c.name}</h1>
        )}
        {isDm && (
          <button
            className="btn px-2 py-0.5 text-xs"
            title="A system is a separate rule set with its own content, for example a different game"
            onClick={() => {
              const name = prompt('Name of the new system (a separate rule set with its own content):');
              if (name?.trim()) createSystem.mutate({ name });
            }}
          >
            + System
          </button>
        )}
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/s/${c.id}/${t.key}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? 'bg-sky-700 text-white' : 'hover:bg-stone-200 dark:hover:bg-stone-800'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="muted">
            {user.displayName} · {isDm ? 'DM' : 'player'}
          </span>
          <button className="btn" onClick={() => logout.mutate()}>
            Log out
          </button>
        </div>
      </header>

      {tab === 'people' ? (
        <PeopleTab system={c} userId={user.id} />
      ) : tab === 'data' && isDm ? (
        <DataTab system={c} />
      ) : (
        <EntityTab
          key={tab}
          system={c}
          entityId={entityId}
          {...(tab === 'notes'
            ? { tab: 'notes', typeKey: 'note', noun: 'note', plural: 'notes' }
            : tab === 'rules'
              ? { tab: 'rules', typeKey: 'rule', noun: 'rule', plural: 'rules' }
            : { tab: 'characters', typeKey: 'character', noun: 'character', plural: 'characters' })}
        />
      )}
    </div>
  );
}

type EntityTabProps = { system: System; entityId?: string; tab: string; typeKey: string; noun: string; plural: string };

function EntityTab({ system, entityId, tab, typeKey, noun, plural }: EntityTabProps) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const list = trpc.entity.list.useQuery({ systemId: system.id, typeKey }, { refetchInterval: 10_000 });
  const [name, setName] = useState('');
  const create = trpc.entity.create.useMutation({
    onSuccess: async ({ id }) => {
      setName('');
      await utils.entity.list.invalidate();
      navigate(`/s/${system.id}/${tab}/${id}`);
    },
  });
  const types = trpc.entity.types.useQuery({ systemId: system.id });
  const canCreate = types.data?.find((t) => t.key === typeKey)?.canCreate ?? false;
  const memberName = (id: string | null) => system.members.find((m) => m.userId === id)?.displayName;
  // The campaign filter only narrows the list. '' shows everything, 'none' what is outside campaigns.
  const [filter, setFilter] = useState('');
  const chosen = system.campaigns.find((c) => c.id === filter);
  const shown = list.data?.filter((e) => (filter === '' ? true : filter === 'none' ? !e.campaignIds.length : e.campaignIds.includes(filter)));
  const campaignNames = (ids: string[]) => system.campaigns.filter((c) => ids.includes(c.id)).map((c) => c.name).join(', ');

  return (
    <div className="grid flex-1 md:grid-cols-[18rem_1fr]">
      {/* On a phone the list and the editor are separate screens. */}
      <aside className={`border-stone-200 p-4 md:border-r dark:border-stone-800 ${entityId ? 'hidden md:block' : ''}`}>
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
            {chosen && <p className="mt-1 text-xs text-stone-500">New {plural} are filed under {chosen.name}.</p>}
          </div>
        )}
        {list.data?.length === 0 && <p className="muted">No {plural} yet.</p>}
        {list.data && list.data.length > 0 && shown?.length === 0 && <p className="muted">Nothing here.</p>}
        <ul className="space-y-1">
          {shown?.map((e) => (
            <li key={e.id}>
              <Link
                href={`/s/${system.id}/${tab}/${e.id}`}
                className={`block rounded-md px-3 py-2 text-sm ${
                  e.id === entityId ? 'bg-sky-100 dark:bg-sky-950' : 'hover:bg-stone-200 dark:hover:bg-stone-800'
                }`}
              >
                <span className="font-medium">{e.name}</span>
                <span className="block text-xs text-stone-500">
                  {e.dmOnly ? 'DM only' : e.ownerId ? `Owner: ${memberName(e.ownerId) ?? 'former member'}` : 'Shared'}
                  {e.campaignIds.length > 0 && ` · ${campaignNames(e.campaignIds)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <main className={entityId ? '' : 'hidden md:block'}>
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
