import { useState } from 'react';

export type CustomField = { id: string; label: string; type: FieldKind; max?: number };
export type CustomGroup = { id: string; label: string; children: CustomField[] };
type FieldKind = 'text' | 'longtext' | 'richtext' | 'number' | 'boolean' | 'pips' | 'pool' | 'list';

const KINDS: { value: FieldKind; label: string }[] = [
  { value: 'pool', label: 'Uses with a maximum (e.g. 2 of 3)' },
  { value: 'pips', label: 'Tick boxes (fixed number)' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Short text' },
  { value: 'richtext', label: 'Long text' },
  { value: 'list', label: 'List' },
  { value: 'boolean', label: 'Checkbox' },
];

const newId = () => `c_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;

type Props = { groups: CustomGroup[]; noun: string; onChange: (groups: CustomGroup[]) => void };

/** The DM's controls for sections and fields that exist on this one sheet only. */
export function CustomFields({ groups, noun, onChange }: Props) {
  const [sectionName, setSectionName] = useState('');
  return (
    <section className="card mt-6 p-3 text-sm">
      <h3 className="font-semibold">Custom sections</h3>
      <p className="muted mb-3">
        Sections and fields for this {noun} only; other {noun}s do not get them. Removing a field hides it but keeps what was typed in it.
      </p>
      {groups.map((g) => (
        <GroupEditor
          key={g.id}
          group={g}
          onChange={(next) => onChange(groups.map((x) => (x.id === g.id ? next : x)))}
          onRemove={() => confirm(`Remove the section “${g.label}” from this ${noun}?`) && onChange(groups.filter((x) => x.id !== g.id))}
        />
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sectionName.trim()) return;
          onChange([...groups, { id: newId(), label: sectionName.trim(), children: [] }]);
          setSectionName('');
        }}
      >
        <input className="input max-w-xs" placeholder="New section name…" aria-label="New section name" value={sectionName} onChange={(e) => setSectionName(e.target.value)} />
        <button className="btn" disabled={!sectionName.trim()}>
          Add section
        </button>
      </form>
    </section>
  );
}

function GroupEditor({ group, onChange, onRemove }: { group: CustomGroup; onChange: (g: CustomGroup) => void; onRemove: () => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<FieldKind>('pool');
  const [count, setCount] = useState('3');
  return (
    <div className="mb-3 rounded-md border border-line p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{group.label}</span>
        <span className="flex gap-2">
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => {
              const next = prompt('Section name:', group.label);
              if (next?.trim()) onChange({ ...group, label: next.trim() });
            }}
          >
            Rename
          </button>
          <button type="button" className="btn btn-danger px-2 py-0.5 text-xs" onClick={onRemove}>
            Remove section
          </button>
        </span>
      </div>
      <ul className="mb-2 space-y-1">
        {group.children.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2">
            <span>
              {f.label} <span className="text-xs text-muted">· {KINDS.find((k) => k.value === f.type)?.label ?? f.type}</span>
            </span>
            <button
              type="button"
              className="btn px-2 py-0.5 text-xs"
              aria-label={`Remove field ${f.label}`}
              onClick={() => confirm(`Remove the field “${f.label}”?`) && onChange({ ...group, children: group.children.filter((x) => x.id !== f.id) })}
            >
              ×
            </button>
          </li>
        ))}
        {!group.children.length && <li className="muted">No fields yet.</li>}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          const max = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));
          onChange({ ...group, children: [...group.children, { id: newId(), label: label.trim(), type: kind, ...(kind === 'pips' ? { max } : {}) }] });
          setLabel('');
        }}
      >
        <input className="input max-w-52" placeholder="New field name…" aria-label={`New field name in ${group.label}`} value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className="input w-auto" aria-label="Kind of field" value={kind} onChange={(e) => setKind(e.target.value as FieldKind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {kind === 'pips' && (
          <input className="input w-16" aria-label="Number of boxes" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        )}
        <button className="btn" disabled={!label.trim()}>
          Add field
        </button>
      </form>
    </div>
  );
}
