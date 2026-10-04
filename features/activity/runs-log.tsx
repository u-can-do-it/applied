'use client';

import { useState } from 'react';
import { ChevronRightIcon, CircleSmallIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react';
import { useZone } from '@/components/time-zone';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import { cn } from '@/lib/shared/cn';
import { seconds } from '@/lib/shared/format';
import { triggerLabel } from '@/lib/listings/triggers';
import { filterCounts, filterRuns, isRunFilter, RUN_FILTERS, type RunFilter } from './run-filter';

export type BoardAdded = { board: string; label: string; added: number };

/** The scrape runs, newest first: filtered by what started them, each opening to what it added where. */
export function RunsLog({
  runs,
  added,
  running,
}: {
  runs: ScrapeRun[];
  /** by run id: the offers it added, per board */
  added: Record<number, BoardAdded[]>;
  running: boolean;
}) {
  const [filter, setFilter] = useState<RunFilter>('all');
  const counts = filterCounts(runs);
  const shown = filterRuns(runs, filter);
  return (
    <>
      {running && (
        <p className="my-1.5 text-xs text-muted-foreground">
          <CircleSmallIcon fill="currentColor" className="text-success" /> A run is going right now.
        </p>
      )}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={filter}
        onValueChange={(value) => isRunFilter(value) && setFilter(value)}
        aria-label="Show runs"
        className="mb-2 flex-wrap"
      >
        {RUN_FILTERS.map((option) => (
          <ToggleGroupItem key={option.id} value={option.id} className="px-2.5 text-xs">
            {option.label} <span className="text-muted-foreground tabular-nums">{counts[option.id]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {shown.length ? (
        <ol className="m-0 list-none border-t p-0 text-[13px]">
          {shown.map((run) => (
            <RunRow key={run.id} run={run} added={added[run.id] ?? []} />
          ))}
        </ol>
      ) : (
        <p className="my-1.5 text-xs text-muted-foreground">
          {runs.length ? 'No run of this kind in the last two weeks.' : 'No runs yet. Use “Scrape now” at the top.'}
        </p>
      )}
    </>
  );
}

function RunRow({ run, added }: { run: ScrapeRun; added: BoardAdded[] }) {
  const zone = useZone();
  // a warning: it went through all the same (a channel failed, another sent)
  const warnings = run.errors.filter((failure) => failure.warning).length;
  const failures = run.errors.length - warnings;
  return (
    <li className="border-b">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full cursor-pointer flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1.5 text-left">
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 self-center text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
          />
          <span className="tabular-nums">{zone.formatDateTime(run.startedAt)}</span>
          <span className="text-muted-foreground">{triggerLabel(run.trigger)}</span>
          {run.finishedAt ? (
            <span>
              {seconds(Date.parse(run.finishedAt) - Date.parse(run.startedAt))} · {run.found} on the pages · {run.kept}{' '}
              kept · <strong>{run.added} new</strong>
              {run.matched !== null && (
                <>
                  {' · '}
                  <SparklesIcon /> {run.matched} matched
                </>
              )}
              {run.notified ? ` · ${run.notified} sent` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">unfinished</span>
          )}
          {failures > 0 && (
            <span className="text-destructive">
              <TriangleAlertIcon /> {failures} error{failures === 1 ? '' : 's'}
            </span>
          )}
          {warnings > 0 && (
            <span className="text-warning">
              <TriangleAlertIcon /> {warnings} warning{warnings === 1 ? '' : 's'}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-2 pl-6 text-xs">
          {added.length ? (
            <ul className="m-0 list-none p-0">
              {added.map((board) => (
                <li key={board.board}>
                  {board.label}: <strong>{board.added} new</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-muted-foreground">
              {run.finishedAt ? 'No new offers.' : 'Still going, or it stopped.'}
            </p>
          )}
          {run.errors.map((failure, i) => (
            <p
              key={i}
              className={cn('m-0 mt-1 [overflow-wrap:anywhere]', failure.warning ? 'text-warning' : 'text-destructive')}
            >
              {failure.scraper}: {failure.error}
            </p>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
