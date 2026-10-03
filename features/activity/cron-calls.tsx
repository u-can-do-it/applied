'use client';

import { useZone } from '@/components/time-zone';
import { Code } from '@/components/field';
import type { CronInfo } from '@/lib/health/reads';
import { lastAnswer } from '@/lib/listings/cron';

/** Supabase Cron's last call and what the app answered, and when anything last called the endpoint. */
export function CronCalls({ cron, lastCallAt }: { cron: CronInfo; lastCallAt: string | null }) {
  const zone = useZone();
  return (
    <div className="text-[13px]">
      {cron.readError ? (
        <p className="my-1.5 text-warning [overflow-wrap:anywhere]">Couldn’t check Supabase Cron: {cron.readError}</p>
      ) : !cron.available ? (
        <p className="my-1.5 text-muted-foreground">Supabase Cron isn’t enabled in the database.</p>
      ) : !cron.scheduled ? (
        <p className="my-1.5 text-muted-foreground">Supabase Cron isn’t connected (Settings → Scraping).</p>
      ) : (
        <>
          <p className="my-1.5">
            {cron.lastAt ? (
              <>
                Last call from Supabase: <span className="tabular-nums">{zone.formatDateTime(cron.lastAt)}</span>,{' '}
                {cron.lastError ? <span className="text-destructive">failed: {cron.lastError}</span> : lastAnswer(cron)}
                .
              </>
            ) : (
              'Supabase hasn’t called yet.'
            )}
          </p>
          <p className="my-1.5 text-xs text-muted-foreground">
            The job: <Code>{cron.schedule}</Code> (UTC) → <Code>{cron.url}</Code>
            {cron.active === false && ' · switched off'}
          </p>
        </>
      )}
      <p className="my-1.5 text-xs text-muted-foreground">
        Last call from a scheduler: {lastCallAt ? zone.formatDateTime(lastCallAt) : 'none yet'}
      </p>
    </div>
  );
}
