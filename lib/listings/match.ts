import type { ScrapeSettings } from './settings';
import type { Found } from './types';

// The offer filters (keywords, titles to skip or keep quiet, cities), driven by the settings.

// letters of their own, with no accent to take off (no decomposed form): ł, ø, ß, …
const LETTERS: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ħ: 'h', ß: 'ss', æ: 'ae', œ: 'oe' };

/** lowercase, without accents: "Kraków" -> "krakow", "Łódź" -> "lodz" */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđħßæœ]/g, (letter) => LETTERS[letter]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// what counts as a letter of a word: "c#", "c++" and ".net" are words of their own
const WORD = 'a-z0-9+#';

/** A keyword must start a word: "react" matches React, ReactJS, React.js, but not Preact. */
export function keywordTest(keywords: string[]) {
  const parts = keywords
    .map((keyword) => fold(keyword.trim()))
    .filter(Boolean)
    .map(escape);
  if (!parts.length) return () => true;
  const re = new RegExp(`(?:^|[^${WORD}])(?:${parts.join('|')})`);
  return (texts: string[]) => texts.some((text) => re.test(fold(text)));
}

/**
 * A whole word in a title, for the titles to skip or keep quiet: "java" matches "Java Developer" but not
 * "JavaScript", "go" matches "Go / Golang" but not "Google", ".net" also matches "ASP.NET".
 */
export function titleTest(terms: string[]) {
  const parts = terms
    .map((term) => fold(term.trim()))
    .filter(Boolean)
    .map((term) => (term.startsWith('.') ? `\\.?${escape(term.slice(1))}` : escape(term)));
  if (!parts.length) return () => false;
  const re = new RegExp(`(?:^|[^${WORD}])(?:${parts.join('|')})(?![${WORD}.])`);
  return (title: string) => re.test(fold(title));
}

/** Remote (if allowed), or in one of the cities. An offer that doesn't say where passes. */
export function areaTest(settings: Pick<ScrapeSettings, 'cities' | 'remoteOk'>) {
  const cities = settings.cities.map((city) => fold(city.trim())).filter(Boolean);
  const inCity = (offer: Found) =>
    offer.locations.some((location) => cities.some((city) => fold(location).includes(city)));
  return (offer: Found) => {
    if (!cities.length) return settings.remoteOk || !offer.remote;
    if (offer.remote) return settings.remoteOk || inCity(offer);
    return !offer.locations.length || inCity(offer);
  };
}

/** The place to show in a message: the matching city, else the first one. */
export function placeOf(offer: Found, cities: string[]) {
  const folded = cities.map((city) => fold(city)).filter(Boolean);
  return (
    offer.locations.find((location) => folded.some((city) => fold(location).includes(city))) ??
    offer.locations.at(0) ??
    null
  );
}

const slug = (keyword: string) =>
  fold(keyword)
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
  const pageCount = paged ? Math.max(1, Math.min(MAX_PAGES, Math.floor(pages) || 1)) : 1;
  const out: { url: string; keyword: string | null; page: number }[] = [];
  for (const keyword of hasKeyword ? keywords : [null]) {
    for (let i = 0; i < pageCount; i++) {
      let pageUrl = url.replaceAll('{start}', String(i * 10)).replaceAll('{page}', String(i + 1));
      if (keyword !== null)
        pageUrl = pageUrl
          .replaceAll('{keyword_slug}', slug(keyword))
          .replaceAll('{keyword}', encodeURIComponent(keyword));
      out.push({ url: pageUrl, keyword, page: i + 1 });
    }
  }
  return out;
}
