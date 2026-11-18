import { useState } from 'react';

type Talent = {
  id: string;
  name: string;
  type: string;
  cost: number;
  tier: number | null;
  prereq: string;
  requires: string[];
  anyOfTree: number;
  description: string;
};
type Tree = { id: string; name: string; about: string; talents: Talent[] };
export type TalentData = {
  pointsTotal: number | null;
  rules: string[];
  tracks: { name: string; levels: string[] }[];
  patrons: { name: string; trees: Tree[] }[];
};
export type Picks = Record<string, { level: number | null }>;

type Props = {
  data: TalentData | null;
  picks: Picks;
  /** The viewer may mark talents as taken. */
  canPick: boolean;
  /** The viewer is the DM and may load the tree from the note. */
  canLoad: boolean;
  onPicks: (picks: Picks) => void;
  onLoad: (markdown: string) => void;
  loadMessage: string | null;
};

const TYPE_STYLE: Record<string, string> = {
  Minor: 'bg-surface-2 text-muted',
  Major: 'bg-accent/15 text-accent',
  Milestone: 'bg-accent text-accent-ink',
};

export function TalentTree({ data, picks, canPick, canLoad, onPicks, onLoad, loadMessage }: Props) {
  const [show, setShow] = useState<'all' | 'taken' | 'available'>('all');
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');

  const loader = canLoad && (
    <div className="mt-3">
      {loading ? (
        <div>
          <p className="muted mb-1">
            Paste the whole text of the talent note. The note is the master copy: trees, costs and “(+)” taken marks are read from
            it. Contract levels already entered here are kept.
          </p>
          <textarea className="input min-h-32 font-mono text-xs" aria-label="Talent note text" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!note.trim()}
              onClick={() => {
                onLoad(note);
                setLoading(false);
                setNote('');
              }}
            >
              Load
            </button>
            <button type="button" className="btn" onClick={() => setLoading(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setLoading(true)}>
          {data ? 'Reload from the note…' : 'Load from the note…'}
        </button>
      )}
      {loadMessage && <p className="muted mt-1">{loadMessage}</p>}
    </div>
  );

  if (!data) return <div><p className="muted">No talent tree loaded yet.</p>{loader}</div>;

  const all = data.patrons.flatMap((p) => p.trees.flatMap((t) => t.talents));
  const byId = new Map(all.map((t) => [t.id, t]));
  const taken = (id: string) => id in picks;
  const spent = all.filter((t) => taken(t.id)).reduce((sum, t) => sum + t.cost, 0);
  const over = data.pointsTotal !== null && spent > data.pointsTotal;

  /** What still stands between the character and this talent. Empty when it can be taken. */
  const missing = (t: Talent, tree: Tree): string[] => {
    const out = t.requires.filter((id) => !taken(id)).map((id) => byId.get(id)?.name ?? id);
    const others = tree.talents.filter((x) => x.id !== t.id && !t.requires.includes(x.id) && taken(x.id)).length;
    if (others < t.anyOfTree) out.push(`${t.anyOfTree - others} more talent(s) of this tree`);
    return out;
  };
  /** The rule of the note: an upgrade and its prerequisite cannot be taken on the same Contract level. */
  const sameLevelClash = (t: Talent): string | null => {
    const level = picks[t.id]?.level;
    if (level === null || level === undefined) return null;
    const clash = t.requires.find((id) => picks[id]?.level === level);
    return clash ? (byId.get(clash)?.name ?? clash) : null;
  };

  const setPick = (id: string, pick: { level: number | null } | null) => {
    const next = { ...picks };
    if (pick) next[id] = pick;
    else delete next[id];
    onPicks(next);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={`text-sm font-semibold ${over ? 'text-red-600 dark:text-red-400' : ''}`}>
          Spent {spent} {data.pointsTotal !== null ? `of ${data.pointsTotal} ` : ''}PP
          {over && ' — over the total'}
        </span>
        <span className="flex gap-1">
          {(['all', 'taken', 'available'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rounded px-2 py-0.5 text-xs font-medium ${show === mode ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`}
              onClick={() => setShow(mode)}
            >
              {mode === 'all' ? 'All' : mode === 'taken' ? 'Taken' : 'Can be taken'}
            </button>
          ))}
        </span>
      </div>
      {data.rules.map((r) => (
        <p key={r} className="muted mb-2">
          Rule: {r}
        </p>
      ))}

      {data.tracks.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {data.tracks.map((track) => (
            <div key={track.name} className="rounded-md border border-line p-3 text-sm">
              <div className="mb-1 font-semibold">{track.name}</div>
              <ul className="list-inside list-disc text-muted">
                {track.levels.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {data.patrons.map((patron) => (
        <section key={patron.name} className="mb-4">
          <h3 className="mb-2 border-b border-line pb-1 display text-base">{patron.name}</h3>
          {patron.trees.length === 0 && <p className="muted">No trees yet.</p>}
          {patron.trees.map((tree) => {
            const visible = tree.talents.filter((t) => {
              const state = taken(t.id) ? 'taken' : missing(t, tree).length ? 'locked' : 'available';
              return show === 'all' || show === state;
            });
            const treeSpent = tree.talents.filter((t) => taken(t.id)).reduce((s, t) => s + t.cost, 0);
            return (
              <div key={tree.id} className="mb-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{tree.name}</span>
                  {tree.about && <span className="muted">{tree.about}</span>}
                  <span className="ml-auto text-xs text-muted">{treeSpent} PP spent</span>
                </div>
                {visible.length === 0 && <p className="muted">Nothing to show here.</p>}
                <div className="grid gap-2 lg:grid-cols-2">
                  {visible.map((t) => {
                    const isTaken = taken(t.id);
                    const lacks = missing(t, tree);
                    const clash = isTaken ? sameLevelClash(t) : null;
                    return (
                      <div
                        key={t.id}
                        data-talent={t.name}
                        data-state={isTaken ? 'taken' : lacks.length ? 'locked' : 'available'}
                        className={`rounded-md border p-2 text-sm ${
                          isTaken
                            ? 'border-accent bg-accent/10'
                            : lacks.length
                              ? 'border-line opacity-60'
                              : 'border-emerald-500'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold">{t.name}</span>
                          {t.type && <span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_STYLE[t.type] ?? ''}`}>{t.type}</span>}
                          <span className="text-xs font-medium">{t.cost} PP</span>
                          {t.tier !== null && <span className="text-xs text-muted">Tier {t.tier}</span>}
                          <span className="ml-auto text-xs font-medium">{isTaken ? 'Taken' : lacks.length ? 'Locked' : 'Can be taken'}</span>
                        </div>
                        {t.prereq && <div className="mt-1 text-xs text-muted">Requires: {t.prereq}</div>}
                        {isTaken && lacks.length > 0 && (
                          <div className="mt-1 text-xs text-red-600 dark:text-red-400">Taken without: {lacks.join(', ')}</div>
                        )}
                        {clash && <div className="mt-1 text-xs text-red-600 dark:text-red-400">Same Contract level as its prerequisite {clash}</div>}
                        {t.description && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-accent">Description</summary>
                            <p className="mt-1 whitespace-pre-wrap text-fg">{t.description}</p>
                          </details>
                        )}
                        {canPick && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="btn px-2 py-0.5 text-xs"
                              aria-label={`${isTaken ? 'Untake' : 'Take'} ${t.name}`}
                              onClick={() => setPick(t.id, isTaken ? null : { level: null })}
                            >
                              {isTaken ? 'Untake' : 'Take'}
                            </button>
                            {isTaken && (
                              <label className="flex items-center gap-1 text-xs text-muted">
                                Contract level
                                <input
                                  className="input w-14 px-1 py-0.5 text-center"
                                  inputMode="numeric"
                                  key={String(picks[t.id]?.level)}
                                  defaultValue={picks[t.id]?.level ?? ''}
                                  onBlur={(e) => {
                                    const n = e.target.value.trim() === '' ? null : Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0)));
                                    if (n !== (picks[t.id]?.level ?? null)) setPick(t.id, { level: n });
                                  }}
                                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                />
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ))}
      {loader}
    </div>
  );
}

/** Everything written in a tree, for the sheet search. */
export function talentText(data: TalentData | null): string {
  if (!data?.patrons) return '';
  return data.patrons
    .flatMap((p) => [p.name, ...p.trees.flatMap((t) => [t.name, t.about, ...t.talents.flatMap((x) => [x.name, x.description])])])
    .join('\n');
}
