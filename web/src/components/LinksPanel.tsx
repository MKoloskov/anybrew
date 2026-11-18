import { useState } from 'react';
import { Link } from 'wouter';
import { featureHeading } from '../features';
import { useBilingual } from '../lang';
import { tabOfType } from '../tabs';
import { trpc, type Out } from '../trpc';

type LinkRow = Out['entity']['links'][number];

// What a character can be linked to, and the kind of link each one is.
const LINKABLE = [
  { typeKey: 'feature', kind: 'has', title: 'Features' },
  { typeKey: 'spell', kind: 'knows', title: 'Spells' },
  { typeKey: 'item', kind: 'owns', title: 'Items' },
];
const CIRCLE = (n: number) => (n === 0 ? 'Cantrips' : `Circle ${n}`);

type Props = { entityId: string; systemId: string; typeKey: string; canEdit: boolean; canAddHolders: boolean };

/**
 * On a character: its features, spells and items, each opening its own page.
 * On a feature, spell or item: the characters that have it.
 */
export function LinksPanel({ entityId, systemId, typeKey, canEdit, canAddHolders }: Props) {
  const utils = trpc.useUtils();
  const links = trpc.entity.links.useQuery({ id: entityId }, { refetchInterval: 10_000 });
  const refresh = () => {
    void utils.entity.links.invalidate();
    // The lists show who has what.
    void utils.entity.list.invalidate();
    void utils.entity.history.invalidate({ id: entityId });
  };
  const unlink = trpc.entity.unlink.useMutation({ onSuccess: refresh });
  const bilingual = useBilingual();
  // Class features up to the character's level in each class come with the class; they are not links.
  const classInfo = trpc.entity.classInfo.useQuery({ id: entityId }, { enabled: typeKey === 'character', refetchInterval: 10_000 });
  const linked = links.data ?? [];
  const fromClasses: LinkRow[] = (classInfo.data ?? [])
    .flatMap((c) => (c.found ? c.features : []))
    .filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i && !linked.some((l) => l.direction === 'out' && l.other.id === f.id))
    .map((f) => ({ id: `class:${f.id}`, kind: 'has', direction: 'out' as const, data: { fromClass: true }, other: { ...f, typeKey: 'feature' } }));
  const rows = [...linked, ...fromClasses];

  const row = (l: LinkRow, removable: boolean) => {
    const tab = tabOfType(l.other.typeKey);
    const quantity = typeof l.data.quantity === 'number' && l.data.quantity !== 1 ? ` × ${l.data.quantity}` : '';
    const note = typeof l.data.note === 'string' && l.data.note ? ` · ${l.data.note}` : '';
    return (
      <li key={l.id} className="flex items-baseline justify-between gap-2" data-link={l.other.name}>
        <span>
          {l.other.info.tier !== null && <span className="mr-1 text-xs text-muted">[{l.other.info.tier}]</span>}
          <Link href={`/s/${systemId}/${tab?.key ?? 'notes'}/${l.other.id}`} className="text-accent underline">
            {bilingual(l.other.name, l.other.nameRu)}
          </Link>
          <span className="text-muted">
            {quantity}
            {l.other.info.action && l.other.typeKey !== 'item' ? ` · ${l.other.info.action}` : ''}
            {note}
            {l.data.fromClass === true && ' · from class'}
          </span>
        </span>
        {removable && l.data.fromClass !== true && (
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            aria-label={`Remove ${l.other.name}`}
            onClick={() =>
              confirm(
                l.direction === 'out'
                  ? `Remove “${l.other.name}” from this character? The ${tab?.noun ?? 'entry'} itself stays in the library.`
                  : `Take this away from “${l.other.name}”? The character itself stays.`,
              ) && unlink.mutate({ linkId: l.id })
            }
          >
            ×
          </button>
        )}
      </li>
    );
  };

  if (typeKey !== 'character') {
    const holders = rows.filter((l) => l.direction === 'in' && l.other.typeKey === 'character');
    if (!holders.length && !canAddHolders) return null;
    return (
      <section className="card mb-3 p-3 text-sm" data-links="Characters">
        <h3 className="mb-2 font-semibold">
          Characters that have it <span className="font-normal text-muted">· {holders.length}</span>
        </h3>
        {!holders.length && <p className="muted mb-2">Nobody yet.</p>}
        <ul className="space-y-1">{[...holders].sort((a, b) => a.other.name.localeCompare(b.other.name)).map((l) => row(l, canAddHolders))}</ul>
        {canAddHolders && (
          <AddLink
            entityId={entityId}
            systemId={systemId}
            section={{ typeKey: 'character', kind: LINKABLE.find((x) => x.typeKey === typeKey)?.kind ?? 'has', title: 'Characters' }}
            reverse
            withQuantity={typeKey === 'item'}
            taken={new Set(holders.map((l) => l.other.id))}
            onAdded={refresh}
          />
        )}
      </section>
    );
  }

  return (
    <>
      {LINKABLE.map((section) => {
        const mine = rows.filter((l) => l.direction === 'out' && l.kind === section.kind && l.other.typeKey === section.typeKey);
        if (!mine.length && !canEdit) return null;
        // Features are grouped by their library section, spells by circle; items are one list.
        const groupOf = (l: LinkRow) =>
          section.typeKey === 'feature' ? featureHeading(l.other.info) : section.typeKey === 'spell' ? (l.other.info.circle !== null ? CIRCLE(l.other.info.circle) : 'Other') : '';
        const groups = new Map<string, LinkRow[]>();
        for (const l of [...mine].sort(
          (a, b) => (a.other.info.circle ?? 99) - (b.other.info.circle ?? 99) || (a.other.info.tier ?? 0) - (b.other.info.tier ?? 0) || a.other.name.localeCompare(b.other.name),
        ))
          groups.set(groupOf(l), [...(groups.get(groupOf(l)) ?? []), l]);
        return (
          <section key={section.typeKey} className="card mb-3 p-3 text-sm" data-links={section.title}>
            <h3 className="mb-2 font-semibold">
              {section.title} <span className="font-normal text-muted">· {mine.length}</span>
            </h3>
            {!mine.length && <p className="muted mb-2">None yet.</p>}
            <div className={section.typeKey === 'item' ? '' : 'grid gap-x-6 gap-y-3 sm:grid-cols-2'}>
              {[...groups.entries()].map(([name, list]) => (
                <div key={name}>
                  {name && <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{name}</div>}
                  <ul className={section.typeKey === 'item' ? 'grid gap-x-6 gap-y-1 sm:grid-cols-2' : 'space-y-1'}>{list.map((l) => row(l, canEdit))}</ul>
                </div>
              ))}
            </div>
            {canEdit && <AddLink entityId={entityId} systemId={systemId} section={section} withQuantity={section.typeKey === 'item'} taken={new Set(mine.map((l) => l.other.id))} onAdded={refresh} />}
          </section>
        );
      })}
    </>
  );
}

