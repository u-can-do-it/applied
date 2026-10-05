import 'server-only';
import { env } from '../env';
import type { KindId } from './kinds';

// What a board's API wants in every request's link: its keys, from the environment, and what makes it answer
// JSON. Added to the request only, so the keys are never in scrapers.config, in Settings or in a run's results.

type KeyName = 'ADZUNA_APP_ID' | 'ADZUNA_APP_KEY';
type Params = { fixed?: Record<string, string>; keys?: Record<string, KeyName> };

const PARAMS: Partial<Record<KindId, Params>> = {
  // without content-type it answers a browser's Accept (the scraper sends one) with its HTML docs page
  adzuna: {
    fixed: { 'content-type': 'application/json' },
    keys: { app_id: 'ADZUNA_APP_ID', app_key: 'ADZUNA_APP_KEY' },
  },
};

function value(name: KeyName): string {
  const set = env[name];
  if (!set) throw new Error(`${name} is not set (the API needs it: docs/OPERATIONS.md)`);
  return set;
}

/** The link as it is requested: with what the kind's API needs that the link doesn't have; the rest as written. */
export function withApiParams(kind: KindId, link: string): string {
  const params = PARAMS[kind];
  if (!params) return link;
  const url = new URL(link);
  const added = new URLSearchParams();
  for (const [param, fixed] of Object.entries(params.fixed ?? {}))
    if (!url.searchParams.has(param)) added.set(param, fixed);
  for (const [param, name] of Object.entries(params.keys ?? {}))
    if (!url.searchParams.has(param)) added.set(param, value(name));
  if (!added.size) return link;
  // appended, so the link's own query keeps its encoding
  const hashAt = link.includes('#') ? link.indexOf('#') : link.length;
  const base = link.slice(0, hashAt);
  const joiner = url.search ? '&' : base.endsWith('?') ? '' : '?';
  return `${base}${joiner}${added.toString()}${link.slice(hashAt)}`;
}
