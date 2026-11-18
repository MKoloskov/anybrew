import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { EmptyState } from '../components/Icons';
import { RichTextEditor, RichTextView } from '../components/RichText';
import { trpc, type Out, type System } from '../trpc';

// Player Requests (PLAN.md 10.4): a player writes to the DM in a thread, the DM answers and resolves it.
// Two folders for both sides: Open and Archive. The server sends a player only their own requests.

type Row = Out['request']['list'][number];
type Folder = 'open' | 'archive';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const folderOf = (status: Row['status']): Folder => (status === 'open' ? 'open' : 'archive');

/** A message box with a Send button. It empties itself after a successful send. */
function Composer({ label, sendLabel, disabled, onSend }: { label: string; sendLabel: string; disabled: boolean; onSend: (html: string, done: () => void) => void }) {
  const [draft, setDraft] = useState('');
  // A new key gives a fresh, empty editor.
  const [round, setRound] = useState(0);
  return (
    <div className="space-y-2">
      <RichTextEditor key={round} value={draft} disabled={false} label={label} onSave={() => {}} onChange={setDraft} />
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || !draft}
        onClick={() =>
          onSend(draft, () => {
            setDraft('');
            setRound((n) => n + 1);
          })
        }
      >
        {sendLabel}
      </button>
    </div>
  );
}

