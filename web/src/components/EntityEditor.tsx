import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { trpc, type System, type Entity } from '../trpc';
import { DEFAULT_TYPES, type SheetPart } from '../features';
import { Label, useBilingual, useLang } from '../lang';
import { AudiencePicker, describeAudience } from './AudiencePicker';
import { entityMark, nodeMark, VisChip } from './Visibility';
import { ClassesInput } from './Classes';
import { CustomFields, type CustomGroup } from './CustomFields';
import { LinksPanel } from './LinksPanel';
import { Gallery } from './Gallery';
import { PageMenu, type SheetPage } from './SheetPages';
import { D20Divider, FramedPortrait, HomeSummary } from './SheetViews';
import { RichTextEditor, RichTextView } from './RichText';
import { TalentTree, talentText, type Picks, type TalentData } from './TalentTree';

type Props = {
  entityId: string;
  system: System;
  noun: string;
  onClose: () => void;
  /** A back button shown on every screen size, for a page that stands alone. */
  back?: string;
  /**
   * For a type whose sheet has pages (the character): the page in the address, and the address of
   * each page. Without them the sheet is one long page.
   */
  page?: string;
  pageHref?: (page: string) => string;
};

/** What a character has, listed on the page it belongs to. */
const LINK_PART: Record<string, SheetPart> = { class: 'class', subclass: 'subclass', hero: 'hero', inventory: 'items', spells: 'spells' };

const KIND_LABEL: Record<string, string> = { pc: 'PC', npc: 'NPC', aux: 'Aux' };

// The server sends the schema as nested groups and fields; this is the shape the screen needs from it.
type Field = {
  kind: 'field';
  id: string;
  label: string;
  ru?: string;
  type: string;
  options?: { value: string; label: string }[];
  max?: number;
  signed?: boolean;
  columns?: string[];
  main?: string;
  dmEditOnly?: boolean;
  visibility?: Parameters<typeof describeAudience>[0];
};
type Group = {
  kind: 'group';
  id: string;
  label: string;
  ru?: string;
  custom?: boolean;
  layout?: 'row';
  page?: string;
  children: Node[];
  visibility?: Field['visibility'];
};
type Node = Field | Group;

/** Text of a value as the search sees it. */
function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'string') return value.replace(/<[^>]+>/g, ' ');
  if (typeof value === 'object') {
    if ('patrons' in (value as object)) return talentText(value as TalentData);
    const t = value as { columns?: string[]; rows?: string[][] };
    return t.columns && t.rows ? [t.columns, ...t.rows].map((r) => r.join(' ')).join('\n') : '';
  }
  return String(value);
}

// A newly created entity opens in Edit mode; every other page opens in Read mode.
const openInEdit = new Set<string>();
export function markNew(id: string) {
  openInEdit.add(id);
}

