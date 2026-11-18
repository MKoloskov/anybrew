import { useEffect, useRef, useState } from 'react';
import { useBilingual } from '../lang';
import { trpc, type Out } from '../trpc';

export type ClassPick = { classId: string; subclass: string | null; level: number };
type Review = Out['entity']['importClass'];

type ClassesInputProps = { entityId: string; systemId: string; value: unknown; disabled: boolean; onSave: (value: unknown) => void };

/**
 * The classes of a character: each one a class document of the Rules section, with a subclass and
 * a level. Under each class the sheet shows what the class gives at that level.
 */
export function ClassesInput({ entityId, systemId, value, disabled, onSave: save }: ClassesInputProps) {
  // Two quick changes in a row (subclass, then level) must not undo each other: the second one
  // builds on what was just chosen, not on what the server last sent.
  const [pending, setPending] = useState<ClassPick[] | null>(null);
  const stored = JSON.stringify(value ?? null);
  useEffect(() => setPending(null), [stored]);
  const picks = pending ?? (Array.isArray(value) ? (value as ClassPick[]) : []);
  const onSave = (next: ClassPick[]) => {
    setPending(next);
    save(next);
  };
  const rules = trpc.entity.list.useQuery({ systemId, typeKey: 'rule' });
  const info = trpc.entity.classInfo.useQuery({ id: entityId }, { refetchInterval: 10_000 });
  const bilingual = useBilingual();
  const classes = (rules.data ?? []).filter((r) => r.isClass);
  const free = classes.filter((c) => !picks.some((p) => p.classId === c.id));
  const change = (index: number, next: Partial<ClassPick>) => onSave(picks.map((p, i) => (i === index ? { ...p, ...next } : p)));

  return (
    <div data-classes>
      {picks.map((pick, i) => {
        const c = info.data?.find((x) => x.classId === pick.classId);
        const name = c?.found ? bilingual(c.name, c.nameRu) : (classes.find((x) => x.id === pick.classId)?.name ?? 'A class you cannot see');
        const facts = c?.found
          ? [c.hitDie ? `Hit die d${c.hitDie}` : '', c.saves ? `Saves: ${c.saves}` : '', ...c.tableRow.map((t) => `${t.column}: ${t.value}`)].filter(Boolean)
          : [];
        return (
          <div key={pick.classId} className="mb-2 rounded-md border border-line p-2" data-class={c?.found ? c.name : ''}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{name}</span>
              {disabled ? (
                <span className="text-sm">
                  {pick.subclass && <span>{pick.subclass} · </span>}
                  <span className="text-muted">Level</span> {pick.level}
                </span>
              ) : (
              <>
              {c?.found && c.subclasses.length > 0 && (
                <select
                  className="input w-auto"
                  aria-label={`${c.subclassTitle || 'Subclass'} of ${c.name}`}
                  value={pick.subclass ?? ''}
                  disabled={disabled}
                  onChange={(ev) => change(i, { subclass: ev.target.value || null })}
                >
                  <option value="">{c.subclassTitle || 'Subclass'}: none yet</option>
                  {c.subclasses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-1 text-sm">
                <span className="muted">Level</span>
                <input
                  className="input w-16"
                  inputMode="numeric"
                  aria-label={`Level in ${c?.found ? c.name : 'this class'}`}
                  key={pick.level}
                  defaultValue={pick.level}
                  disabled={disabled}
                  onBlur={(ev) => {
                    const level = Math.max(1, Math.min(40, Math.floor(Number(ev.target.value) || 1)));
                    if (level !== pick.level) change(i, { level });
                    else ev.target.value = String(pick.level);
                  }}
                  onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()}
                />
              </label>
              </>
              )}
              {!disabled && (
                <button
                  type="button"
                  className="btn ml-auto px-2 py-0.5 text-xs"
                  aria-label={`Remove class ${c?.found ? c.name : ''}`}
                  onClick={() => confirm('Remove this class from the character? What it already filled in stays on the sheet.') && onSave(picks.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
            {facts.length > 0 && <p className="mt-1 text-xs text-muted">{facts.join(' · ')}</p>}
          </div>
        );
      })}
      {!picks.length && disabled && <span className="text-sm text-muted">none</span>}
      {!disabled &&
        (classes.length ? (
          free.length > 0 && (
            <select
              className="input w-auto"
              aria-label="Add a class"
              value=""
              onChange={(ev) => ev.target.value && onSave([...picks, { classId: ev.target.value, subclass: null, level: 1 }])}
            >
              <option value="">+ Add a class…</option>
              {free.map((c) => (
                <option key={c.id} value={c.id}>
                  {bilingual(c.name, c.nameRu)}
                </option>
              ))}
            </select>
          )
        ) : (
          rules.data && (
            <p className="muted text-sm">
              No classes yet. A class is a rules document: import a class file on the Rules tab, or tick “Class” on a rule.
            </p>
          )
        ))}
      {!disabled && picks.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Classes set the Level and Hit Dice. The first class also fills its saving throw, armor, weapon and tool proficiencies. Class features up to
          each level are listed under Features.
        </p>
      )}
    </div>
  );
}

/**
 * Rules tab, DM only: brings in a class file (a class handbook converted from PDF). The file is
 * shown for review first; nothing is saved until the DM confirms, and single features can be left out.
 */
export function ClassImport({ systemId, onImported }: { systemId: string; onImported: (ruleId: string) => void }) {
  const utils = trpc.useUtils();
  const fileInput = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<unknown>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const importer = trpc.entity.importClass.useMutation();
  const close = () => {
    setData(null);
    setReview(null);
    setSkip(new Set());
  };

  const open = async (file: File) => {
    setMessage(null);
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return setMessage('This file is not valid JSON.');
    }
    importer.mutate(
      { systemId, data: json, dryRun: true },
      {
        onSuccess: (r) => {
          setData(json);
          setReview(r);
        },
        onError: (e) => setMessage(e.message),
      },
    );
  };
  const confirmImport = () =>
    importer.mutate(
      { systemId, data, dryRun: false, skip: [...skip] },
      {
        onSuccess: async (r) => {
          close();
          await utils.entity.list.invalidate();
          if (r.ruleId) onImported(r.ruleId);
        },
        onError: (e) => setMessage(e.message),
      },
    );
  const taken = review ? review.features.filter((f) => !skip.has(f.key)).length : 0;

  return (
    <div className="mb-3">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-class-file
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (file) void open(file);
          ev.target.value = '';
        }}
      />
      <button type="button" className="btn w-full" onClick={() => fileInput.current?.click()}>
        Import a class file…
      </button>
      {message && !review && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{message}</p>}

      {review && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-label="Review the class file">
          <div className="card w-full max-w-2xl bg-surface p-4 text-sm">
            <h2 className="display text-xl">{review.name}</h2>
            <p className="muted mb-3">
              {review.status === 'new' ? 'A new class in the Rules section.' : `Updates the rules document “${review.name}” that already exists.`} Nothing is saved until
              you press Import.
            </p>
            <ul className="mb-3 space-y-0.5">
              <li>Hit die: {review.hitDie ? `d${review.hitDie}` : 'not given'}</li>
              <li>Saving throws: {review.saves || 'not given'}</li>
              <li>Class table: {review.tableLevels ? `${review.tableLevels} levels` : 'none'}</li>
              <li>Subclasses: {review.subclasses.length ? review.subclasses.join(', ') : 'none'}</li>
            </ul>
            <h3 className="mb-1 font-semibold">
              Features <span className="font-normal text-muted">· {taken} of {review.features.length} will be imported</span>
            </h3>
            <table className="mb-3 w-full border-collapse">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="w-8 py-1" />
                  <th className="w-10 py-1">Lvl</th>
                  <th className="py-1">Feature</th>
                  <th className="py-1">Subclass</th>
                  <th className="w-36 py-1" />
                </tr>
              </thead>
              <tbody>
                {review.features.map((f) => (
                  <tr key={f.key} className="border-b border-line">
                    <td className="py-1">
                      <input
                        type="checkbox"
                        aria-label={`Import ${f.name}`}
                        checked={!skip.has(f.key)}
                        onChange={() => {
                          const next = new Set(skip);
                          if (!next.delete(f.key)) next.add(f.key);
                          setSkip(next);
                        }}
                      />
                    </td>
                    <td className="py-1">{f.level ?? ''}</td>
                    <td className="py-1 font-medium">{f.name}</td>
                    <td className="py-1 text-muted">{f.subclass ?? ''}</td>
                    <td className="py-1 text-xs text-muted">{f.status === 'new' ? 'new' : 'updates the existing one'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {message && <p className="mb-2 text-red-600 dark:text-red-400">Not imported: {message}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" disabled={importer.isPending} onClick={confirmImport}>
                Import
              </button>
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
