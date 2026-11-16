import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc, type System, type Entity } from '../trpc';
import { AudiencePicker, describeAudience } from './AudiencePicker';

type Props = { entityId: string; system: System; noun: string; onClose: () => void };

// The server sends the schema as nested groups and fields; this is the shape the screen needs from it.
type Field = {
  kind: 'field';
  id: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[];
  max?: number;
  signed?: boolean;
  dmEditOnly?: boolean;
  visibility?: Parameters<typeof describeAudience>[0];
};
type Group = { kind: 'group'; id: string; label: string; layout?: 'row'; children: Node[]; visibility?: Field['visibility'] };
type Node = Field | Group;

/** Text of a value as the search sees it. */
function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'object') {
    const t = value as { columns?: string[]; rows?: string[][] };
    return t.columns && t.rows ? [t.columns, ...t.rows].map((r) => r.join(' ')).join('\n') : '';
  }
  return String(value);
}

export function EntityEditor({ entityId, system, noun, onClose }: Props) {
  const utils = trpc.useUtils();
  const entity = trpc.entity.get.useQuery({ id: entityId }, { refetchInterval: 10_000 });
  const isDm = system.role === 'dm';
  const refresh = () => {
    void utils.entity.get.invalidate({ id: entityId });
    void utils.entity.list.invalidate();
    void utils.entity.history.invalidate({ id: entityId });
  };
  const rename = trpc.entity.rename.useMutation({ onSuccess: refresh });
  const setField = trpc.entity.setField.useMutation({ onSuccess: refresh });
  const setVisibility = trpc.entity.setVisibility.useMutation({ onSuccess: refresh });
  const setFieldVisibility = trpc.entity.setFieldVisibility.useMutation({ onSuccess: refresh });
  const setOwner = trpc.entity.setOwner.useMutation({ onSuccess: refresh });
  const setCampaigns = trpc.entity.setCampaigns.useMutation({ onSuccess: refresh });
  const setModules = trpc.entity.setModules.useMutation({ onSuccess: refresh });
  const remove = trpc.entity.delete.useMutation({
    onSuccess: () => {
      void utils.entity.list.invalidate();
      void utils.entity.listDeleted.invalidate();
      onClose();
    },
  });
  const [showHistory, setShowHistory] = useState(false);
  const [query, setQuery] = useState('');
  const [step, setStep] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const e = entity.data;
  const q = query.trim().toLowerCase();

  // Search: a field matches when its label, its row's label or its value contains the typed text.
  const matches = useMemo(() => {
    const found = new Set<string>();
    if (!e || !q) return found;
    const walk = (nodes: Node[], inherited: boolean) => {
      for (const n of nodes) {
        const labelHit = n.label.toLowerCase().includes(q);
        if (n.kind === 'group') {
          // A matching row label marks the whole row; a matching section title does not mark everything in it.
          if (labelHit && n.layout !== 'row') found.add(n.id);
          walk(n.children, inherited || (labelHit && n.layout === 'row'));
        } else if (inherited || labelHit || valueText(e.values[n.id]).toLowerCase().includes(q)) found.add(n.id);
      }
    };
    walk(e.schema.groups as Node[], false);
    return found;
  }, [e, q]);

  // Jump to the current match whenever the search text or the step changes.
  useEffect(() => {
    if (!q) return;
    const marks = root.current?.querySelectorAll('[data-match]');
    if (!marks?.length) return;
    marks.forEach((m) => m.removeAttribute('data-current'));
    const target = marks[((step % marks.length) + marks.length) % marks.length]!;
    target.setAttribute('data-current', '');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [q, step, matches]);

  if (entity.error) return <p className="muted p-4">This {noun} does not exist or is hidden from you.</p>;
  if (!e) return <p className="muted p-4">Loading…</p>;
  const error = setField.error ?? rename.error ?? setVisibility.error ?? setFieldVisibility.error ?? setModules.error;

  const contains = (node: Node): boolean => matches.has(node.id) || (node.kind === 'group' && node.children.some(contains));
  const mark = (id: string) => (matches.has(id) ? { 'data-match': '' } : {});

  const pickerFor = (node: Node) => {
    if (!isDm) return null;
    const override = e.access?.fieldVisibility[node.id] ?? null;
    const schemaDefault = node.visibility ? describeAudience(node.visibility, system) : 'same as above';
    return (
      <AudiencePicker
        compact
        system={system}
        value={override}
        defaultLabel={schemaDefault}
        onChange={(audience) => setFieldVisibility.mutate({ id: e.id, nodeId: node.id, audience })}
      />
    );
  };

  const input = (node: Field) => (
    <FieldInput
      field={node}
      value={e.values[node.id] ?? null}
      disabled={!e.editableFields.includes(node.id)}
      onSave={(value) => setField.mutate({ id: e.id, fieldId: node.id, value })}
    />
  );

  const renderNode = (node: Node, depth: number): React.ReactNode => {
    if (node.kind === 'group' && node.layout === 'row')
      return (
        <div key={node.id} className="sheet-row match-target flex flex-wrap items-end gap-x-3 gap-y-1 rounded-md border-b border-stone-200 px-1 py-1 last:border-b-0 dark:border-stone-800">
          <span className="w-full text-sm font-medium sm:w-44 sm:pb-2">{node.label}</span>
          {node.children.map((c) =>
            c.kind === 'field' ? (
              <label key={c.id} className="match-target rounded-md px-1" {...mark(c.id)}>
                <span className="block text-xs text-stone-500">{c.label}</span>
                {input(c)}
              </label>
            ) : null,
          )}
          <span className="ml-auto">{pickerFor(node)}</span>
        </div>
      );
    if (node.kind === 'group')
      return (
        <GroupBox
          key={node.id}
          id={`${e.typeKey}.${node.id}`}
          label={node.label}
          picker={pickerFor(node)}
          depth={depth}
          forceOpen={q !== '' && contains(node)}
          matched={matches.has(node.id)}
        >
          {node.children.map((c) => renderNode(c, depth + 1))}
          {!node.children.length && <p className="muted">Nothing here that you can see.</p>}
        </GroupBox>
      );
    return (
      <div key={node.id} className="match-target mb-3 rounded-md px-1" {...mark(node.id)}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="label mb-0">
            {node.label}
            {node.dmEditOnly && <span className="ml-1 text-stone-400">(set by the DM)</span>}
          </span>
          {pickerFor(node)}
        </div>
        {input(node)}
      </div>
    );
  };

  const matchCount = matches.size;

  return (
    <div className="p-4" ref={root}>
      <button className="btn mb-3 md:hidden" onClick={onClose}>
        ← Back
      </button>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NameInput key={e.name} name={e.name} disabled={!e.canEdit} onSave={(name) => rename.mutate({ id: e.id, name })} />
        {isDm && e.access && (
          <AudiencePicker system={system} value={e.access.visibility} onChange={(a) => a && setVisibility.mutate({ id: e.id, audience: a })} />
        )}
      </div>

      <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-stone-100/95 px-1 py-2 text-sm dark:bg-stone-950/95">
        <input
          className="input max-w-xs"
          type="search"
          placeholder={`Search this ${noun}…`}
          aria-label={`Search this ${noun}`}
          value={query}
          onChange={(ev) => {
            setQuery(ev.target.value);
            setStep(0);
          }}
          onKeyDown={(ev) => ev.key === 'Enter' && setStep(step + (ev.shiftKey ? -1 : 1))}
        />
        {q && (
          <>
            <span className="muted">{matchCount ? `${matchCount} found` : 'Nothing found'}</span>
            {matchCount > 1 && (
              <>
                <button className="btn px-2 py-0.5 text-xs" onClick={() => setStep(step - 1)}>
                  Previous
                </button>
                <button className="btn px-2 py-0.5 text-xs" onClick={() => setStep(step + 1)}>
                  Next
                </button>
              </>
            )}
          </>
        )}
      </div>

      {isDm && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="muted">Owner:</span>
          <select
            className="input w-auto"
            value={e.ownerId ?? ''}
            onChange={(ev) => setOwner.mutate({ id: e.id, ownerId: ev.target.value || null })}
          >
            <option value="">Nobody (DM)</option>
            {system.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <span className="muted">The owner always sees and edits the {noun}, except DM-only parts.</span>
        </div>
      )}

      {system.campaigns.length > 0 && (isDm || e.campaignIds.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="muted">Campaign:</span>
          {isDm ? (
            <>
              {system.campaigns.map((c) => {
                const inside = e.campaignIds.includes(c.id);
                return (
                  <label key={c.id} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={inside}
                      onChange={() =>
                        setCampaigns.mutate({
                          id: e.id,
                          campaignIds: inside ? e.campaignIds.filter((x) => x !== c.id) : [...e.campaignIds, c.id],
                        })
                      }
                    />
                    {c.name}
                  </label>
                );
              })}
              <span className="muted basis-full">
                {e.campaignIds.length
                  ? 'Closed to players outside the ticked campaigns. “Everyone” means everyone in them.'
                  : 'Outside campaigns: who sees it depends only on the eye setting.'}
              </span>
            </>
          ) : (
            <span>{system.campaigns.filter((c) => e.campaignIds.includes(c.id)).map((c) => c.name).join(', ')}</span>
          )}
        </div>
      )}

      {isDm && e.availableModules.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="muted">Sheet modules:</span>
          {e.availableModules.map((m) => {
            const on = e.modules.includes(m.key);
            return (
              <label key={m.key} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setModules.mutate({ id: e.id, modules: on ? e.modules.filter((x) => x !== m.key) : [...e.modules, m.key] })}
                />
                {m.name}
              </label>
            );
          })}
          <span className="muted basis-full">Extra sections for this {noun} only. Unticking hides a section but keeps what was typed in it.</span>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">Not saved: {error.message}</p>}

      {(e.schema.groups as Node[]).map((g) => renderNode(g, 0))}

      <div className="mt-6 flex flex-wrap gap-2">
        {isDm && (
          <button className="btn" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide history' : 'History'}
          </button>
        )}
        {e.canEdit && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm(`Delete “${e.name}”? The DM can restore it from the Data tab.`)) remove.mutate({ id: e.id });
            }}
          >
            Delete
          </button>
        )}
      </div>
      {isDm && showHistory && <History entity={e} noun={noun} onChanged={refresh} />}
    </div>
  );
}