/** True when a value has nothing to show in Read mode. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return !/<img/i.test(value) && value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
  return false;
}

export function EntityEditor({ entityId, system, noun, onClose, back, page, pageHref }: Props) {
  const utils = trpc.useUtils();
  const entity = trpc.entity.get.useQuery({ id: entityId }, { refetchInterval: 10_000 });
  const isDm = system.role === 'dm';
  const refresh = () => {
    void utils.entity.get.invalidate({ id: entityId });
    void utils.entity.list.invalidate();
    void utils.entity.history.invalidate({ id: entityId });
    // A class, a level or a class feature may have changed what the classes give.
    void utils.entity.classInfo.invalidate();
    // A glossary term may have just been edited; labels everywhere read from the glossary.
    void utils.entity.glossary.invalidate();
  };
  const rename = trpc.entity.rename.useMutation({ onSuccess: refresh });
  const setField = trpc.entity.setField.useMutation({ onSuccess: refresh });
  const setVisibility = trpc.entity.setVisibility.useMutation({ onSuccess: refresh });
  const setFieldVisibility = trpc.entity.setFieldVisibility.useMutation({ onSuccess: refresh });
  const setOwner = trpc.entity.setOwner.useMutation({ onSuccess: refresh });
  const setCampaigns = trpc.entity.setCampaigns.useMutation({ onSuccess: refresh });
  const setModules = trpc.entity.setModules.useMutation({ onSuccess: refresh });
  const setNameRu = trpc.entity.setNameRu.useMutation({ onSuccess: refresh });
  const setTranslation = trpc.entity.setTranslation.useMutation({ onSuccess: refresh });
  const setCustomSchema = trpc.entity.setCustomSchema.useMutation({ onSuccess: refresh });
  const [talentMessage, setTalentMessage] = useState<string | null>(null);
  const importTalents = trpc.entity.importTalents.useMutation({
    onSuccess: (r) => {
      setTalentMessage(`Loaded ${r.trees} trees with ${r.talents} talents, ${r.taken} of them taken.`);
      refresh();
    },
    onError: (err) => setTalentMessage(`Not loaded: ${err.message}`),
  });
  const lang = useLang();
  // Type and Class of a feature offer what other features already use, so the same word is not typed two ways.
  const peers = trpc.entity.list.useQuery({ systemId: system.id, typeKey: 'feature' }, { enabled: entity.data?.typeKey === 'feature' });
  const suggestions = useMemo(() => {
    const used = (key: 'ftype' | 'class') => (peers.data ?? []).map((p) => p.info[key]).filter((v): v is string => !!v);
    const sorted = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
    return { ftype: sorted([...DEFAULT_TYPES, ...used('ftype')]), class: sorted(used('class')) } as Record<string, string[]>;
  }, [peers.data]);
  const remove = trpc.entity.delete.useMutation({
    onSuccess: () => {
      void utils.entity.list.invalidate();
      void utils.entity.listDeleted.invalidate();
      onClose();
    },
  });
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(() => openInEdit.has(entityId));
  useEffect(() => {
    openInEdit.delete(entityId);
  }, [entityId]);
  const bilingual = useBilingual();
  const [query, setQuery] = useState('');
  const [step, setStep] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const e = entity.data;
  const q = query.trim().toLowerCase();

  // Pages of the sheet: which ones this viewer has, and which one is open.
  const sheet = useMemo(() => {
    if (!e?.schema.pages?.length || !pageHref) return null;
    const groups = e.schema.groups as Group[];
    const find = (nodes: Node[], id: string): Node | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const hit = n.kind === 'group' ? find(n.children, id) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    const fieldIds = (n: Node): string[] => (n.kind === 'field' ? [n.id] : n.children.flatMap(fieldIds));
    // Someone who may see the character but is neither its owner nor the DM receives its outside view.
    const outsider = system.role !== 'dm' && !e.canEdit;
    const outside = new Set(e.schema.outside ?? []);
    const pages: SheetPage<Node>[] = e.schema.pages.map((p) => ({
      key: p.key,
      label: p.label,
      groups: groups.filter((g) => g.page === p.key),
      shows: (p.shows ?? []).map((id) => find(groups, id)).filter((n): n is Node => !!n),
      part: LINK_PART[p.key],
    }));
    // A page with nothing this viewer may see is not in their menu. Another player has the Preview,
    // and only those further pages that hold something the DM opened to them on this character.
    const visible = pages.filter((p) => {
      if (outsider) return p.key === 'preview' || [...p.groups, ...p.shows].some((n) => fieldIds(n).some((id) => !outside.has(id)));
      return p.groups.length > 0 || p.shows.length > 0 || !!p.part;
    });
    const first = outsider ? 'preview' : 'home';
    const fallback = visible.find((p) => p.key === first)?.key ?? visible[0]?.key ?? '';
    const current = visible.find((p) => p.key === page) ?? visible.find((p) => p.key === fallback)!;
    return { pages: visible, current, fallback };
  }, [e, page, pageHref, system.role]);
  const currentPage = sheet?.current.key;

  // An address without a page, or with one this viewer does not have, is replaced by the first page.
  useEffect(() => {
    if (sheet && pageHref && page !== sheet.current.key) navigate(pageHref(sheet.current.key), { replace: true });
  }, [sheet, page, pageHref, navigate]);

  // Every page of the sheet opens for reading and at its top, also when Edit was on for the page before.
  const shownPage = useRef(currentPage);
  useEffect(() => {
    if (!currentPage || shownPage.current === currentPage) return;
    if (shownPage.current !== undefined) {
      setEditing(false);
      setStep(0);
      window.scrollTo(0, 0);
    }
    shownPage.current = currentPage;
  }, [currentPage]);

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
  const error =
    setField.error ?? rename.error ?? setVisibility.error ?? setFieldVisibility.error ?? setModules.error ?? setCustomSchema.error ?? setTranslation.error;

  const contains = (node: Node): boolean => matches.has(node.id) || (node.kind === 'group' && node.children.some(contains));
  const mark = (id: string) => (matches.has(id) ? { 'data-match': '' } : {});

  // The DM-only style: what players cannot see is tinted and outlined for the DM, with a chip saying who can see it.
  // A player has no `access`, so nothing is marked for them.
  const pageMark = isDm && e.access ? entityMark(system, { ownerId: e.ownerId, visibility: e.access.visibility }) : null;
  const markOf = (node: Node) =>
    isDm && e.access
      ? nodeMark(system, { ownerId: e.ownerId, closedToOthers: !!e.schema.outside }, e.access.fieldVisibility[node.id] ?? node.visibility)
      : null;
  const secretClass = (node: Node) => (markOf(node)?.tone === 'secret' ? 'secret' : '');

  // While reading the chip is a label; in Edit the same chip is the button that opens the choice.
  const pickerFor = (node: Node) => {
    if (!isDm) return null;
    const mark = markOf(node);
    if (!editing) return mark ? <VisChip mark={mark} /> : null;
    const override = e.access?.fieldVisibility[node.id] ?? null;
    const schemaDefault = node.visibility ? describeAudience(node.visibility, system) : 'same as above';
    return (
      <AudiencePicker
        compact
        system={system}
        value={override}
        defaultLabel={schemaDefault}
        mark={mark}
        onChange={(audience) => setFieldVisibility.mutate({ id: e.id, nodeId: node.id, audience })}
      />
    );
  };

  const input = (node: Field) => {
    const value = e.values[node.id] ?? null;
    const editable = e.editableFields.includes(node.id);
    // In Read mode only counters (tick boxes, pips, pools) and talent picks stay usable.
    const disabled = !editable || (!editing && !COUNTERS.has(node.type));
    const onSave = (next: unknown) => setField.mutate({ id: e.id, fieldId: node.id, value: next });
    if (node.type === 'talents')
      return (
        <TalentTree
          data={(value as TalentData | null) ?? null}
          picks={(e.values[`${node.id}_taken`] as Picks | undefined) ?? {}}
          canPick={e.editableFields.includes(`${node.id}_taken`)}
          canLoad={isDm && editing}
          onPicks={(picks) => setField.mutate({ id: e.id, fieldId: `${node.id}_taken`, value: picks })}
          onLoad={(markdown) => importTalents.mutate({ id: e.id, markdown })}
          loadMessage={talentMessage}
        />
      );
    if (node.type === 'classes') return <ClassesInput entityId={e.id} systemId={e.systemId} value={value} disabled={disabled} onSave={onSave} />;
    if (node.type === 'gallery')
      return (
        <Gallery
          entityId={e.id}
          fieldId={node.id}
          pictures={Array.isArray(value) ? (value as string[]) : []}
          main={node.main ? (e.values[node.main] as string | undefined) : undefined}
          disabled={disabled}
          canSetMain={editing && !!node.main && e.editableFields.includes(node.main)}
          onChanged={refresh}
        />
      );
    if (node.type === 'image') return <ImageInput entityId={e.id} fieldId={node.id} value={value} disabled={disabled} onChanged={refresh} onSave={onSave} />;
    if (node.type === 'longtext' || node.type === 'richtext')
      return (
        <LongText
          field={node}
          value={value}
          translation={e.translations[node.id] ?? null}
          lang={lang}
          canTranslate={isDm && editing}
          reading={!editing}
          disabled={disabled}
          onSave={onSave}
          onTranslate={(text) => setTranslation.mutate({ id: e.id, fieldId: node.id, text })}
        />
      );
    return (
      <FieldInput
        field={node}
        value={value}
        disabled={disabled}
        reading={!editing}
        onSave={onSave}
        suggestions={e.typeKey === 'feature' ? suggestions[node.id] : undefined}
      />
    );
  };

  // Read mode hides fields with nothing in them, and rows and groups with nothing to show.
  const fieldShown = (f: Field): boolean => {
    if (editing) return true;
    const value = e.values[f.id];
    switch (f.type) {
      case 'computed':
        return value !== null && value !== undefined;
      case 'boolean':
        return value === true || e.editableFields.includes(f.id);
      case 'pips':
        return !!f.max;
      case 'pool':
        return !!value && typeof value === 'object' && (value as { max: number }).max > 0;
      case 'talents':
        return !!value;
      case 'talentpicks':
        return false;
      case 'table':
        return !!value && ((value as TableValue).rows?.length ?? 0) > 0;
      case 'longtext':
      case 'richtext':
        return !isEmpty(value) || !!e.translations[f.id];
      default:
        return !isEmpty(value);
    }
  };
  const nodeShown = (node: Node): boolean => {
    if (editing) return true;
    if (node.kind === 'field') return fieldShown(node);
    return node.children.some(nodeShown);
  };

  const renderNode = (node: Node, depth: number, shownHere = false): React.ReactNode => {
    if (depth > 0 && !nodeShown(node)) return null;
    if (node.kind === 'group' && node.layout === 'row')
      return (
        <div key={node.id} className={`sheet-row match-target flex flex-wrap items-end gap-x-3 gap-y-1 rounded-md border-b border-line px-1 py-1 last:border-b-0 ${secretClass(node)}`}>
          <span className={`w-full sm:w-44 sm:pb-2 ${ABILITY_ROWS.test(node.id) ? 'display text-base' : 'text-sm font-medium'}`}>
            <Label text={node.label} ru={node.ru} />
          </span>
          {node.children.map((c) =>
            c.kind === 'field' ? (
              <label key={c.id} className="match-target rounded-md px-1" {...mark(c.id)}>
                <span className="block text-xs text-muted">
                  <Label text={c.label} ru={c.ru} />
                </span>
                {input(c)}
              </label>
            ) : null,
          )}
          <span className="ml-auto self-center">{pickerFor(node)}</span>
        </div>
      );
    if (node.kind === 'group')
      return (
        <GroupBox
          key={node.id}
          id={`${e.typeKey}.${node.id}`}
          label={<Label text={node.label} ru={node.ru} />}
          picker={pickerFor(node)}
          secret={markOf(node)?.tone === 'secret'}
          depth={depth}
          forceOpen={q !== '' && contains(node)}
          matched={matches.has(node.id)}
        >
          {node.children.map((c) => renderNode(c, depth + 1))}
          {!node.children.length ? (
            <p className="muted">Nothing here that you can see.</p>
          ) : (
            !nodeShown(node) && <p className="muted pb-2 italic">Nothing filled in.</p>
          )}
        </GroupBox>
      );
    // Which talents are taken is shown inside the tree of the field before it.
    if (node.type === 'talentpicks') return null;
    // PC / NPC / Aux is chosen at the top of the sheet, next to the campaigns.
    if (e.typeKey === 'character' && node.id === 'kind') return null;
    // The main picture of a gallery is shown and chosen inside the gallery, unless a page shows it on its own.
    if (galleryMains.has(node.id) && !shownHere) return null;
    return (
      <div key={node.id} className={`match-target mb-3 rounded-md px-1 ${secretClass(node) && 'secret py-1'}`} {...mark(node.id)}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="label mb-0">
            <Label text={node.label} ru={node.ru} />
            {editing && node.dmEditOnly && <span className="ml-1 text-muted">(set by the DM)</span>}
          </span>
          {pickerFor(node)}
        </div>
        {input(node)}
      </div>
    );
  };

  // On a sheet with pages the search counts the open page here and every other page in the menu.
  const countIn = (nodes: Node[]): number => nodes.reduce((sum, n) => sum + (matches.has(n.id) ? 1 : 0) + (n.kind === 'group' ? countIn(n.children) : 0), 0);
  const pageCounts: Record<string, number> = {};
  // Home only gathers values of other pages, so its matches are counted where they are stored.
  if (sheet && q) for (const p of sheet.pages) if (p.key !== 'home') pageCounts[p.key] = countIn([...p.groups, ...p.shows]);
  const matchCount = sheet ? (pageCounts[sheet.current.key] ?? 0) : matches.size;
  const otherMatches = sheet ? Object.entries(pageCounts).reduce((sum, [key, n]) => sum + (key === sheet.current.key ? 0 : n), 0) : 0;
  const galleryMains = new Set<string>();
  const collectMains = (nodes: Node[]) =>
    nodes.forEach((n) => (n.kind === 'group' ? collectMains(n.children) : n.type === 'gallery' && n.main && galleryMains.add(n.main)));
  collectMains(e.schema.groups as Node[]);
  const findNode = (nodes: Node[], id: string): Field | undefined => {
    for (const n of nodes) {
      const hit = n.kind === 'field' ? (n.id === id ? n : undefined) : findNode(n.children, id);
      if (hit) return hit;
    }
    return undefined;
  };
  const kindField = e.typeKey === 'character' ? findNode(e.schema.groups as Node[], 'kind') : undefined;
  const kindValue = typeof e.values.kind === 'string' ? e.values.kind : null;
  // The Edit button shows for anyone who may change something here.
  const canChange = isDm || e.canEdit || e.editableFields.length > 0;

  // Owner, kind, campaigns and modules: at the top of an entity, under "Sheet settings" on a sheet with pages.
  const controls = (
    <>
      {editing && isDm && (
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

      {editing && kindField && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-kind={kindValue ?? ''}>
          <span className="muted">Kind:</span>
          {e.editableFields.includes('kind') ? (
            <div className="flex overflow-hidden rounded-md border border-line">
              {(kindField.options ?? []).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={kindValue === o.value}
                  className={`cursor-pointer px-3 py-1 ${kindValue === o.value ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`}
                  onClick={() => setField.mutate({ id: e.id, fieldId: 'kind', value: kindValue === o.value ? null : o.value })}
                >
                  {KIND_LABEL[o.value] ?? o.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="font-medium">{kindValue ? (KIND_LABEL[kindValue] ?? kindValue) : '–'}</span>
          )}
          <span className="muted">Aux is a background character with barely more than a name.</span>
        </div>
      )}

      {editing && isDm && e.typeKey === 'character' && system.campaigns.length === 0 && (
        <p className="muted mb-4 text-sm">Campaign: there are no campaigns yet. Create one on the People tab, then tick it here.</p>
      )}

      {editing && system.campaigns.length > 0 && (isDm || e.campaignIds.length > 0) && (
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

      {editing && isDm && e.availableModules.length > 0 && (
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

    </>
  );

  // Who can see the whole page, beside its name: everyone, or the chip of the DM-only style.
  const seenBy = isDm && e.access && <VisChip mark={pageMark ?? { tone: 'open', text: 'Seen by: everyone' }} />;
  const nameBlock = (
    <>
      {!editing ? (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${sheet ? 'mb-1' : 'mb-4'} ${pageMark ? 'secret rounded-md px-2 py-1' : ''}`} data-name-line>
          <h1 className="display text-2xl" data-entity-name>
            {bilingual(e.name, e.nameRu)}
          </h1>
          {seenBy}
        </div>
      ) : (
      <div className={`flex flex-wrap items-center gap-2 ${sheet ? 'mb-1' : 'mb-4'} ${pageMark ? 'secret rounded-md px-2 py-1' : ''}`} data-name-line>
        <NameInput key={e.name} name={e.name} disabled={!e.canEdit} onSave={(name) => rename.mutate({ id: e.id, name })} />
        {(e.canEdit || e.nameRu) && (
          <input
            className="input w-56"
            aria-label="Russian name"
            placeholder="Russian name…"
            key={`ru:${e.nameRu}`}
            defaultValue={e.nameRu ?? ''}
            disabled={!e.canEdit}
            onBlur={(ev) => ev.target.value.trim() !== (e.nameRu ?? '') && setNameRu.mutate({ id: e.id, nameRu: ev.target.value })}
            onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()}
          />
        )}
        {isDm && e.access && !sheet ? (
          <AudiencePicker system={system} value={e.access.visibility} mark={pageMark} onChange={(a) => a && setVisibility.mutate({ id: e.id, audience: a })} />
        ) : (
          // On a sheet with pages the choice itself is under "Sheet settings" on Basic Info.
          seenBy
        )}
      </div>
      )}
    </>
  );
  const readMeta = !editing && <ReadMeta entity={e} system={system} isDm={isDm} kindLabel={kindValue ? (KIND_LABEL[kindValue] ?? kindValue) : null} />;

  const sheetBody = (
    <div className="min-w-0">
      {sheet ? (
        // The compact header above every page of a sheet: main portrait in its frame, name, the quiet line.
        <>
          <header className="flex items-center gap-4" data-sheet-header>
            <FramedPortrait fileId={e.values.portrait} name={e.name} className="size-16 text-base sm:size-20" />
            <div className="min-w-0 flex-1 [&>*:last-child]:mb-0">
              {nameBlock}
              {readMeta}
            </div>
          </header>
          <D20Divider />
        </>
      ) : (
        nameBlock
      )}

      <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-bg/95 px-1 py-2 text-sm">
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
            <span className="muted">
              {matchCount ? `${matchCount} found` : sheet && otherMatches ? 'Nothing on this page' : 'Nothing found'}
              {sheet && otherMatches > 0 && ` · ${otherMatches} on other pages`}
            </span>
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
        {canChange && (
          <button
            className={`btn ml-auto ${editing ? 'btn-primary' : ''}`}
            aria-pressed={editing}
            title={editing ? 'Back to reading' : `Change this ${noun}`}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {sheet && pageHref && (
        <PageMenu variant="top" pages={sheet.pages} current={sheet.current.key} href={pageHref} counts={pageCounts} />
      )}

      {!sheet && readMeta}

      {!sheet && controls}

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">Not saved: {error.message}</p>}

      {sheet ? (
        <>
          {!editing && sheet.current.key === 'home' ? (
            <HomeSummary entity={e} />
          ) : !editing && sheet.current.key === 'preview' ? (
            // What other players receive of this character: the main portrait large, then the rest.
            <section className="mb-3 flex flex-col gap-4 sm:flex-row" data-shows="preview">
              {sheet.current.shows.some((n) => n.id === 'portrait') && (
                <FramedPortrait fileId={e.values.portrait} name={e.name} className="aspect-square w-full text-4xl sm:w-64" />
              )}
              <div className="card min-w-0 flex-1 self-start border-t-2 border-t-accent px-3 pt-3 pb-1">
                {sheet.current.shows.filter((n) => n.id !== 'portrait').map((n) => renderNode(n, 1, true))}
                {!sheet.current.shows.some((n) => n.id !== 'portrait' && nodeShown(n)) && <p className="muted pb-2 italic">Nothing filled in.</p>}
              </div>
            </section>
          ) : sheet.current.shows.length > 0 && (
            // Fields stored on another page and shown here as well: one value, edited in either place.
            <section className="card mb-3 border-t-2 border-t-accent px-3 pt-3 pb-1" data-shows={sheet.current.key}>
              {sheet.current.shows.map((n) => renderNode(n, 1, true))}
              {!sheet.current.shows.some(nodeShown) && <p className="muted pb-2 italic">Nothing filled in.</p>}
            </section>
          )}
          {sheet.current.groups.map((g) => renderNode(g, 0))}
          {sheet.current.part && (
            <LinksPanel
              system={system}
              entityId={e.id}
              systemId={e.systemId}
              typeKey={e.typeKey}
              canEdit={e.canEdit && editing}
              canAddHolders={false}
              part={sheet.current.part}
            />
          )}
          {sheet.current.key === 'basic' && (isDm || (editing && e.canEdit)) && (
            <section className="card mt-6 mb-3 p-3" data-sheet-settings>
              <h2 className="display mb-3 text-base">Sheet settings</h2>
              {editing && isDm && e.access && (
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                  <span className="muted">Who can see the sheet:</span>
                  <AudiencePicker system={system} value={e.access.visibility} mark={pageMark} onChange={(a) => a && setVisibility.mutate({ id: e.id, audience: a })} />
                </div>
              )}
              {controls}
              {editing && isDm && e.typeKey === 'character' && (
                <CustomFields
                  noun={noun}
                  groups={(e.schema.groups as Group[])
                    .filter((g) => g.custom)
                    .map((g) => ({ id: g.id, label: g.label, children: (g.children as Field[]).map((c) => ({ id: c.id, label: c.label, type: c.type as CustomGroup['children'][number]['type'], max: c.max })) }))}
                  onChange={(groups) => setCustomSchema.mutate({ id: e.id, groups })}
                />
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {isDm && (
                  <button className="btn" onClick={() => setShowHistory(!showHistory)}>
                    {showHistory ? 'Hide history' : 'History'}
                  </button>
                )}
                {editing && e.canEdit && (
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
            </section>
          )}
        </>
      ) : (
        <>
      {(e.schema.groups as Node[]).map((g) => renderNode(g, 0))}

      {['character', 'feature', 'spell', 'item'].includes(e.typeKey) && (
        <LinksPanel system={system} entityId={e.id} systemId={e.systemId} typeKey={e.typeKey} canEdit={e.canEdit && editing} canAddHolders={isDm && editing} />
      )}

      {editing && isDm && e.typeKey === 'character' && (
        <CustomFields
          noun={noun}
          groups={(e.schema.groups as Group[])
            .filter((g) => g.custom)
            .map((g) => ({ id: g.id, label: g.label, children: (g.children as Field[]).map((c) => ({ id: c.id, label: c.label, type: c.type as CustomGroup['children'][number]['type'], max: c.max })) }))}
          onChange={(groups) => setCustomSchema.mutate({ id: e.id, groups })}
        />
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {isDm && (
          <button className="btn" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide history' : 'History'}
          </button>
        )}
        {editing && e.canEdit && (
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
        </>
      )}
    </div>
  );

  // A sheet with pages: the open page on the left, the menu of pages on the right.
  if (sheet && pageHref)
    return (
      <div className="p-4 md:grid md:grid-cols-[minmax(0,1fr)_13rem] md:gap-6" ref={root} data-editor={editing ? 'edit' : 'read'} data-sheet-page={sheet.current.key}>
        {sheetBody}
        <PageMenu variant="side" pages={sheet.pages} current={sheet.current.key} href={pageHref} counts={pageCounts} />
      </div>
    );
  return (
    <div className="p-4" ref={root} data-editor={editing ? 'edit' : 'read'}>
      <button className={`btn mb-3 ${back ? '' : 'md:hidden'}`} onClick={onClose}>
        {back ?? '← Back'}
      </button>
      {sheetBody}
    </div>
  );
}

/** Field types that stay usable in Read mode, so a sheet can be played without switching to Edit. */
const COUNTERS = new Set(['boolean', 'pips', 'pool', 'talents']);

