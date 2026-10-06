// Shared by the server and client components.
import { BOARD_RE } from '../boards/links';
import { validDay } from '../dates';

// relative presets live in the URL as ?days=N, so a bookmarked "7 days" stays relative
export const DAY_PRESETS = [
  { days: '', label: 'Any time' },
  { days: '1', label: 'Today' },
  { days: 'yesterday', label: 'Yesterday' }, // a single closed day, not "up to now"
  { days: '3', label: '3 days' },
  { days: '7', label: '7 days' },
  { days: '30', label: '30 days' },
] as const;

/** The AI fit filter, as ?fit=: every offer (''), the active profile's matches, or the ones it rejected. */
export const FITS = [
  { fit: '', label: 'Any' },
  { fit: 'match', label: 'Matches' },
  { fit: 'rejected', label: 'Rejected' },
] as const;
export type Fit = (typeof FITS)[number]['fit'];
const isFit = (value: string): value is Fit => FITS.some((option) => option.fit === value);

export type FilterKey = 'q' | 'src' | 'days' | 'from' | 'to' | 'page' | 'fit' | 'new' | 'archived';
type Changes = Partial<Record<FilterKey, string | number | null | undefined>>;

// Builds a link from the current query, changing only the given keys
// (empty value = remove). Any filter change goes back to the first page.
export function withParams(current: URLSearchParams | string, changes: Changes, path = '/') {
  const sp = new URLSearchParams(current);
  if (!('page' in changes)) sp.delete('page');
  for (const [key, value] of Object.entries(changes)) {
    const text = value == null ? '' : String(value);
    if (!text || (key === 'page' && text === '0')) sp.delete(key);
    else sp.set(key, text);
  }
  const query = sp.toString();
  return query ? `${path}?${query}` : path;
}

/** A page's `searchParams` prop. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Params = Awaited<SearchParams>;

/** ?a=1&a=2 counts as its first value; a missing one as '' */
export const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/** The offer list's filters as the URL has them, each checked: what doesn't make sense is left out. */
export function parseOfferQuery(params: Params) {
  const days = one(params.days);
  const preset = DAY_PRESETS.some((option) => option.days && option.days === days) ? days : '';
  const src = one(params.src);
  const fit = one(params.fit);
  return {
    q: one(params.q).slice(0, 200),
    src: BOARD_RE.test(src) ? src : '', // an unknown board just finds nothing
    page: Math.max(0, Math.floor(Number(one(params.page)) || 0)),
    days: preset,
    // a preset wins over a date range
    from: preset ? '' : validDay(one(params.from)),
    to: preset ? '' : validDay(one(params.to)),
    fit: isFit(fit) ? fit : '', // the AI's verdict: matches, or the rejected ones
    // only what the latest scrape run that brought new jobs brought (a push notification links here)
    latest: one(params.new) === '1',
    // the jobs you archived, instead of the others
    archived: one(params.archived) === '1',
  };
}
