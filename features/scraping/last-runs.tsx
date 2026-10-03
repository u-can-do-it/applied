'use client';

import { CircleSmallIcon, SparklesIcon } from 'lucide-react';
import { useZone } from '@/components/time-zone';
import { cn } from '@/lib/shared/cn';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import { seconds } from '@/lib/shared/format';
import { SMALL } from './panel-styles';

/** The last scrape runs, what each found, and when a scheduler last called. */
export function LastRuns({
  runs,
  running,
  lastCallAt,
}: {
  runs: ScrapeRun[];
  running: boolean;
  lastCallAt: string | null;
}) {
  const zone = useZone();
  return (
    <>
      {running && (
        <p className={cn(SMALL, 'text-muted-foreground')}>
          <CircleSmallIcon fill="currentColor" /> A run is going right now.
        </p>
      )}
      {runs.length ? (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap gap-x-2.5 gap-y-1">
              <span className="tabular-nums">{zone.formatDateTime(run.startedAt)}</span>
              <span className="text-muted-foreground">{run.trigger}</span>
              {run.finishedAt ? (
                <span>
                  {seconds(Date.parse(run.finishedAt) - Date.parse(run.startedAt))} · {run.found} on the pages ·{' '}
                  {run.kept} kept · <strong>{run.added} new</strong>
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
              {run.errors.map((failure, i) => (
                <span key={i} className="basis-full text-xs text-destructive [overflow-wrap:anywhere]">
                  {failure.scraper}: {failure.error}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : (
        <p className={cn(SMALL, 'text-muted-foreground')}>No runs yet. Use “Scrape now” at the top.</p>
      )}
      {lastCallAt && (
        <p className={cn(SMALL, 'text-muted-foreground')}>
          Last call from a scheduler: {zone.formatDateTime(lastCallAt)}
        </p>
      )}
    </>
  );
}
