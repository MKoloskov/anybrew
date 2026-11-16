import { useEffect, useRef, useState } from 'react';
import type { Audience, System } from '../trpc';

export function describeAudience(a: Audience, system: System): string {
  if (a.all) return 'Everyone';
  const names = [
    ...system.parties.filter((p) => a.parties.includes(p.id)).map((p) => p.name),
    ...system.members.filter((m) => a.players.includes(m.userId)).map((m) => m.displayName),
  ];
  return names.length ? names.join(', ') : 'DM only';
}

type Props = {
  system: System;
  /** null means "use the default" and is offered only when defaultLabel is given. */
  value: Audience | null;
  defaultLabel?: string;
  onChange: (next: Audience | null) => void;
  compact?: boolean;
};

/** A small dropdown for choosing who can see something. */
export function AudiencePicker({ system, value, defaultLabel, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const players = system.members.filter((m) => m.role === 'player');
  const current: Audience = value ?? { all: false, players: [], parties: [] };
  const mode = value === null ? 'default' : value.all ? 'all' : value.players.length || value.parties.length ? 'chosen' : 'dm';
  const [choosing, setChoosing] = useState(false);
  const showChosen = mode === 'chosen' || choosing;
  const text = value === null ? (defaultLabel ?? 'Default') : describeAudience(value, system);

  const toggle = (list: 'players' | 'parties', id: string) => {
    const has = current[list].includes(id);
    onChange({ ...current, all: false, [list]: has ? current[list].filter((x) => x !== id) : [...current[list], id] });
  };
  const pick = (next: Audience | null) => {
    setChoosing(false);
    onChange(next);
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        className={`btn ${compact ? 'px-2 py-0.5 text-xs' : ''} ${mode === 'dm' ? 'text-amber-700 dark:text-amber-400' : ''} ${compact && value === null ? 'opacity-50 hover:opacity-100' : ''}`}
        onClick={() => setOpen(!open)}
        title={compact && value === null ? `Who can see this: ${text}` : 'Who can see this'}
      >
        <span aria-hidden>👁</span>
        {!(compact && value === null) && <span className="max-w-40 truncate">{text}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 z-20 mt-1 w-60 p-3 text-sm shadow-lg">
          {defaultLabel !== undefined && (
            <Radio checked={mode === 'default' && !choosing} onChange={() => pick(null)} label={`Default (${defaultLabel})`} />
          )}
          <Radio checked={mode === 'dm' && !choosing} onChange={() => pick({ all: false, players: [], parties: [] })} label="DM only" />
          <Radio checked={mode === 'all' && !choosing} onChange={() => pick({ all: true, players: [], parties: [] })} label="Everyone" />
          <Radio checked={showChosen} onChange={() => setChoosing(true)} label="Chosen parties and players" />
          {showChosen && (
            <div className="mt-2 ml-5 space-y-1">
              {system.parties.map((p) => (
                <Check key={p.id} checked={current.parties.includes(p.id)} onChange={() => toggle('parties', p.id)} label={`Party: ${p.name} (${system.campaigns.find((c) => c.id === p.campaignId)?.name ?? '?'})`} />
              ))}
              {players.map((m) => (
                <Check key={m.userId} checked={current.players.includes(m.userId)} onChange={() => toggle('players', m.userId)} label={m.displayName} />
              ))}
              {!system.parties.length && !players.length && <p className="muted">No players or parties yet.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Radio(props: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input type="radio" checked={props.checked} onChange={props.onChange} /> {props.label}
    </label>
  );
}

function Check(props: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={props.checked} onChange={props.onChange} /> {props.label}
    </label>
  );
}
