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

/**
 * Any of the keywords, each of whose words must start a word: "react" matches React, ReactJS, React.js,
 * but not Preact. A keyword of several words ("React CSS") needs every one of them, each anywhere in
 * the texts (the title, a skill).
 */
export function keywordTest(keywords: string[]) {
  const wanted = keywords
    .map((keyword) =>
      fold(keyword)
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => new RegExp(`(?:^|[^${WORD}])${escape(word)}`)),
    )
    .filter((words) => words.length);
  if (!wanted.length) return () => true;
  return (texts: string[]) => {
    const folded = texts.map(fold);
    return wanted.some((words) => words.every((word) => folded.some((text) => word.test(text))));
  };
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

// where a job remote from there may be done from Poland (the words folded: lowercase, no accents)
const OPEN = /\b(poland|polska|europe|european union|eu|emea|cet|worldwide|anywhere|global)\b/;
const REMOTE_WORDS = /\b(fully |100% )?remote\b|\bzdaln\p{L}*|\bwork from home\b/gu;

/**
 * A job remote only from another country ("Remote, France", "Remote - US") is not remote for you: it
 * counts as remote when a place it names is Poland or Europe-wide, or it names none besides "Remote", or
 * its title says so ("… - EMEA Remote", with an office in Paris as its place). The others go through the
 * city filter with their places instead.
 */
export function remoteHere(remote: boolean, places: string[], title = ''): boolean {
  if (!remote) return false;
  if (OPEN.test(fold(title))) return true;
  const named = places
    .map((place) =>
      fold(place)
        .replace(REMOTE_WORDS, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim(),
    )
    .filter(Boolean);
  return !named.length || named.some((place) => OPEN.test(place));
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
/** {start} goes up by this much a page, so a page with fewer offers is its search's last */
export const PAGE_SIZE = 10;

const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;

/**
 * {since}: the seconds back to an hour before the scraper's last complete run (every page and every ad it
 * needed came through), so a search limited to them (LinkedIn's f_TPR=r{since}) covers the night, a failed
 * run and what the board indexed late. Without such a run an hour; at most a week.
 */
export function sinceSeconds(lastCompleteAt: string | null | undefined, now = Date.now()): number {
  const ago = lastCompleteAt ? (now - Date.parse(lastCompleteAt)) / 1000 : NaN;
  return Number.isFinite(ago) ? Math.min(WEEK, Math.max(HOUR, Math.ceil(ago) + HOUR)) : HOUR;
}

/**
 * A URL with {keyword} / {keyword_slug} becomes one URL per keyword; {keywords} is all of them in one,
 * space-separated (for an API that takes a list); with {start} (0, 10, 20…) or {page} (1, 2, 3…) also
 * one per page, `pages` of them. {since} becomes `since` (sinceSeconds). Without placeholders, just itself.
 */
export function expandUrl(
  url: string,
  keywords: string[],
  pages = 1,
  since = HOUR,
): { url: string; keyword: string | null; page: number }[] {
  url = url.replaceAll('{since}', String(since));
  const hasKeyword = /\{keyword(?:_slug)?\}/.test(url);
  const hasKeywords = url.includes('{keywords}');
  if ((hasKeyword || hasKeywords) && !keywords.length)
    throw new Error(
      `The link has ${hasKeyword ? '{keyword}' : '{keywords}'} but there are no keywords in the filters.`,
    );
  if (hasKeywords) url = url.replaceAll('{keywords}', encodeURIComponent(keywords.join(' ')));
  const paged = /\{(?:start|page)\}/.test(url);
  const pageCount = paged ? Math.max(1, Math.min(MAX_PAGES, Math.floor(pages) || 1)) : 1;
  const out: { url: string; keyword: string | null; page: number }[] = [];
  for (const keyword of hasKeyword ? keywords : [null]) {
    for (let i = 0; i < pageCount; i++) {
      let pageUrl = url.replaceAll('{start}', String(i * PAGE_SIZE)).replaceAll('{page}', String(i + 1));
      if (keyword !== null)
        pageUrl = pageUrl
          .replaceAll('{keyword_slug}', slug(keyword))
          .replaceAll('{keyword}', encodeURIComponent(keyword));
      out.push({ url: pageUrl, keyword, page: i + 1 });
    }
  }
  return out;
}