function GroupBox(props: {
  id: string;
  label: string;
  picker: React.ReactNode;
  depth: number;
  forceOpen: boolean;
  matched: boolean;
  children: React.ReactNode;
}) {
  // Open or closed is remembered per browser. A search match inside opens the group while the search is on.
  const key = `group-open:${props.id}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '0');
  const toggle = () => {
    localStorage.setItem(key, open ? '0' : '1');
    setOpen(!open);
  };
  const shown = open || props.forceOpen;
  return (
    <section className={`card mb-3 ${props.depth ? 'border-dashed' : ''}`}>
      <header className="match-target flex items-center justify-between gap-2 rounded-md px-3 py-2" {...(props.matched ? { 'data-match': '' } : {})}>
        <button type="button" className="flex flex-1 cursor-pointer items-center gap-2 text-left font-semibold" onClick={toggle}>
          <span className="w-3 text-xs text-stone-400">{shown ? '▼' : '▶'}</span>
          {props.label}
        </button>
        {props.picker}
      </header>
      {shown && <div className="border-t border-stone-200 px-3 pt-3 pb-1 dark:border-stone-800">{props.children}</div>}
    </section>
  );
}

function NameInput(props: { name: string; disabled: boolean; onSave: (name: string) => void }) {
  const [value, setValue] = useState(props.name);
  return (
    <input
      className="input min-w-0 flex-1 text-lg font-semibold"
      aria-label="Name"
      value={value}
      disabled={props.disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const next = value.trim();
        if (next && next !== props.name) props.onSave(next);
        else setValue(props.name);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

type FieldInputProps = { field: Field; value: unknown; disabled: boolean; onSave: (value: unknown) => void };

/** Text and numbers are saved when the field loses focus; boxes, choices and counters are saved at once. */
function FieldInput({ field, value, disabled, onSave }: FieldInputProps) {
  const { type } = field;
  const asText = Array.isArray(value) ? value.join('\n') : value === null || value === undefined || typeof value === 'object' ? '' : String(value);
  const [draft, setDraft] = useState(asText);
  useEffect(() => setDraft(asText), [asText]);

  if (type === 'computed') {
    const shown = value === null || value === undefined ? '–' : field.signed && typeof value === 'number' && value >= 0 ? `+${value}` : String(value);
    return (
      <output className="block min-w-12 rounded-md bg-stone-200 px-3 py-2 text-center text-sm font-semibold dark:bg-stone-800" title="Worked out automatically">
        {shown}
      </output>
    );
  }

  if (type === 'boolean')
    return <input type="checkbox" className="mb-2.5 h-4 w-4" checked={value === true} disabled={disabled} onChange={(e) => onSave(e.target.checked)} />;

  if (type === 'select')
    return (
      <select className="input w-auto" value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(e) => onSave(e.target.value || null)}>
        <option value="">–</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );

  if (type === 'table') return <TableInput value={value as TableValue | null} disabled={disabled} onSave={onSave} />;

  if (type === 'pips') {
    const ticked = typeof value === 'number' ? value : 0;
    return <Pips ticked={ticked} max={field.max ?? 0} disabled={disabled} onChange={(n) => onSave(n === 0 ? null : n)} />;
  }

  if (type === 'pool') {
    const pool = value && typeof value === 'object' ? (value as { cur: number; max: number }) : { cur: 0, max: 0 };
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Pips ticked={pool.cur} max={pool.max} disabled={disabled} onChange={(cur) => onSave({ cur, max: pool.max })} />
        <span className="text-sm text-stone-500">
          {pool.cur} of{' '}
          <input
            className="input inline-block w-14 px-1 py-0.5 text-center"
            aria-label="Maximum"
            inputMode="numeric"
            disabled={disabled}
            key={pool.max}
            defaultValue={pool.max}
            onBlur={(e) => {
              const max = Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0)));
              if (max !== pool.max) onSave({ cur: Math.min(pool.cur, max), max });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </span>
      </div>
    );
  }

  const commit = () => {
    if (draft === asText) return;
    if (type === 'number') {
      if (draft.trim() === '') return onSave(null);
      const n = Number(draft.replace(',', '.'));
      if (Number.isFinite(n)) onSave(n);
      else setDraft(asText);
    } else if (type === 'list') {
      const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
      onSave(lines.length ? lines : null);
    } else onSave(draft === '' ? null : draft);
  };

  if (type === 'longtext' || type === 'list')
    return (
      <textarea
        className={`input ${type === 'list' ? 'min-h-20' : 'min-h-28'}`}
        placeholder={type === 'list' ? 'One per line' : undefined}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
  return (
    <input
      className={`input ${type === 'number' ? 'w-20' : ''}`}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

type TableValue = { columns: string[]; rows: string[][] };

/** A free table. A cell is saved when it loses focus; rows and columns are added and removed with the buttons. */
function TableInput({ value, disabled, onSave }: { value: TableValue | null; disabled: boolean; onSave: (value: unknown) => void }) {
  if (!value && disabled) return <span className="text-sm text-stone-400">no table</span>;
  if (!value)
    return (
      <button type="button" className="btn" onClick={() => onSave({ columns: ['', ''], rows: [['', '']] })}>
        Add a table
      </button>
    );
  const { columns, rows } = value;
  const setHeading = (c: number, text: string) => text !== columns[c] && onSave({ columns: columns.map((x, i) => (i === c ? text : x)), rows });
  const setCell = (r: number, c: number, text: string) =>
    text !== rows[r]![c] && onSave({ columns, rows: rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? text : x)) : row)) });
  const cellClass = 'input rounded-none border-0 px-2 py-1';
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              {columns.map((heading, c) => (
                <th key={`${c}:${heading}`} className="border border-stone-300 p-0 dark:border-stone-700">
                  <input
                    className={`${cellClass} font-semibold`}
                    aria-label={`Heading of column ${c + 1}`}
                    defaultValue={heading}
                    disabled={disabled}
                    onBlur={(e) => setHeading(c, e.target.value)}
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={`${c}:${cell}`} className="border border-stone-300 p-0 dark:border-stone-700">
                    <input
                      className={cellClass}
                      aria-label={`Row ${r + 1}, column ${c + 1}`}
                      defaultValue={cell}
                      disabled={disabled}
                      onBlur={(e) => setCell(r, c, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </td>
                ))}
                <td className="pl-1">
                  {!disabled && (
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-xs"
                      aria-label={`Remove row ${r + 1}`}
                      onClick={() => onSave({ columns, rows: rows.filter((_, i) => i !== r) })}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => onSave({ columns, rows: [...rows, columns.map(() => '')] })}>
            + Row
          </button>
          {columns.length < 20 && (
            <button
              type="button"
              className="btn px-2 py-0.5 text-xs"
              onClick={() => onSave({ columns: [...columns, ''], rows: rows.map((row) => [...row, '']) })}
            >
              + Column
            </button>
          )}
          {columns.length > 1 && (
            <button
              type="button"
              className="btn px-2 py-0.5 text-xs"
              onClick={() => confirm('Remove the last column?') && onSave({ columns: columns.slice(0, -1), rows: rows.map((row) => row.slice(0, -1)) })}
            >
              − Last column
            </button>
          )}
          <button type="button" className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => confirm('Remove the whole table?') && onSave(null)}>
            Remove table
          </button>
        </div>
      )}
    </div>
  );
}

/** A row of boxes. Clicking box N ticks N boxes; clicking the last ticked box unticks it. */
function Pips(props: { ticked: number; max: number; disabled: boolean; onChange: (ticked: number) => void }) {
  if (!props.max) return <span className="text-sm text-stone-400">none</span>;
  return (
    <div className="flex flex-wrap gap-1 py-1.5">
      {Array.from({ length: props.max }, (_, i) => (
        <button
          key={i}
          type="button"
          disabled={props.disabled}
          aria-label={`${i + 1} of ${props.max}`}
          aria-pressed={i < props.ticked}
          className={`h-5 w-5 rounded border ${
            i < props.ticked ? 'border-sky-700 bg-sky-700' : 'border-stone-400 bg-transparent'
          } ${props.disabled ? 'opacity-60' : 'cursor-pointer'}`}
          onClick={() => props.onChange(i + 1 === props.ticked ? i : i + 1)}
        />
      ))}
    </div>
  );
}

function History({ entity, noun, onChanged }: { entity: Entity; noun: string; onChanged: () => void }) {
  const history = trpc.entity.history.useQuery({ id: entity.id });
  const revert = trpc.entity.revert.useMutation({ onSuccess: onChanged });
  if (!history.data) return <p className="muted mt-3">Loading…</p>;
  const show = (v: unknown) => {
    if (v === null || v === undefined) return '(empty)';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  };
  const what: Record<string, string> = {
    create: `created the ${noun}`,
    delete: `deleted the ${noun}`,
    restore: `restored the ${noun}`,
    name: 'renamed',
    owner: 'changed the owner',
    campaigns: 'changed the campaign',
    modules: 'changed the sheet modules',
    visibility: `changed who can see the ${noun}`,
    fieldVisibility: 'changed who can see a part',
    link: 'changed a link',
  };
  return (
    <div className="card mt-3 divide-y divide-stone-200 text-sm dark:divide-stone-800">
      {history.data.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <span className="font-medium">{c.userName ?? 'Someone'}</span>{' '}
            {c.target === 'field' ? (
              <>
                changed <span className="font-medium">{c.label}</span>: <span className="text-stone-500">{show(c.oldValue)}</span> →{' '}
                {show(c.newValue)}
              </>
            ) : c.target === 'name' ? (
              <>
                renamed: <span className="text-stone-500">{show(c.oldValue)}</span> → {show(c.newValue)}
              </>
            ) : (
              what[c.target]
            )}
            <div className="text-xs text-stone-500">{new Date(c.at).toLocaleString()}</div>
          </div>
          {c.canRevert && (
            <button className="btn px-2 py-0.5 text-xs" disabled={revert.isPending} onClick={() => revert.mutate({ changeId: c.id })}>
              Undo this
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
