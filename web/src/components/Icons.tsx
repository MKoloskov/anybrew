// Thin-line icons (PLAN.md section 11.5). Section icons come from the Lucide icon set (ISC licence);
// the d20 is our own drawing.
import { Award, Backpack, BookOpen, Contact, Database, NotebookPen, ScrollText, Users, Wand, type LucideIcon } from 'lucide-react';

/** The d20: logo mark, empty lists, and later the sheet dividers. */
export function D20({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-4'}
      aria-hidden
    >
      <path d="M12 2 21 7v10l-9 5-9-5V7z" />
      <path d="M12 2 7.5 9.5h9zM7.5 9.5 12 17l4.5-7.5M3 17h18M7.5 9.5 3 17M16.5 9.5 21 17M12 17v5M3 7l4.5 2.5M21 7l-4.5 2.5" />
    </svg>
  );
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  characters: Users,
  features: Award,
  spells: Wand,
  items: Backpack,
  rules: ScrollText,
  glossary: BookOpen,
  notes: NotebookPen,
  people: Contact,
  data: Database,
};

/** The icon of a section tab; nothing for an unknown section. */
export function SectionIcon({ section, className }: { section: string; className?: string }) {
  const Icon = SECTION_ICONS[section];
  return Icon ? <Icon className={className ?? 'size-4'} strokeWidth={1.75} aria-hidden /> : null;
}

/** An empty list: a faint d20 above the message. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center" data-empty>
      <D20 className="size-8 text-accent/60" />
      <p className="muted">{children}</p>
    </div>
  );
}
