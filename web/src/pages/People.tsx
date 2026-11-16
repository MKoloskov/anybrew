import { useState } from 'react';
import { trpc, type System } from '../trpc';

type Campaign = System['campaigns'][number];
type Party = System['parties'][number];

export function PeopleTab({ system, userId }: { system: System; userId: string }) {
  const isDm = system.role === 'dm';
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <Members system={system} userId={userId} />
      <Campaigns system={system} />
      {isDm && <Invites system={system} />}
    </div>
  );
}

function Members({ system, userId }: { system: System; userId: string }) {
  const utils = trpc.useUtils();
  const isDm = system.role === 'dm';
  const refresh = () => utils.system.get.invalidate();
  const remove = trpc.system.removeMember.useMutation({ onSuccess: refresh });
  const reset = trpc.system.resetPassword.useMutation({
    onSuccess: () => alert('The new password is set. The player has been logged out everywhere.'),
    onError: (e) => alert(`Not changed: ${e.message}`),
  });
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Members</h2>
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {system.members.map((m) => {
          const inCampaigns = system.campaigns.filter((c) => c.memberIds.includes(m.userId)).map((c) => c.name);
          return (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-medium">{m.displayName}</span> <span className="muted">· {m.role === 'dm' ? 'DM' : 'player'}</span>
                {m.username && <div className="text-xs text-stone-500">login: {m.username}</div>}
                {m.role === 'player' && (
                  <div className="text-xs text-stone-500">{inCampaigns.length ? inCampaigns.join(', ') : 'in no campaign'}</div>
                )}
              </div>
              {isDm && m.role === 'player' && (
                <div className="flex gap-2">
                  <button
                    className="btn px-2 py-0.5 text-xs"
                    onClick={() => {
                      const newPassword = prompt(`New password for ${m.displayName} (at least 8 characters):`);
                      if (newPassword) reset.mutate({ systemId: system.id, userId: m.userId, newPassword });
                    }}
                  >
                    Set password
                  </button>
                  <button
                    className="btn btn-danger px-2 py-0.5 text-xs"
                    onClick={() => {
                      if (confirm(`Remove ${m.displayName} from the system and all its campaigns? Their notes stay.`))
                        remove.mutate({ systemId: system.id, userId: m.userId });
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              {m.userId === userId && <span className="muted text-xs">you</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Campaigns({ system }: { system: System }) {
  const utils = trpc.useUtils();
  const isDm = system.role === 'dm';
  const create = trpc.system.createCampaign.useMutation({ onSuccess: () => utils.system.get.invalidate() });
  const [name, setName] = useState('');
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-semibold">Campaigns</h2>
      <p className="muted mb-3">
        {isDm
          ? 'A campaign is a group of players. Whatever is filed under a campaign is closed to players of other campaigns. Rules, items and spells stay outside campaigns.'
          : 'The campaigns you play in.'}
      </p>
      {system.campaigns.length === 0 && <p className="muted mb-3">No campaigns yet.</p>}
      {system.campaigns.map((c) => (
        <CampaignCard key={c.id} system={system} campaign={c} />
      ))}
      {isDm && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ systemId: system.id, name }, { onSuccess: () => setName('') });
          }}
        >
          <input className="input" placeholder="New campaign name…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim()}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}

function CampaignCard({ system, campaign }: { system: System; campaign: Campaign }) {
  const utils = trpc.useUtils();
  const isDm = system.role === 'dm';
  const refresh = () => utils.system.get.invalidate();
  const update = trpc.system.updateCampaign.useMutation({ onSuccess: refresh });
  const remove = trpc.system.deleteCampaign.useMutation({ onSuccess: refresh, onError: (e) => alert(`Not deleted: ${e.message}`) });
  const createParty = trpc.system.createParty.useMutation({ onSuccess: refresh });
  const [partyName, setPartyName] = useState('');
  const players = system.members.filter((m) => m.role === 'player');
  const campaignPlayers = players.filter((m) => campaign.memberIds.includes(m.userId));
  const parties = system.parties.filter((p) => p.campaignId === campaign.id);

  return (
    <div className="mb-3 rounded-md border border-stone-200 p-3 text-sm dark:border-stone-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">{campaign.name}</span>
        {isDm && (
          <div className="flex gap-2">
            <button
              className="btn px-2 py-0.5 text-xs"
              onClick={() => {
                const next = prompt('Campaign name:', campaign.name);
                if (next?.trim()) update.mutate({ systemId: system.id, campaignId: campaign.id, name: next });
              }}
            >
              Rename
            </button>
            <button
              className="btn btn-danger px-2 py-0.5 text-xs"
              onClick={() => confirm(`Delete campaign ${campaign.name} and its parties?`) && remove.mutate({ systemId: system.id, campaignId: campaign.id })}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="label">Players</div>
      {isDm ? (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
          {players.map((m) => {
            const inside = campaign.memberIds.includes(m.userId);
            return (
              <label key={m.userId} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={inside}
                  onChange={() =>
                    update.mutate({
                      systemId: system.id,
                      campaignId: campaign.id,
                      memberIds: inside ? campaign.memberIds.filter((x) => x !== m.userId) : [...campaign.memberIds, m.userId],
                    })
                  }
                />
                {m.displayName}
              </label>
            );
          })}
          {!players.length && <span className="muted">Invite players first.</span>}
        </div>
      ) : (
        <p className="muted mb-3">{campaignPlayers.map((m) => m.displayName).join(', ') || 'Nobody yet'}</p>
      )}

      <div className="label">Parties</div>
      {parties.length === 0 && <p className="muted mb-2">No parties. A party is a smaller group inside the campaign that content can be shown to.</p>}
      {parties.map((p) => (
        <PartyRow key={p.id} system={system} party={p} candidates={campaignPlayers} />
      ))}
      {isDm && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (partyName.trim())
              createParty.mutate({ systemId: system.id, campaignId: campaign.id, name: partyName }, { onSuccess: () => setPartyName('') });
          }}
        >
          <input className="input" placeholder="New party name…" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
          <button className="btn" disabled={!partyName.trim()}>
            Add party
          </button>
        </form>
      )}
    </div>
  );
}

function PartyRow({ system, party, candidates }: { system: System; party: Party; candidates: System['members'] }) {
  const utils = trpc.useUtils();
  const isDm = system.role === 'dm';
  const refresh = () => utils.system.get.invalidate();
  const update = trpc.system.updateParty.useMutation({ onSuccess: refresh });
  const remove = trpc.system.deleteParty.useMutation({ onSuccess: refresh });
  return (
    <div className="mb-2 rounded-md bg-stone-100 p-2 dark:bg-stone-900">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{party.name}</span>
        {isDm && (
          <div className="flex gap-2">
            <button
              className="btn px-2 py-0.5 text-xs"
              onClick={() => {
                const next = prompt('Party name:', party.name);
                if (next?.trim()) update.mutate({ systemId: system.id, partyId: party.id, name: next });
              }}
            >
              Rename
            </button>
            <button
              className="btn btn-danger px-2 py-0.5 text-xs"
              onClick={() => confirm(`Delete party ${party.name}?`) && remove.mutate({ systemId: system.id, partyId: party.id })}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {isDm ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {candidates.map((m) => {
            const inParty = party.memberIds.includes(m.userId);
            return (
              <label key={m.userId} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={inParty}
                  onChange={() =>
                    update.mutate({
                      systemId: system.id,
                      partyId: party.id,
                      memberIds: inParty ? party.memberIds.filter((x) => x !== m.userId) : [...party.memberIds, m.userId],
                    })
                  }
                />
                {m.displayName}
              </label>
            );
          })}
          {!candidates.length && <span className="muted">Add players to the campaign first.</span>}
        </div>
      ) : (
        <span className="muted">
          {system.members.filter((m) => party.memberIds.includes(m.userId)).map((m) => m.displayName).join(', ') || 'Empty'}
        </span>
      )}
    </div>
  );
}

function Invites({ system }: { system: System }) {
  const utils = trpc.useUtils();
  const invites = trpc.system.listInvites.useQuery({ systemId: system.id }, { refetchInterval: 10_000 });
  const refresh = () => utils.system.listInvites.invalidate();
  const create = trpc.system.createInvite.useMutation({ onSuccess: refresh });
  const revoke = trpc.system.revokeInvite.useMutation({ onSuccess: refresh });
  const [copied, setCopied] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const url = (token: string) => `${location.origin}/invite/${token}`;
  const campaignName = (id: string | null) => system.campaigns.find((c) => c.id === id)?.name;
  return (
    <section className="card p-4 lg:col-span-2">
      <h2 className="mb-1 font-semibold">Invite links</h2>
      <p className="muted mb-3">
        Each link works once and for 14 days. Send it to the person; they choose their own name and password. Someone who
        already has an account can open a link to join another campaign.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {system.campaigns.length > 0 && (
          <select className="input w-auto" aria-label="Campaign for the new player" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">No campaign (rules only)</option>
            {system.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                Into: {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn btn-primary"
          onClick={() => create.mutate({ systemId: system.id, role: 'player', campaignId: campaignId || null })}
        >
          New player link
        </button>
        <button className="btn" onClick={() => create.mutate({ systemId: system.id, role: 'dm' })}>
          New co-DM link
        </button>
      </div>
      <ul className="space-y-2 text-sm">
        {invites.data?.map((i) => (
          <li key={i.token} className="flex flex-wrap items-center gap-2">
            <span className="w-32 truncate text-xs font-medium uppercase text-stone-500">
              {i.role === 'dm' ? 'Co-DM' : `Player${i.campaignId ? ` · ${campaignName(i.campaignId) ?? ''}` : ''}`}
            </span>
            <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={url(i.token)} onFocus={(e) => e.target.select()} />
            <button
              className="btn px-2 py-0.5 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(url(i.token));
                setCopied(i.token);
              }}
            >
              {copied === i.token ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => revoke.mutate({ systemId: system.id, token: i.token })}>
              Cancel
            </button>
          </li>
        ))}
        {invites.data?.length === 0 && <li className="muted">No open links.</li>}
      </ul>
    </section>
  );
}
