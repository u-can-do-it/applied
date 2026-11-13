// The job's level as the lists filter it: what the boards call it (offers.seniority, as each parser left it,
// lib/listings/parsers) grouped into a few levels. Shared by the server (the offers' query) and the client (the
// Applied tab filters its list itself).

/** Each level and the words the boards use for it (lower case). */
export const LEVELS = [
  { level: 'junior', label: 'Junior', words: ['junior', 'intern', 'internship', 'trainee', 'assistant', 'entry'] },
  { level: 'mid', label: 'Mid', words: ['mid', 'regular', 'medium', 'midweight'] },
  { level: 'senior', label: 'Senior', words: ['senior', 'expert'] },
  { level: 'lead', label: 'Lead', words: ['lead', 'manager', 'c_level', 'principal', 'director', 'head', 'executive'] },
] as const;

/** The jobs whose board gives no level, or one none of the above (unknown, other). */
export const NO_LEVEL = { level: 'none', label: 'Not given' } as const;

/** The chips, in order. */
export const LEVEL_OPTIONS = [...LEVELS, NO_LEVEL] as const;
export type Level = (typeof LEVEL_OPTIONS)[number]['level'];

/** Every word a board's level is known by: anything else is NO_LEVEL. */
export const KNOWN_WORDS: string[] = LEVELS.flatMap((option) => option.words);

/** A board's level ("Senior", "c_level", null) as the filter's. */
export function levelOf(seniority: string | null | undefined): Level {
  const word = seniority?.trim().toLowerCase() ?? '';
  return LEVELS.find((option) => (option.words as readonly string[]).includes(word))?.level ?? NO_LEVEL.level;
}

/** The words of the given levels (NO_LEVEL has none: it is every word but KNOWN_WORDS). */
export const wordsOf = (levels: readonly Level[]): string[] =>
  LEVELS.filter((option) => levels.includes(option.level)).flatMap((option) => option.words);

/** ?level=mid,senior as the levels, in the chips' order; anything else left out. All of them: no filter ([]). */
export function parseLevels(value: string | null | undefined): Level[] {
  const asked = new Set((value ?? '').split(',').map((part) => part.trim()));
  const levels = LEVEL_OPTIONS.map((option) => option.level).filter((level) => asked.has(level));
  return levels.length === LEVEL_OPTIONS.length ? [] : levels;
}

/** The URL's ?level= with `level` switched on or off (null: no filter left). */
export function toggleLevel(levels: readonly Level[], level: Level): string | null {
  const next = levels.includes(level) ? levels.filter((one) => one !== level) : [...levels, level];
  return parseLevels(next.join(',')).join(',') || null;
}
