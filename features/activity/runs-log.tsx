'use client';

import { useOptimistic, useRef, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  CircleSmallIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useZone } from '@/components/time-zone';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import { cn } from '@/lib/shared/cn';
import { seconds } from '@/lib/shared/format';
import { triggerLabel } from '@/lib/listings/triggers';
import { isRunFilter, RUN_FILTERS, runsHref, type RunFilter } from './run-filter';

export type BoardAdded = { board: string; label: string; added: number };

/**
 * The scrape runs, newest first, a page at a time: filtered by what started them, each opening to what it
 * added where. The filter and the page are the URL's (/activity?runs=failed&page=1); the server sends
 * that page's runs only.
 */
export function RunsLog({
  runs,
  added,
  counts,
  filter,
  page,
  pages,
  running,
}: {
  /** this page's */
  runs: ScrapeRun[];
  /** by run id: the offers it added, per board */
  added: Record<number, BoardAdded[]>;
  /** how many runs each filter shows, in the whole log */
  counts: Record<RunFilter, number>;
  filter: RunFilter;
  /** from 0, the newest runs */
  page: number;
  pages: number;
  running: boolean;
}) {
  const router = useRouter();
  const top = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  // the chip is picked on the click; the list follows when the server has the page
  const [picked, setPicked] = useOptimistic(filter);
  const go = (href: string, next: RunFilter = filter) => {
    // a page starts at the log's top: back there if it's scrolled away
    if (top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView({ block: 'start' });
    startTransition(() => {
      setPicked(next);
      router.push(href, { scroll: false });
    });
  };
  return (
    <div ref={top} className="scroll-mt-2">
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
        value={picked}
        onValueChange={(value) => isRunFilter(value) && go(runsHref(value), value)}
        aria-label="Show runs"
        className="mb-2 flex-wrap"
      >
        {RUN_FILTERS.map((option) => (
          <ToggleGroupItem key={option.id} value={option.id} className="px-2.5 text-xs">
            {option.label} <span className="text-muted-foreground tabular-nums">{counts[option.id]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div aria-busy={pending} className={cn('transition-opacity', pending && 'opacity-60')}>
        {runs.length ? (
          <ol className="m-0 list-none border-t p-0 text-[13px]">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} added={added[run.id] ?? []} />
            ))}
          </ol>
        ) : (
          <p className="my-1.5 text-xs text-muted-foreground">
            {counts.all ? 'No run of this kind in the last two weeks.' : 'No runs yet. Use “Scrape now” at the top.'}
          </p>
        )}
        {pages > 1 && (
          <nav
            className="mt-2 flex items-center justify-between text-xs text-muted-foreground [&_a]:text-brand [&_a]:no-underline"
            aria-label="Pages of runs"
          >
            {page > 0 ? (
              <PageLink href={runsHref(filter, page - 1)} go={go}>
                <ArrowLeftIcon /> Newer
              </PageLink>
            ) : (
              <span />
            )}
            <span className="tabular-nums">
              Page {page + 1} of {pages}
            </span>
            {page + 1 < pages ? (
              <PageLink href={runsHref(filter, page + 1)} go={go}>
                Older <ArrowRightIcon />
              </PageLink>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

/** A link to another page of the log, through go(): a real link for a new tab, the log's own navigation on a click. */
function PageLink({ href, go, children }: { href: string; go: (href: string) => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      onNavigate={(event) => {
        // only plain clicks reach onNavigate (not Ctrl/Cmd+click, which opens a new tab)
        event.preventDefault();
        go(href);
      }}
    >
      {children}
    </Link>
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
          {!added.length && (
            <p className="m-0 text-muted-foreground">
              {run.finishedAt ? 'No new offers.' : 'Still going, or it stopped.'}
            </p>
          )}
          {/* per board what it added, then per scraper what failed: its status and the site's message */}
          {added.length + run.errors.length > 0 && (
            <ul className="m-0 list-none p-0">
              {added.map((board) => (
                <li key={board.board}>
                  {board.label}: <strong>{board.added} new</strong>
                </li>
              ))}
              {run.errors.map((failure, i) => (
                <li
                  key={i}
                  className={cn('[overflow-wrap:anywhere]', failure.warning ? 'text-warning' : 'text-destructive')}
                >
                  {failure.scraper}: {failure.error}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
