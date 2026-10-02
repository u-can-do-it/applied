import type { ScrapeSettings } from './kinds';

// The filters Node-RED had in its parse_* and store_notifications nodes, driven by the settings.

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

/** lowercase, without accents: "Kraków" -> "krakow" */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// what counts as a letter of a word: "c#", "c++" and ".net" are words of their own
const WORD = 'a-z0-9+#';

/** A keyword must start a word: "react" matches React, ReactJS, React.js, but not Preact. */
export function keywordTest(keywords: string[]) {
  const parts = keywords.map((k) => fold(k.trim())).filter(Boolean).map(escape);
  if (!parts.length) return () => true;
  const re = new RegExp(`(?:^|[^${WORD}])(?:${parts.join('|')})`);
  return (texts: string[]) => texts.some((t) => re.test(fold(t)));
}

/**
 * A whole word in a title, Node-RED's exclusion rule: "java" matches "Java Developer" but not
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
  return o.locations.find((l) => folded.some((c) => fold(l).includes(c))) ?? o.locations[0] ?? null;
}

const slug = (k: string) => fold(k).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A URL with {keyword} / {keyword_slug} becomes one URL per keyword; without them, just itself. */
export function expandUrl(url: string, keywords: string[]): { url: string; keyword: string | null }[] {
  if (!/\{keyword(?:_slug)?\}/.test(url)) return [{ url, keyword: null }];
  if (!keywords.length) throw new Error('The link has {keyword} but there are no keywords in the filters.');
  return keywords.map((k) => ({
    keyword: k,
    url: url.replaceAll('{keyword_slug}', slug(k)).replaceAll('{keyword}', encodeURIComponent(k)),
  }));
}
