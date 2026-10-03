import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import { TRIGGERS, type Trigger } from '@/lib/listings/triggers';

// The run log's filter: by what started a run, or only the runs where something failed.

export type RunFilter = 'all' | Trigger | 'failed';

export const RUN_FILTERS: readonly { id: RunFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...(Object.keys(TRIGGERS) as Trigger[]).map((id) => ({ id, label: TRIGGERS[id] })),
  { id: 'failed', label: 'With errors' },
];

export const isRunFilter = (value: unknown): value is RunFilter => RUN_FILTERS.some((filter) => filter.id === value);

type Filterable = Pick<ScrapeRun, 'trigger' | 'errors'>;

export function filterRuns<R extends Filterable>(runs: readonly R[], filter: RunFilter): R[] {
  if (filter === 'all') return [...runs];
  if (filter === 'failed') return runs.filter((run) => run.errors.length > 0);
  return runs.filter((run) => run.trigger === filter);
}

/** How many runs each filter shows. */
export function filterCounts(runs: readonly Filterable[]): Record<RunFilter, number> {
  return Object.fromEntries(RUN_FILTERS.map(({ id }) => [id, filterRuns(runs, id).length])) as Record<
    RunFilter,
    number
  >;
}
