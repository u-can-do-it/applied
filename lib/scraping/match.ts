import type { ScrapeSettings } from './kinds';

// The offer filters (keywords, titles to skip or keep quiet, cities), driven by the settings.

/** One offer as a parser reads it from a board. */
export type Found = {
  src: string;
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean;
  url: string;
  /** cities etc., for the city filter and the Telegram message */
  locations: string[];
  /** searched for the keywords, together with the title */
  skills: string[];
  /** publish time or the board's id counter: higher = newer (see scrapers.mark) */
  sort?: number;
};

// letters of their own, with no accent to take off (no decomposed form): ł, ø, ß, …
const LETTERS: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ħ: 'h', ß: 'ss', æ: 'ae', œ: 'oe' };

/** lowercase, without accents: "Kraków" -> "krakow", "Łódź" -> "lodz" */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđħßæœ]/g, (c) => LETTERS[c]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// what counts as a letter of a word: "c#", "c++" and ".net" are words of their own
const WORD = 'a-z0-9+#';

/** A keyword must start a word: "react" matches React, ReactJS, React.js, but not Preact. */
export function keywordTest(keywords: string[]) {
  const parts = keywords
    .map((k) => fold(k.trim()))
    .filter(Boolean)
    .map(escape);
  if (!parts.length) return () => true;
  const re = new RegExp(`(?:^|[^${WORD}])(?:${parts.join('|')})`);
  return (texts: string[]) => texts.some((t) => re.test(fold(t)));
}

/**
 * A whole word in a title, for the titles to skip or keep quiet: "java" matches "Java Developer" but not
 * "JavaScript", "go" matches "Go / Golang" but not "Google", ".net" also matches "ASP.NET".
 */
export function titleTest(terms: string[]) {
  const parts = terms
    .map((t) => fold(t.trim()))
    .filter(Boolean)
    .map((t) => (t.startsWith('.') ? `\\.?${escape(t.slice(1))}` : escape(t)));
  if (!parts.length) return () => false;
  const re = new RegExp(`(?:^|[^${WORD}])(?:${parts.join('|')})(?![${WORD}.])`);
  return (title: string) => re.test(fold(title));
}

/** Remote (if allowed), or in one of the cities. An offer that doesn't say where passes. */
export function areaTest(s: Pick<ScrapeSettings, 'cities' | 'remoteOk'>) {
  const cities = s.cities.map((c) => fold(c.trim())).filter(Boolean);
  const inCity = (o: Found) => o.locations.some((l) => cities.some((c) => fold(l).includes(c)));
  return (o: Found) => {
    if (!cities.length) return s.remoteOk || !o.remote;
    if (o.remote) return s.remoteOk || inCity(o);
    return !o.locations.length || inCity(o);
  };
}

/** The place to show in a message: the matching city, else the first one. */
export function placeOf(o: Found, cities: string[]) {
  const folded = cities.map((c) => fold(c)).filter(Boolean);
  return o.locations.find((l) => folded.some((c) => fold(l).includes(c))) ?? o.locations.at(0) ?? null;
}

const slug = (k: string) =>
  fold(k)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const MAX_PAGES = 5;

/**
 * A URL with {keyword} / {keyword_slug} becomes one URL per keyword; with {start} (0, 10, 20…) or
 * {page} (1, 2, 3…) also one per page, `pages` of them. Without placeholders, just itself.
 */
export function expandUrl(
  url: string,
  keywords: string[],
  pages = 1,
): { url: string; keyword: string | null; page: number }[] {
  const hasKeyword = /\{keyword(?:_slug)?\}/.test(url);
  if (hasKeyword && !keywords.length)
    throw new Error('The link has {keyword} but there are no keywords in the filters.');
  const paged = /\{(?:start|page)\}/.test(url);
  const n = paged ? Math.max(1, Math.min(MAX_PAGES, Math.floor(pages) || 1)) : 1;
  const out: { url: string; keyword: string | null; page: number }[] = [];
  for (const k of hasKeyword ? keywords : [null]) {
    for (let i = 0; i < n; i++) {
      let u = url.replaceAll('{start}', String(i * 10)).replaceAll('{page}', String(i + 1));
      if (k !== null) u = u.replaceAll('{keyword_slug}', slug(k)).replaceAll('{keyword}', encodeURIComponent(k));
      out.push({ url: u, keyword: k, page: i + 1 });
    }
  }
  return out;
}
