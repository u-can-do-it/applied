// Shared by the server and client components.
import { validDay } from '../dates';
import { SRC_RE } from '../scraping/kinds';
import { DAY_PRESETS } from '../sources';

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
  return {
    q: one(params.q).slice(0, 200),
    src: SRC_RE.test(src) ? src : '', // an unknown board just finds nothing
    page: Math.max(0, Math.floor(Number(one(params.page)) || 0)),
    days: preset,
    // a preset wins over a date range
    from: preset ? '' : validDay(one(params.from)),
    to: preset ? '' : validDay(one(params.to)),
    rejected: one(params.rejected) === '1',
  };
}
