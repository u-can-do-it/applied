'use client';

import { CircleSmallIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { Code } from '@/components/field';
import { ActionError, type useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/shared/cn';
import { cronProblem, describeSchedule } from '@/lib/listings/cron';
import type { ScrapeSettings } from '@/lib/listings/settings';
import type { CronInfo } from '@/lib/db/repos/cron';
import { cronConnectAction, cronDisconnectAction } from './actions';
import { BUTTONS, SMALL } from './panel-styles';

export function CronBox({
  cron,
  settings,
  endpoint,
  act,
}: {
  cron: CronInfo;
  settings: ScrapeSettings;
  endpoint: string;
  act: ReturnType<typeof useAction>;
}) {
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
  if (cron.readError) {
    return (
      <p className={cn(SMALL, 'text-sm text-warning [overflow-wrap:anywhere]')}>
        Couldn’t check Supabase Cron: {cron.readError}
      </p>
    );
  }
  if (!cron.available) {
    return (
      <p className={cn(SMALL, 'text-sm')}>
        <span className="text-warning">Supabase Cron isn’t enabled in the database</span>. Run{' '}
        <Code>npm run db:migrate</Code>.
      </p>
    );
  }
  if (!cron.scheduled) {
    return (
      <div className="text-sm">
        <p className={SMALL}>
          <span className="font-semibold text-muted-foreground">
            <CircleSmallIcon /> Not connected
          </span>
          : nothing scrapes on its own, only “Scrape now”.
        </p>
        <div className={BUTTONS}>{connect('Connect Supabase Cron')}</div>
        <ActionError error={act.error} />
      </div>
    );
  }
  // connected: Reconnect is only offered when something needs it
  const paused = !settings.enabled;
  const problem = cronProblem(cron, settings, endpoint);
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
          : `Supabase calls the app ${describeSchedule(settings)}.`}
      </p>
      {problem && <p className={cn(SMALL, 'text-warning')}>{problem} Reconnect to fix it.</p>}
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
