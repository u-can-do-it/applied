import Link from 'next/link';
import { Code } from '@/components/field';
import type { CronStatus } from '@/lib/db/repos/cron';

/** The Scraping panel's help: what a run does, when it's due, the time zone, and Supabase Cron. */
export function ScrapingHelp({ cron }: { cron: CronStatus }) {
  return (
    <>
      <p>
        A run goes through every scraper that’s on: it reads their pages, keeps the offers that pass the filters, saves
        the new ones and sends them to Telegram. A scheduled run comes every interval, within the hours; “Scrape now” at
        the top starts one at any time, paused or not.
      </p>
      <p>
        The time zone is the one for these hours and for every day and time the app shows (lists, date filters,
        Telegram). Your browser’s zone is offered; only a pick here changes it, and Supabase Cron’s hours with it.
      </p>
      <p>
        Supabase Cron is what calls the app on its own: a job in the database (pg_cron and pg_net, which{' '}
        <Code>npm run db:migrate</Code> turns on, or Integrations → Cron in Supabase) that calls{' '}
        <Code>/api/cron/scrape</Code> on the interval; the app decides whether a run is due. Every change here
        reschedules it. Its schedule is in UTC, so it’s an hour wider where clocks change.
        {cron.scheduled && cron.schedule && (
          <>
            {' '}
            The job: <Code>{cron.schedule}</Code> → <Code>{cron.url}</Code>
          </>
        )}
      </p>
      <p>
        What the runs found, what each scraper did and when Supabase last called are on the{' '}
        <Link href="/activity" className="text-brand underline-offset-4 hover:underline">
          Activity
        </Link>{' '}
        tab.
      </p>
    </>
  );
}