/** Read mode: kind, campaigns and owner on one quiet line instead of the controls. */
function ReadMeta({ entity: e, system, isDm, kindLabel }: { entity: Entity; system: System; isDm: boolean; kindLabel: string | null }) {
  const campaigns = system.campaigns.filter((c) => e.campaignIds.includes(c.id)).map((c) => c.name);
  const owner = system.members.find((m) => m.userId === e.ownerId)?.displayName;
  const parts = [kindLabel, campaigns.length ? campaigns.join(', ') : null, isDm && e.typeKey === 'character' ? `Owner: ${owner ?? 'nobody (DM)'}` : null].filter(Boolean);
  if (!parts.length) return null;
  return <p className="muted mb-4">{parts.join(' · ')}</p>;
}

/** The six ability score rows of the character sheet are set in the heading font. */
const ABILITY_ROWS = /^(str|dex|con|int|wis|cha)_row$/;

function GroupBox(props: {
  id: string;
  label: React.ReactNode;
  picker: React.ReactNode;
  /** Players cannot see this group: the DM-only tint and dashed outline. */
  secret?: boolean;
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
    <section className={`card mb-3 ${props.depth ? '' : 'border-t-2 border-t-accent'} ${props.secret ? 'secret' : ''}`} data-secret={props.secret ? '' : undefined}>
      <header className="match-target flex items-center justify-between gap-2 rounded-md px-3 py-2" {...(props.matched ? { 'data-match': '' } : {})}>
        <button type="button" className={`flex flex-1 cursor-pointer items-center gap-2 text-left ${props.depth ? 'font-semibold' : 'display text-base'}`} onClick={toggle}>
          <span className="w-3 text-xs text-muted">{shown ? '▼' : '▶'}</span>
          {props.label}
        </button>
        {props.picker}
      </header>
      {shown && <div className="border-t border-line px-3 pt-3 pb-1">{props.children}</div>}
    </section>
  );
}

