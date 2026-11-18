// How features are named and filed on every screen that lists them.

export const CLASS_FEATURE = 'Class feature';
/** Types offered when typing the Type of a feature, before any feature uses them. */
export const DEFAULT_TYPES = [CLASS_FEATURE, 'Feat', 'Maneuver', 'Origin', 'Attack', 'Proficiency', 'Special ability'];

export const isClassFeature = (ftype: string | null) => ftype?.trim().toLowerCase() === CLASS_FEATURE.toLowerCase();

/** "Feat" → "Feats", "Proficiency" → "Proficiencies", "Special ability" → "Special abilities". */
export function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return /s$/i.test(word) ? word : `${word}s`;
}

/** The heading a feature is listed under on a character sheet: "Monk features", "Feats"… */
export function featureHeading(info: { ftype: string | null; class: string | null }): string {
  if (isClassFeature(info.ftype)) return info.class ? `${info.class} features` : 'Class features';
  return info.ftype ? plural(info.ftype) : 'Other';
}