type AddLinkProps = {
  entityId: string;
  systemId: string;
  section: (typeof LINKABLE)[number];
  /** The entity on this page is what gets added to the chosen character, not the other way round. */
  reverse?: boolean;
  withQuantity: boolean;
  taken: Set<string>;
  onAdded: () => void;
};

function AddLink(props: AddLinkProps) {
  const { section } = props;
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState('');
  const [quantity, setQuantity] = useState('1');
  const list = trpc.entity.list.useQuery({ systemId: props.systemId, typeKey: section.typeKey }, { enabled: open });
  const bilingual = useBilingual();
  const link = trpc.entity.link.useMutation({
    onSuccess: () => {
      setChosen('');
      setQuantity('1');
      props.onAdded();
    },
  });
  const noun = tabOfType(section.typeKey)?.noun ?? 'entry';
  if (!open)
    return (
      <button type="button" className="btn mt-2 px-2 py-0.5 text-xs" onClick={() => setOpen(true)}>
        + Add {noun}
      </button>
    );
  const free = (list.data ?? []).filter((x) => !props.taken.has(x.id));
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!chosen) return;
        const n = Math.max(1, Math.min(9999, Math.floor(Number(quantity) || 1)));
        const [fromId, toId] = props.reverse ? [chosen, props.entityId] : [props.entityId, chosen];
        link.mutate({ fromId, kind: section.kind, toId, data: props.withQuantity ? { quantity: n } : {} });
      }}
    >
      <select className="input w-auto max-w-xs" aria-label={`${section.title} to add`} value={chosen} onChange={(ev) => setChosen(ev.target.value)}>
        <option value="">{list.data ? (props.reverse ? 'Choose a character…' : `Choose a ${noun} from the library…`) : 'Loading…'}</option>
        {free.map((x) => (
          <option key={x.id} value={x.id}>
            {bilingual(x.name, x.nameRu)}
          </option>
        ))}
      </select>
      {props.withQuantity && (
        <input className="input w-16" aria-label="Quantity" inputMode="numeric" value={quantity} onChange={(ev) => setQuantity(ev.target.value)} />
      )}
      <button className="btn btn-primary px-2 py-0.5 text-xs" disabled={!chosen || link.isPending}>
        Add
      </button>
      <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setOpen(false)}>
        Done
      </button>
    </form>
  );
}