function NameInput(props: { name: string; disabled: boolean; onSave: (name: string) => void }) {
  const [value, setValue] = useState(props.name);
  return (
    <input
      className="input display min-w-48 flex-1 text-xl"
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

type FieldInputProps = { field: Field; value: unknown; disabled: boolean; reading?: boolean; onSave: (value: unknown) => void; suggestions?: string[] };

/** Text and numbers are saved when the field loses focus; boxes, choices and counters are saved at once. */
function FieldInput({ field, value, disabled, reading, onSave, suggestions }: FieldInputProps) {
  const { type } = field;
  const asText = Array.isArray(value) ? value.join('\n') : value === null || value === undefined || typeof value === 'object' ? '' : String(value);
  const [draft, setDraft] = useState(asText);
  useEffect(() => setDraft(asText), [asText]);

  if (type === 'computed') {
    const shown = value === null || value === undefined ? '–' : field.signed && typeof value === 'number' && value >= 0 ? `+${value}` : String(value);
    return (
      <output className="block min-w-12 rounded-md bg-surface-2 px-3 py-2 text-center text-sm font-semibold" title="Worked out automatically">
        {shown}
      </output>
    );
  }

  if (type === 'boolean')
    return <input type="checkbox" className="mb-2.5 h-4 w-4" checked={value === true} disabled={disabled} onChange={(e) => onSave(e.target.checked)} />;

  if (reading) {
    if (type === 'pool') {
      const pool = value && typeof value === 'object' ? (value as { cur: number; max: number }) : { cur: 0, max: 0 };
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Pips ticked={pool.cur} max={pool.max} disabled={disabled} onChange={(cur) => onSave({ cur, max: pool.max })} />
          <span className="text-sm text-muted">
            {pool.cur} of {pool.max}
          </span>
        </div>
      );
    }
    if (type === 'select') return <span className="block py-1 text-sm">{field.options?.find((o) => o.value === value)?.label ?? (asText || '–')}</span>;
    if (type === 'richtext') return asText ? <RichTextView html={asText} /> : <p className="text-sm text-muted">–</p>;
    if (type === 'table') return <TableView value={value as TableValue | null} />;
    if (type === 'list' && Array.isArray(value))
      return (
        <ul className="list-disc pl-5 text-sm">
          {value.map((line, i) => (
            <li key={i}>{String(line)}</li>
          ))}
        </ul>
      );
    if (type === 'longtext' || type === 'list') return <p className="text-sm whitespace-pre-wrap">{asText || '–'}</p>;
    if (type !== 'pips') return <span className="block py-1 text-sm">{asText || '–'}</span>;
  }

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

  if (type === 'richtext')
    return <RichTextEditor value={typeof value === 'string' ? value : ''} disabled={disabled} label={field.label} onSave={onSave} />;

  if (type === 'table') return <TableInput value={value as TableValue | null} columns={field.columns} disabled={disabled} onSave={onSave} />;

  if (type === 'pips') {
    const ticked = typeof value === 'number' ? value : 0;
    return <Pips ticked={ticked} max={field.max ?? 0} disabled={disabled} onChange={(n) => onSave(n === 0 ? null : n)} />;
  }

  if (type === 'pool') {
    const pool = value && typeof value === 'object' ? (value as { cur: number; max: number }) : { cur: 0, max: 0 };
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Pips ticked={pool.cur} max={pool.max} disabled={disabled} onChange={(cur) => onSave({ cur, max: pool.max })} />
        <span className="text-sm text-muted">
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
  const listId = suggestions?.length ? `suggest-${field.id}` : undefined;
  return (
    <>
      <input
        className={`input ${type === 'number' ? 'w-20' : ''}`}
        inputMode={type === 'number' ? 'decimal' : undefined}
        list={listId}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

type LongTextProps = {
  field: Field;
  value: unknown;
  translation: { text: string; outdated: boolean } | null;
  lang: 'en' | 'ru';
  canTranslate: boolean;
  reading: boolean;
  disabled: boolean;
  onSave: (value: unknown) => void;
  onTranslate: (text: string | null) => void;
};

/**
 * A long text with its Russian translation. A Russian reader sees the Russian, with a switch to the original;
 * without a translation they see the English marked "not translated". The DM writes the translation here.
 */
function LongText({ field, value, translation, lang, canTranslate, reading, disabled, onSave, onTranslate }: LongTextProps) {
  const [original, setOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  const hasSource = typeof value === 'string' && value !== '';
  const showRussian = lang === 'ru' && translation !== null && !original;
  const link = 'cursor-pointer text-accent underline';
  return (
    <div>
      {showRussian ? (
        field.type === 'richtext' ? (
          <RichTextView html={translation.text} />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{translation.text}</p>
        )
      ) : (
        <FieldInput field={field} value={value} disabled={disabled} reading={reading} onSave={onSave} />
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
        {lang === 'ru' && translation && (
          <button type="button" className={link} onClick={() => setOriginal(!original)}>
            {original ? 'Show Russian' : 'Show original'}
          </button>
        )}
        {lang === 'ru' && !translation && hasSource && <span>not translated</span>}
        {translation?.outdated && <span className="text-amber-700 dark:text-amber-400"><span aria-hidden="true">⚠ </span>translation outdated: the English has changed</span>}
        {canTranslate && hasSource && (
          <button type="button" className={link} onClick={() => setTranslating(!translating)}>
            {translating ? 'Hide Russian translation' : translation ? 'Edit Russian translation' : 'Add Russian translation'}
          </button>
        )}
      </div>
      {translating && (
        <div className="mt-2">
          <span className="label">Russian translation of {field.label}</span>
          <FieldInput
            field={{ ...field, label: `Russian translation of ${field.label}` }}
            value={translation?.text ?? null}
            disabled={false}
            onSave={(v) => onTranslate(typeof v === 'string' ? v : null)}
          />
        </div>
      )}
    </div>
  );
}

type ImageInputProps = { entityId: string; fieldId: string; value: unknown; disabled: boolean; onChanged: () => void; onSave: (value: unknown) => void };

/** A picture. Choosing a file uploads it at once; only people who may see this field can load it. */
function ImageInput({ entityId, fieldId, value, disabled, onChanged, onSave }: ImageInputProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const upload = async (file: File) => {
    setMessage('Uploading…');
    const response = await fetch(`/api/upload?entityId=${encodeURIComponent(entityId)}&fieldId=${encodeURIComponent(fieldId)}`, {
      method: 'POST',
      headers: { 'content-type': file.type },
      body: file,
    });
    setMessage(response.ok ? null : response.status === 413 ? 'The picture is larger than 8 MB.' : 'Not uploaded. Use a PNG, JPEG, WebP or GIF picture.');
    if (response.ok) onChanged();
  };
  return (
    <div>
      {typeof value === 'string' && value ? (
        <img src={`/api/file/${value}`} alt="" className="mb-2 max-h-72 max-w-full rounded-md border border-line" />
      ) : (
        disabled && <span className="text-sm text-muted">no picture</span>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              if (file) void upload(file);
              ev.target.value = '';
            }}
          />
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            {value ? 'Replace picture…' : 'Upload picture…'}
          </button>
          {typeof value === 'string' && value && (
            <button type="button" className="btn btn-danger" onClick={() => confirm('Remove the picture?') && onSave(null)}>
              Remove
            </button>
          )}
          {message && <span className="muted">{message}</span>}
        </div>
      )}
    </div>
  );
}

type TableValue = { columns: string[]; rows: string[][] };

/** A free table. A cell is saved when it loses focus; rows and columns are added and removed with the buttons. */
function TableInput({ value, columns: start, disabled, onSave }: { value: TableValue | null; columns?: string[]; disabled: boolean; onSave: (value: unknown) => void }) {
  if (!value && disabled) return <span className="text-sm text-muted">no table</span>;
  if (!value)
    return (
      <button type="button" className="btn" onClick={() => onSave({ columns: start ?? ['', ''], rows: [(start ?? ['', '']).map(() => '')] })}>
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
                <th key={`${c}:${heading}`} className="border border-line p-0">
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
                  <td key={`${c}:${cell}`} className="border border-line p-0">
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

/** A table in Read mode: plain cells, no inputs. */
function TableView({ value }: { value: TableValue | null }) {
  if (!value) return <span className="text-sm text-muted">no table</span>;
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            {value.columns.map((heading, c) => (
              <th key={c} className="border border-line bg-surface-2 px-2 py-1 text-left font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-line px-2 py-1 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A row of boxes. Clicking box N ticks N boxes; clicking the last ticked box unticks it. */
function Pips(props: { ticked: number; max: number; disabled: boolean; onChange: (ticked: number) => void }) {
  if (!props.max) return <span className="text-sm text-muted">none</span>;
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
            i < props.ticked ? 'border-accent bg-accent' : 'border-line bg-transparent'
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
    nameRu: 'changed the Russian name',
    customSchema: 'changed the custom sections',
    translation: 'changed a Russian translation',
    visibility: `changed who can see the ${noun}`,
    fieldVisibility: 'changed who can see a part',
    link: 'changed a link',
  };
  return (
    <div className="card mt-3 divide-y divide-line text-sm">
      {history.data.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <span className="font-medium">{c.userName ?? 'Someone'}</span>{' '}
            {c.target === 'field' ? (
              <>
                changed <span className="font-medium">{c.label}</span>: <span className="text-muted">{show(c.oldValue)}</span> →{' '}
                {show(c.newValue)}
              </>
            ) : c.target === 'name' ? (
              <>
                renamed: <span className="text-muted">{show(c.oldValue)}</span> → {show(c.newValue)}
              </>
            ) : (
              what[c.target]
            )}
            <div className="text-xs text-muted">{new Date(c.at).toLocaleString()}</div>
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
