import 'server-only';
import { resolveRange, type DateFilter } from './dates';
import { SOURCES } from './sources';

export type Offer = {
  src: string;
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean | null;
  url: string;
  first_seen: string;
};

export const PAGE_SIZE = 50;

const COLUMNS = 'src,id,title,company,seniority,remote,url,first_seen';

// One PostgREST condition per word: every word must appear in the title or the company.
// Values are double-quoted so commas / dots / parens in the search can't break the filter;
// `*` is PostgREST's ilike wildcard, so it's stripped together with the quote characters.
function searchFilter(q: string): string | null {
  const words = q
    .replace(/["\\*%]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.slice(0, 40));
  if (!words.length) return null;
  const parts = words.map((w) => `or(title.ilike."*${w}*",company.ilike."*${w}*")`);
  return `(${parts.join(',')})`;
}

function headers(): HeadersInit {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set');
  // legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export async function getOffers(opts: { q: string; src: string; page: number } & DateFilter) {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error('SUPABASE_URL is not set');

  const url = new URL('/rest/v1/offers', base);
  url.searchParams.set('select', COLUMNS);
  url.searchParams.set('order', 'first_seen.desc,src.asc,id.asc');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(opts.page * PAGE_SIZE));
  if (opts.src in SOURCES) url.searchParams.set('src', `eq.${opts.src}`);
  const filter = searchFilter(opts.q);
  if (filter) url.searchParams.set('and', filter);
  // two filters on the same column are ANDed: first_seen >= gte AND first_seen < lt
  const range = resolveRange(opts);
  if (range.gte) url.searchParams.append('first_seen', `gte.${range.gte}`);
  if (range.lt) url.searchParams.append('first_seen', `lt.${range.lt}`);

  const res = await fetch(url, {
    headers: { ...headers(), Prefer: 'count=exact' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const offers = (await res.json()) as Offer[];
  return { offers, total: rangeTotal(res) };
}

// Content-Range: 0-49/1234  (or */0 when empty)
const rangeTotal = (res: Response) => Number(res.headers.get('content-range')?.split('/')[1]) || 0;

/** Number of offers in the table, ignoring every filter. HEAD = count only, no rows. */
export async function getTotalCount(): Promise<number> {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error('SUPABASE_URL is not set');
  const url = new URL('/rest/v1/offers', base);
  url.searchParams.set('select', 'id');
  const res = await fetch(url, { method: 'HEAD', headers: { ...headers(), Prefer: 'count=exact' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Supabase ${res.status} (count)`);
  return rangeTotal(res);
}