export function RequestsTab({ system, requestId }: { system: System; requestId?: string }) {
  const isDm = system.role === 'dm';
  const list = trpc.request.list.useQuery({ systemId: system.id }, { refetchInterval: 10_000 });
  const [folder, setFolder] = useState<Folder>('open');
  const rows = list.data ?? [];
  const selected = rows.find((r) => r.id === requestId);
  // Opening a request shows the folder it lies in, also after it was resolved or reopened.
  const selectedFolder = selected ? folderOf(selected.status) : undefined;
  useEffect(() => {
    if (selectedFolder) setFolder(selectedFolder);
  }, [selected?.id, selectedFolder]);

  const inFolder = (f: Folder) => rows.filter((r) => folderOf(r.status) === f);
  const shown = inFolder(folder);
  const base = `/s/${system.id}/requests`;

  return (
    <div className="grid flex-1 md:grid-cols-[22rem_1fr]" data-requests>
      {/* On a phone the list and the thread are separate screens. */}
      <aside className={`border-line p-4 md:border-r ${requestId ? 'hidden md:block' : ''}`}>
        <Link href={`${base}/new`} className="btn btn-primary mb-3 w-full">
          New request
        </Link>
        <div className="mb-3 flex border-b border-line" role="tablist" aria-label="Request folders">
          {(['open', 'archive'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={folder === f}
              data-folder={f}
              onClick={() => setFolder(f)}
              className={`-mb-px flex-1 border-b-2 px-3 py-1.5 text-sm font-medium ${
                folder === f ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {f === 'open' ? 'Open' : 'Archive'} <span className="text-muted">{inFolder(f).length}</span>
            </button>
          ))}
        </div>
        {list.data && shown.length === 0 && (
          <EmptyState>{folder === 'open' ? 'No open requests.' : 'Nothing in the archive yet.'}</EmptyState>
        )}
        <ul className="space-y-1" data-request-list>
          {shown.map((r) => (
            <li key={r.id} data-request={r.subject}>
              <Link href={`${base}/${r.id}`} className={`block rounded-md px-3 py-2 text-sm ${r.id === requestId ? 'bg-accent/15' : 'hover:bg-surface-2'}`}>
                <span className="flex items-baseline gap-2">
                  {r.waiting && <span className="size-2 shrink-0 self-center rounded-full bg-accent" aria-hidden />}
                  <span className={`min-w-0 flex-1 truncate ${r.waiting ? 'font-semibold' : 'font-medium'}`}>{r.subject}</span>
                </span>
                <span className="block text-xs text-muted">
                  {isDm && (
                    <>
                      {r.playerName}
                      {r.playerFormer && ' (former member)'} ·{' '}
                    </>
                  )}
                  <span data-request-state>{stateText(r, isDm)}</span> · {when(r.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <main className={`min-w-0 ${requestId ? '' : 'hidden md:block'}`}>
        {requestId === 'new' ? (
          <NewRequest system={system} />
        ) : requestId ? (
          <Thread key={requestId} requestId={requestId} system={system} />
        ) : (
          <p className="muted p-6">{isDm ? 'Choose a request, or write to a player.' : 'Choose a request, or write a new one to the DM.'}</p>
        )}
      </main>
    </div>
  );
}

function stateText(r: Row, isDm: boolean): string {
  if (r.status === 'resolved') return 'Resolved';
  if (r.waiting) return 'Waiting for you';
  if (isDm) return r.lastFrom === 'dm' ? 'Waiting for the player' : 'Open';
  return 'Waiting for the DM';
}

function BackToList({ systemId }: { systemId: string }) {
  return (
    <Link href={`/s/${systemId}/requests`} className="btn mb-3 px-2 py-0.5 text-xs md:hidden">
      ← Requests
    </Link>
  );
}

function NewRequest({ system }: { system: System }) {
  const isDm = system.role === 'dm';
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const players = system.members.filter((m) => m.role === 'player');
  const [subject, setSubject] = useState('');
  const [playerId, setPlayerId] = useState('');
  const create = trpc.request.create.useMutation();
  const ready = subject.trim() !== '' && (!isDm || playerId !== '');

  if (isDm && players.length === 0)
    return (
      <div className="p-4 md:p-6">
        <BackToList systemId={system.id} />
        <p className="muted">There are no players in this system yet. Invite one on the People tab.</p>
      </div>
    );

  return (
    <div className="max-w-3xl p-4 md:p-6" data-new-request>
      <BackToList systemId={system.id} />
      <h2 className="display mb-1 text-xl">New request</h2>
      <p className="muted mb-4">
        {isDm ? 'Only the chosen player and the DMs see this thread.' : 'Only you and the DM see this thread. The DM answers here and marks it resolved when the matter is settled.'}
      </p>
      {isDm && (
        <label className="mb-3 block">
          <span className="label">To player</span>
          <select className="input" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">Choose a player…</option>
            {players.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="mb-3 block">
        <span className="label">Subject</span>
        <input className="input" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <span className="label">Message</span>
      <Composer
        label="Message"
        sendLabel="Send"
        disabled={!ready || create.isPending}
        onSend={(body) =>
          create.mutate(
            { systemId: system.id, subject, body, playerId: isDm ? playerId : undefined },
            {
              onSuccess: async ({ id }) => {
                await Promise.all([utils.request.list.invalidate(), utils.request.waiting.invalidate()]);
                navigate(`/s/${system.id}/requests/${id}`);
              },
            },
          )
        }
      />
      {create.error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">Not sent: {create.error.message}</p>}
    </div>
  );
}

function Thread({ requestId, system }: { requestId: string; system: System }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const request = trpc.request.get.useQuery({ id: requestId }, { refetchInterval: 10_000, retry: false });
  const refresh = () => Promise.all([utils.request.get.invalidate({ id: requestId }), utils.request.list.invalidate(), utils.request.waiting.invalidate()]);
  const reply = trpc.request.reply.useMutation();
  const resolve = trpc.request.resolve.useMutation({ onSuccess: refresh });
  const reopen = trpc.request.reopen.useMutation({ onSuccess: refresh });
  const remove = trpc.request.remove.useMutation({
    onSuccess: async () => {
      navigate(`/s/${system.id}/requests`);
      await Promise.all([utils.request.list.invalidate(), utils.request.waiting.invalidate()]);
    },
  });

  if (request.error)
    return (
      <div className="p-4 md:p-6">
        <BackToList systemId={system.id} />
        <p className="muted">This request does not exist, or it was deleted.</p>
      </div>
    );
  if (!request.data) return <p className="muted p-6">Loading…</p>;
  const r = request.data;

  return (
    <div className="max-w-3xl p-4 md:p-6" data-thread>
      <BackToList systemId={system.id} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="display text-xl" data-request-subject>
            {r.subject}
          </h2>
          <p className="muted" data-request-status>
            {r.canManage && (
              <>
                {r.playerName}
                {r.playerFormer && ' (former member)'} ·{' '}
              </>
            )}
            {r.status === 'open' ? 'Open' : `Resolved${r.resolvedAt ? ` on ${when(r.resolvedAt)}` : ''}`}
          </p>
        </div>
        {r.canManage && (
          <div className="flex gap-2">
            {r.status === 'open' ? (
              <button className="btn" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id })}>
                Mark resolved
              </button>
            ) : (
              <button className="btn" disabled={reopen.isPending} onClick={() => reopen.mutate({ id: r.id })}>
                Reopen
              </button>
            )}
            <button
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Delete the request "${r.subject}" with all its messages? It will be gone for you and for ${r.playerName}, and cannot be brought back.`))
                  remove.mutate({ id: r.id });
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <ol className="space-y-3">
        {r.messages.map((m) => (
          <li key={m.id} className={`card p-3 ${m.from === 'dm' ? 'border-l-2 border-l-accent' : ''}`} data-message data-from={m.from}>
            <p className="mb-1 text-xs text-muted">
              <span className="font-medium text-fg">{m.authorName}</span> · {m.from === 'dm' ? 'DM' : 'player'} · {when(m.createdAt)}
            </p>
            <RichTextView html={m.body} />
          </li>
        ))}
      </ol>

      <div className="mt-4">
        {r.canReply ? (
          <>
            <Composer
              label="Reply"
              sendLabel="Send reply"
              disabled={reply.isPending}
              onSend={(body, done) =>
                reply.mutate(
                  { id: r.id, body },
                  {
                    onSuccess: async () => {
                      done();
                      await refresh();
                    },
                    // Resolved by the DM in the meantime: show the thread as it is now.
                    onError: () => void refresh(),
                  },
                )
              }
            />
            {reply.error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">Not sent: {reply.error.message}</p>}
          </>
        ) : (
          <p className="muted" data-request-closed>
            This request is resolved. {r.canManage ? 'Reopen it to write further.' : 'Only the DM can reopen it; for a new matter, write a new request.'}
          </p>
        )}
      </div>
    </div>
  );
}
