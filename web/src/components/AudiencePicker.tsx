import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Audience, System } from '../trpc';
import type { Mark } from './Visibility';

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
  /**
   * What the choice means here, worked out by the page (see Visibility.tsx): the button is the same
   * chip the DM sees while reading. Without it the button shows the plain setting.
   */
  mark?: Mark | null;
};

/** A small dropdown for choosing who can see something. */
export function AudiencePicker({ system, value, defaultLabel, onChange, compact, mark }: Props) {
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

  const quiet = !!compact && value === null && !mark;
  const secret = mark ? mark.tone === 'secret' : mode === 'dm' || mode === 'chosen';

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
      {quiet ? (
        // Nothing set here and nothing to say: a faint eye that opens the choice.
        <button
          type="button"
          className="inline-flex cursor-pointer items-center rounded-full p-1 text-muted opacity-50 hover:bg-surface-2 hover:opacity-100"
          onClick={() => setOpen(!open)}
          title={`Who can see this: ${text}`}
          aria-label={`Who can see this: ${text}`}
        >
          <Eye className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className={`chip cursor-pointer hover:border-accent ${secret ? 'chip-secret' : 'bg-surface'} ${compact ? '' : 'px-2.5 py-0.5 text-sm'}`}
          data-vis={secret ? 'secret' : 'open'}
          onClick={() => setOpen(!open)}
          title="Who can see this"
        >
          {secret ? <EyeOff className="size-3 shrink-0" strokeWidth={1.75} aria-hidden /> : <Eye className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />}
          <span className="max-w-44 truncate">{mark?.text ?? text}</span>
        </button>
      )}
      {open && (
        <div className="card absolute right-0 z-20 mt-1 w-60 p-3 text-left text-sm font-normal text-fg shadow-lg">
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
