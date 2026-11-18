import { createContext, useContext, useMemo } from 'react';
import { trpc } from './trpc';

export type Lang = 'en' | 'ru';
type Term = { id: string; term: string; ru: string | null; definition: string; aliases: string[] };

const LangContext = createContext<{ lang: Lang; terms: Map<string, Term> }>({ lang: 'en', terms: new Map() });

/** Makes the reader's language and the system's glossary available to everything inside. */
export function LangProvider({ lang, systemId, children }: { lang: Lang; systemId: string; children: React.ReactNode }) {
  const glossary = trpc.entity.glossary.useQuery({ systemId }, { staleTime: 60_000 });
  const terms = useMemo(() => {
    const map = new Map<string, Term>();
    for (const t of glossary.data ?? []) for (const key of [t.term, ...t.aliases]) map.set(key.trim().toLowerCase(), t);
    return map;
  }, [glossary.data]);
  return <LangContext.Provider value={{ lang, terms }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext).lang;

/** "Elara Fairhold (Элара Фейрхольд)" for a Russian reader, the English name alone otherwise. */
export function useBilingual() {
  const lang = useLang();
  return (name: string, ru?: string | null) => (lang === 'ru' && ru ? `${name} (${ru})` : name);
}

/**
 * A label of the sheet. English always; a Russian reader gets the Russian form after it.
 * When the label is a glossary term, it is underlined with dots and shows the definition on hover or tap.
 */
export function Label({ text, ru }: { text: string; ru?: string | null }) {
  const { lang, terms } = useContext(LangContext);
  // "Perception (WIS)" is looked up as "Perception".
  const term = terms.get(text.toLowerCase()) ?? terms.get(text.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase());
  const russian = ru ?? term?.ru;
  const shown = lang === 'ru' && russian ? `${text} (${russian})` : text;
  if (!term?.definition) return <>{shown}</>;
  return (
    <span
      className="cursor-help underline decoration-dotted underline-offset-2"
      title={lang === 'ru' && term.ru ? `${term.ru} — ${term.definition}` : term.definition}
      tabIndex={0}
    >
      {shown}
    </span>
  );
}
