'use client';

import { CircleSmallIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { Code } from '@/components/field';
import { ActionError, type useAction } from '@/components/use-action';
import { useZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/shared/cn';
import { cronSchedule, describeSchedule } from '@/lib/listings/cron';
import type { ScrapeSettings } from '@/lib/listings/settings';
import type { CronStatus } from '@/lib/db/repos/cron';
import { cronConnectAction, cronDisconnectAction } from './actions';
import { BUTTONS, SMALL } from './panel-styles';

/** What the app answered the cron's last call, in words. */
function lastAnswer(cron: CronStatus) {
  if (cron.lastResult === 'skipped') return `skipped${cron.lastReason ? `, ${cron.lastReason}` : ''}`;
  if (cron.lastResult === 'started') return 'a run started';
  if (cron.lastResult === 'done') return 'a run went through';
  return `answered ${cron.lastStatus}`;
}

export function CronBox({
  cron,
  settings,
  endpoint,
  act,
}: {
  cron: CronStatus & { error?: string };
  settings: ScrapeSettings;
  endpoint: string;
  act: ReturnType<typeof useAction>;
}) {
  const { formatTime } = useZone();
  const confirm = useConfirm();
  const connect = (label: string) => (
    <Button
      type="button"
      onClick={() => act.run(cronConnectAction)}
      disabled={act.busy}
      aria-busy={act.busy || undefined}
    >
      {act.busy ? 'Working…' : label}
    </Button>
  );
  const disconnect = async () => {
    const yes = await confirm({
      title: 'Stop Supabase Cron?',
      description: 'Nothing will scrape on its own until you connect it again.',
      action: 'Disconnect',
      destructive: true,
    });
    if (yes) act.run(cronDisconnectAction);
  };
  if (!cron.available) {
    return (
      <div className="text-sm">
        <p className={SMALL}>
          Supabase Cron isn’t enabled in the database{cron.error ? ` (${cron.error})` : ''}. Run{' '}
          <Code>npm run db:migrate</Code> (it turns on pg_cron and pg_net), or enable Cron under Integrations in
          Supabase.
        </p>
      </div>
    );
  }
  if (!cron.scheduled) {
    return (
      <div className="text-sm">
        <p className={SMALL}>
          <span className="font-semibold text-muted-foreground">
            <CircleSmallIcon /> Not connected
          </span>
          : nothing scrapes on its own, only “Scrape now”. Connecting makes Supabase call the app{' '}
          {describeSchedule(settings)}; the app decides whether a run is due.
        </p>
        <div className={BUTTONS}>{connect('Connect Supabase Cron')}</div>
        <ActionError error={act.error} />
      </div>
    );
  }
  // connected: Reconnect is only offered when something needs it. The job follows the settings
  // above (each change there reschedules it); one set up before a change, or switched off in
  // Supabase, doesn't.
  const paused = !settings.enabled;
  const problem =
    cron.url && cron.url !== endpoint
      ? `It calls another address than this app’s (${endpoint}). Reconnect to point it here.`
      : cron.active === false && !paused
        ? 'The job is switched off in Supabase. Reconnect to switch it on.'
        : cron.schedule !== cronSchedule(settings) || cron.active !== !paused
          ? 'Its schedule isn’t the one the settings above make (it was set up before they changed). Reconnect to update it.'
          : cron.lastStatus === 401
            ? 'The app refused the last call (401): the secret changed (APP_PASSWORD or CRON_SECRET). Reconnect to update it.'
            : cron.lastError
              ? `The last call failed: ${cron.lastError}. If it keeps failing, try Reconnect.`
              : null;
  return (
    <div className="text-sm">
      <p className={SMALL}>
        {problem ? (
          <span className="text-warning">
            <CircleSmallIcon fill="currentColor" /> Connected, with a problem
          </span>
        ) : paused ? (
          <span className="font-semibold text-muted-foreground">
            <CircleSmallIcon fill="currentColor" /> Connected, paused
          </span>
        ) : (
          <span className="text-success">
            <CircleSmallIcon fill="currentColor" /> Connected
          </span>
        )}
        :{' '}
        {paused
          ? 'Supabase doesn’t call the app until you resume scraping.'
          : `Supabase calls the app ${describeSchedule(settings)}, and it scrapes when a run is due.`}
        {cron.lastAt && !cron.lastError && ` Last call ${formatTime(cron.lastAt)}: ${lastAnswer(cron)}.`}
      </p>
      <p className={cn(SMALL, 'text-muted-foreground')}>
        The job (UTC, so an hour wider where clocks change): <Code>{cron.schedule}</Code> → <Code>{cron.url}</Code>
      </p>
      {problem && <p className={cn(SMALL, 'text-warning')}>{problem}</p>}
      <div className={BUTTONS}>
        {problem && connect('Reconnect')}
        <Button type="button" variant="outline" disabled={act.busy} onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
      <ActionError error={act.error} />
    </div>
  );
}
