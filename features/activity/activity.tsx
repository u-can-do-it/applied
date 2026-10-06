import { connection } from 'next/server';
import { isPaused } from '@/lib/ai/run-view';
import { byId } from '@/lib/boards';
import * as aiRunsRepo from '@/lib/db/repos/ai-runs';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { cronInfo, profileList } from '@/lib/health/reads';
import { effectiveTimeZone } from '@/lib/listings/settings';
import { message } from '@/lib/shared/errors';
import type { SearchParams } from '@/lib/shared/search-params';
import { appSettings } from '@/lib/time-zone';
import { Code } from '@/components/field';
import { PanelHeading } from '@/components/help';
import { LoadError } from '@/components/load-error';
import { TimeZone } from '@/components/time-zone';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AiRunCard } from '@/features/ai/ai-run-card';
import { CronCalls } from './cron-calls';
import { QueueList } from './queue-list';
import { filterCounts, parseRunsQuery, RUNS_PER_PAGE, runsOf, type RunFilter } from './run-filter';
import { RunsLog, type BoardAdded } from './runs-log';
import { ScraperResults } from './scraper-results';

// The Activity tab: what the machinery did. Settings holds what you set; this shows the scrape runs,
// each scraper's last result, the Telegram queue, Supabase Cron's calls and the AI runs.

const QUEUE_SHOWN = 30;

function Section({
  id,
  title,
  help,
  children,
}: {
  id: string;
  title: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-3.5 gap-2.5 py-3.5" role="region" aria-labelledby={id}>
      <CardHeader className="px-4">
        <PanelHeading id={id} title={title} help={help} />
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

async function load(filter: RunFilter, asked: number) {
  const [settings, counts, scrapers, state, queue, queued, cron, aiRuns, profiles] = await Promise.all([
    appSettings(),
    runsRepo.counts(),
    scrapersRepo.list(),
    stateRepo.get(),
    queueRepo.list(QUEUE_SHOWN),
    queueRepo.size(),
    cronInfo(),
    aiRunsRepo.recent(10),
    profileList(),
  ]);
  // the log's page: a link to one past the end (the log keeps two weeks) shows the last one
  const perFilter = filterCounts(counts);
  const pages = Math.max(1, Math.ceil(perFilter[filter] / RUNS_PER_PAGE));
  const page = Math.min(asked, pages - 1);
  const runs = await runsRepo.page(runsOf(filter), page, RUNS_PER_PAGE);
  const added: Record<number, BoardAdded[]> = {};
  for (const row of await runsRepo.addedPerBoard(runs.map((run) => run.id))) {
    (added[row.runId] ??= []).push({ board: row.board, label: byId(row.board)?.label ?? row.board, added: row.added });
  }
  // the active profile's open run is the one Settings → AI filter continues
  const activeId = profiles.at(0)?.id ?? null;
  const log = { runs, added, counts: perFilter, filter, page, pages };
  return { settings, log, scrapers, state, queue, queued, cron, aiRuns, activeId };
}

export async function Activity({ searchParams }: { searchParams: SearchParams }) {
  await connection(); // always fresh
  const { filter, page } = parseRunsQuery(await searchParams);
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(filter, page);
  } catch (error) {
    return <LoadError title="Can’t load the activity." detail={message(error)} />;
  }
  const { settings, log, scrapers, state, queue, queued, cron, aiRuns, activeId } = data;
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request: "now" is that request's time
  const now = Date.now();
  return (
    <TimeZone tz={effectiveTimeZone(settings)}>
      <Section
        id="runs-h"
        title="Scrape runs"
        help={
          <>
            <p>
              Each run goes through every scraper that’s on. “on the pages”: the offers its pages listed; “kept”: the
              ones that passed the filters; “new”: offers not saved before; “matched”: new jobs the AI profile matched;
              “sent”: what went out (Telegram, push).
            </p>
            <p>
              Open a run to see which board its new offers came from, and what failed: the status and the site’s
              message. The log keeps two weeks, {RUNS_PER_PAGE} runs a page.
            </p>
          </>
        }
      >
        <RunsLog {...log} running={Boolean(state.lockedUntil && Date.parse(state.lockedUntil) > now)} />
      </Section>

      <Section id="scrapers-results-h" title="Scrapers">
        <ScraperResults scrapers={scrapers} />
      </Section>

      <Section
        id="queue-h"
        title="Notification queue"
        help={
          <p>
            New jobs wait here until they’re sent: right after a run, or while notifications are muted, until you unmute
            or send them (Settings → Notifications, or /send in Telegram).
          </p>
        }
      >
        <QueueList queue={queue} total={queued} muted={state.muted} />
      </Section>

      <Section
        id="calls-h"
        title="Cron calls"
        help={
          <p>
            Supabase Cron calls the app on the interval; the app answers whether a run was due. “Last call from a
            scheduler” counts any caller of <Code>/api/cron/scrape</Code>.
          </p>
        }
      >
        <CronCalls cron={cron} lastCallAt={state.lastCallAt} />
      </Section>

      <Section
        id="ai-runs-h"
        title="AI runs"
        help={
          <p>
            An AI run checks a date range against a profile version in two steps: Duplicates (the AI merges offers of
            the same job) then Assessment (a verdict for every job). It works in slices of a few minutes. Between slices
            it waits, paused, until Supabase Cron’s next call (the scraping schedule) or Settings → AI filter continues
            it, whichever comes first; no tab needs to stay open.
          </p>
        }
      >
        {aiRuns.length ? (
          <div className="flex flex-col gap-2">
            {aiRuns.map((run) => (
              <AiRunCard
                key={run.id}
                pausedHint={
                  run.profileVersion !== run.version ? 'cancel' : run.profileId === activeId ? 'open' : 'select'
                }
                run={{
                  ...run,
                  paused: isPaused(run, now),
                  profile: { name: run.profileName, version: run.version },
                  stale: run.profileVersion !== run.version,
                }}
              />
            ))}
          </div>
        ) : (
          <p className="my-1.5 text-xs text-muted-foreground">No AI runs yet: they’re started on the AI filter tab.</p>
        )}
      </Section>
    </TimeZone>
  );
}
