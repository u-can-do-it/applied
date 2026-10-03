import 'server-only';
import type { DateFilter, Zone } from './dates';
import { appZone } from './time-zone';
import type { Check } from './openai';
import { rangeTotal, rest, restUrl, rpcUrl } from './supabase';

/** One board's posting of a job (a job posted on three boards has three). */
export type Copy = { src: string; id: string; url: string };
export type Offer = {
  src: string; // board of the earliest copy
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean | null;
  url: string;
  first_seen: string;
  /** every board this job was posted on, earliest first */
  copies: Copy[];
  /** the job's key (same for all its copies); missing before supabase/ai-filter.sql is run */
  key: string | null;
  /** when you marked it applied */
  applied_at: string | null;
  /** AI tab only */
  ai?: { match: boolean; score: number; summary: string | null; checks: Check[]; had_description: boolean };
};

export const PAGE_SIZE = 50;

const BASE_COLUMNS = 'src,id,title,company,seniority,remote,url,first_seen';
const UNIQUE_COLUMNS = `${BASE_COLUMNS},copies,dup_key,applied_at`;
const AI_COLUMNS = `${UNIQUE_COLUMNS},match,score,summary,checks,had_description`;

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

type Query = { q: string; src: string; page: number } & DateFilter & {
    /** AI tab: results of this profile version */
    ai?: { profileId: string; version: number; rejected: boolean };
  };

// offers_unique comes with supabase/ai-filter.sql; until it's run, fall back to the table
let viewMissing = false;
// (HEAD responses have no body, so a missing view only shows as 404)
const isMissingRelation = (e: unknown) =>
  e instanceof Error && /Supabase 404|PGRST205|42P01|Could not find/.test(e.message);

function applyFilters(url: URL, opts: Query, unique: boolean, z: Zone) {
  if (opts.src) url.searchParams.set(unique ? 'sources' : 'src', unique ? `cs.{${opts.src}}` : `eq.${opts.src}`);
  const filter = searchFilter(opts.q);
  if (filter) url.searchParams.set('and', filter);
  // two filters on the same column are ANDed: first_seen >= gte AND first_seen < lt
  const range = z.resolveRange(opts);
  if (range.gte) url.searchParams.append('first_seen', `gte.${range.gte}`);
  if (range.lt) url.searchParams.append('first_seen', `lt.${range.lt}`);
  url.searchParams.set('order', 'first_seen.desc,src.asc,id.asc');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(opts.page * PAGE_SIZE));
}

type Row = Omit<Offer, 'copies' | 'ai' | 'key' | 'applied_at'> & {
  copies?: Copy[];
  dup_key?: string;
  applied_at?: string | null;
  match?: boolean;
  score?: number;
  summary?: string | null;
  checks?: Check[];
  had_description?: boolean;
};

const toOffer = (r: Row): Offer => ({
  src: r.src,
  id: r.id,
  title: r.title,
  company: r.company,
  seniority: r.seniority,
  remote: r.remote,
  url: r.url,
  first_seen: r.first_seen,
  copies: r.copies?.length ? r.copies : [{ src: r.src, id: r.id, url: r.url }],
  key: r.dup_key ?? null,
  applied_at: r.applied_at ?? null,
  ai:
    r.score === undefined
      ? undefined
      : {
          match: Boolean(r.match),
          score: r.score ?? 0,
          summary: r.summary ?? null,
          checks: r.checks ?? [],
          had_description: Boolean(r.had_description),
        },
});

export async function getOffers(opts: Query): Promise<{ offers: Offer[]; total: number }> {
  const z = await appZone(); // "today", "last 7 days": days there
  let url: URL;
  if (opts.ai) {
    url = rpcUrl('ai_results', { p_profile: opts.ai.profileId, p_version: opts.ai.version });
    url.searchParams.set('select', AI_COLUMNS);
    url.searchParams.set('match', `is.${opts.ai.rejected ? 'false' : 'true'}`);
    applyFilters(url, opts, true, z);
  } else if (!viewMissing) {
    url = restUrl('offers_unique');
    url.searchParams.set('select', UNIQUE_COLUMNS);
    applyFilters(url, opts, true, z);
  } else {
    url = restUrl('offers');
    url.searchParams.set('select', BASE_COLUMNS);
    applyFilters(url, opts, false, z);
  }

  try {
    const res = await rest(url, { prefer: 'count=exact' });
    return { offers: ((await res.json()) as Row[]).map(toOffer), total: rangeTotal(res) };
  } catch (e) {
    if (!opts.ai && !viewMissing && isMissingRelation(e)) {
      viewMissing = true;
      return getOffers(opts);
    }
    throw e;
  }
}

/** Jobs in the database (each once), ignoring every filter. HEAD = count only, no rows. */
export async function getTotalCount(): Promise<number> {
  const url = restUrl(viewMissing ? 'offers' : 'offers_unique');
  url.searchParams.set('select', 'id');
  try {
    return rangeTotal(await rest(url, { method: 'HEAD', prefer: 'count=exact' }));
  } catch (e) {
    if (!viewMissing && isMissingRelation(e)) {
      viewMissing = true;
      return getTotalCount();
    }
    throw e;
  }
}
