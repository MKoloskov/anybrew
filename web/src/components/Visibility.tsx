// The DM-only style (PLAN.md section 11.9): for the DM, what players cannot see gets a faint brass
// tint, a dashed outline and a chip saying who can see it. Players never receive an audience, so
// every function here answers "no mark" for them.
import { Eye, EyeOff } from 'lucide-react';
import type { Audience, System } from '../trpc';

/** secret: hidden from players who would otherwise see it. open: shown to more people than usual. */
export type Mark = { tone: 'secret' | 'open'; text: string };

/** The parties and players an audience names, parties first. */
function audienceNames(a: Audience, system: System, except?: string | null): string[] {
  return [
    ...system.parties.filter((p) => a.parties.includes(p.id)).map((p) => p.name),
    ...system.members.filter((m) => a.players.includes(m.userId) && m.userId !== except).map((m) => m.displayName),
  ];
}

/**
 * The mark of a whole entity: a list row, a card, the name of a page. An entity open to everyone
 * has none. Otherwise the chip names who can see it: the owner, who always can, then the chosen
 * parties and players, or "DM only".
 */
export function entityMark(system: System, entity: { ownerId: string | null; visibility?: Audience | null }): Mark | null {
  const a = entity.visibility;
  if (!a || a.all) return null;
  const owner = entity.ownerId ? (system.members.find((m) => m.userId === entity.ownerId)?.displayName ?? 'former member') : null;
  const names = [...(owner ? [`${owner} (owner)`] : []), ...audienceNames(a, system, entity.ownerId)];
  return { tone: 'secret', text: names.length ? names.join(', ') : 'DM only' };
}

/**
 * The mark of one section or field that has an audience of its own (set on this entity, or in the sheet).
 *
 * On a character almost everything is closed to other players already, so the measure is the
 * character's own player: a part they cannot see is secret; a part shown to others as well gets
 * the quiet "Also seen by" chip. On any other page the measure is everyone who sees the page.
 */
export function nodeMark(
  system: System,
  entity: { ownerId: string | null; closedToOthers: boolean },
  audience: Audience | null | undefined,
): Mark | null {
  if (!audience) return null;
  if (audience.all) return entity.closedToOthers ? { tone: 'open', text: 'Also seen by: everyone' } : null;
  const owner = entity.ownerId;
  const names = audienceNames(audience, system);
  if (entity.closedToOthers && names.length) {
    const ownerSees =
      !!owner && (audience.players.includes(owner) || system.parties.some((p) => audience.parties.includes(p.id) && p.memberIds.includes(owner)));
    // A character nobody owns is the DM's: naming players opens the part to them.
    if (ownerSees || !owner) {
      const others = audienceNames(audience, system, owner);
      return others.length ? { tone: 'open', text: `Also seen by: ${others.join(', ')}` } : null;
    }
  }
  return { tone: 'secret', text: names.length ? names.join(', ') : 'DM only' };
}

type ChipProps = {
  mark: Mark;
  /** Icon only, with the text as the tooltip: for table rows with little room. */
  iconOnly?: boolean;
  className?: string;
};

/** The chip that says who can see something. */
export function VisChip({ mark, iconOnly, className }: ChipProps) {
  const Icon = mark.tone === 'secret' ? EyeOff : Eye;
  const label = mark.tone === 'secret' ? `Seen by: ${mark.text}` : mark.text;
  return (
    <span className={`chip ${mark.tone === 'secret' ? 'chip-secret' : ''} ${iconOnly ? 'px-1' : ''} ${className ?? ''}`} data-vis={mark.tone} title={label} aria-label={label}>
      <Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
      {!iconOnly && <span className="max-w-44 truncate">{mark.text}</span>}
    </span>
  );
}
