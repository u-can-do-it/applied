import type { RunsOf } from '@/lib/db/repos/scrape-runs';
import { one, type SearchParams } from '@/lib/shared/search-params';
import { TRIGGERS, type Trigger } from '@/lib/listings/triggers';

// The run log's filter: by what started a run, or only the runs where something failed; with its page,
// both in the URL (/activity?runs=failed&page=1).

export type RunFilter = 'all' | Trigger | 'failed';

export const RUN_FILTERS: readonly { id: RunFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...(Object.keys(TRIGGERS) as Trigger[]).map((id) => ({ id, label: TRIGGERS[id] })),
  { id: 'failed', label: 'With errors' },
];

/** runs on a page of the log */
export const RUNS_PER_PAGE = 15;

export const isRunFilter = (value: unknown): value is RunFilter => RUN_FILTERS.some((filter) => filter.id === value);

/** The filter and page the URL asks for: an unknown filter is "all", page 0 the first (the newest runs). */
export function parseRunsQuery(params: Awaited<SearchParams>): { filter: RunFilter; page: number } {
  const filter = one(params.runs);
  return {
    filter: isRunFilter(filter) ? filter : 'all',
    page: Math.max(0, Math.floor(Number(one(params.page)) || 0)),
  };
}

/** The log's link for a filter and a page; "all" and the first page are left out. */
export function runsHref(filter: RunFilter, page = 0) {
  const query = new URLSearchParams();
  if (filter !== 'all') query.set('runs', filter);
  if (page > 0) query.set('page', String(page));
  return query.size ? `/activity?${query}` : '/activity';
}

/** What the repo looks for. */
export const runsOf = (filter: RunFilter): RunsOf =>
  filter === 'all' ? {} : filter === 'failed' ? { failed: true } : { trigger: filter };

/** How many runs each filter shows. */
export function filterCounts(counts: {
  all: number;
  failed: number;
  byTrigger: Record<string, number>;
}): Record<RunFilter, number> {
  return Object.fromEntries(
    RUN_FILTERS.map(({ id }) => [
      id,
      id === 'all' ? counts.all : id === 'failed' ? counts.failed : (counts.byTrigger[id] ?? 0),
    ]),
  ) as Record<RunFilter, number>;
}
