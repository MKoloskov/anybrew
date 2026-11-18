import { Link, useLocation } from 'wouter';
import type { SheetPart } from '../features';

/** One page of a sheet as the screen uses it: its own groups, the nodes it shows from other pages, and what it lists. */
export type SheetPage<N extends { id: string } = { id: string }> = {
  key: string;
  label: string;
  groups: N[];
  shows: N[];
  /** The part of the character's features, spells or items listed on this page. */
  part?: SheetPart;
};

type Props = {
  pages: SheetPage[];
  current: string;
  href: (page: string) => string;
  /** Search matches per page, while a search is on. */
  counts: Record<string, number>;
  /** 'side': the menu on the right of a wide screen; 'top': the drop-down above the page on a phone. */
  variant: 'side' | 'top';
};

/** The pages of the sheet: a menu on the right on a wide screen, a drop-down at the top on a phone. */
export function PageMenu({ pages, current, href, counts, variant }: Props) {
  const [, navigate] = useLocation();
  const count = (key: string) => counts[key] ?? 0;
  if (variant === 'top')
    return (
      <label className="mb-3 block md:hidden">
        <span className="sr-only">Page of the sheet</span>
        <select className="input" aria-label="Page of the sheet" value={current} onChange={(ev) => navigate(href(ev.target.value))}>
          {pages.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
              {count(p.key) ? ` (${count(p.key)} found)` : ''}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <nav aria-label="Pages of the sheet" className="hidden md:block">
      <ul className="sticky top-4 space-y-0.5 border-l border-line">
          {pages.map((p) => (
            <li key={p.key}>
              <Link
                href={href(p.key)}
                aria-current={p.key === current ? 'page' : undefined}
                data-page={p.key}
                className={`-ml-px flex items-center justify-between gap-2 border-l-2 px-3 py-1.5 text-sm ${
                  p.key === current ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'
                }`}
              >
                <span>{p.label}</span>
                {count(p.key) > 0 && (
                  <span className="rounded-sm bg-yellow-300/60 px-1.5 text-xs text-fg" title={`${count(p.key)} found on this page`}>
                    {count(p.key)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
    </nav>
  );
}
