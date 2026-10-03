'use client';

import { useOptimistic, type SubmitEvent } from 'react';
import { CircleSmallIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { ActionError, useAction } from '@/components/use-action';
import { useZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/shared/cn';
import { zoneName } from '@/lib/dates';
import { INTERVALS, type ScrapeSettings } from '@/lib/listings/settings';
import type { CronStatus } from '@/lib/db/repos/cron';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import type { ScrapeState } from '@/lib/db/repos/scrape-state';
import { saveScheduleAction, setScrapingPausedAction } from './actions';
import { CronBox } from './cron-box';
import { LastRuns } from './last-runs';
import { PANEL, PANEL_TITLE, SUBHEAD } from './panel-styles';
import { TimeZoneField } from './time-zone-field';
import { useServerForm } from './use-server-form';

// Scraping: paused or running, when (the schedule and the time zone), the last runs, and what calls
// the endpoint (Supabase Cron).

export function SchedulePanel({
  settings,
  state,
  running,
  runs,
  cron,
  endpoint,
}: {
  settings: ScrapeSettings;
  state: ScrapeState;
  running: boolean;
  runs: ScrapeRun[];
  cron: CronStatus & { error?: string };
  endpoint: string;
}) {
  const { form, setForm, dirty } = useServerForm({
    everyMinutes: settings.everyMinutes,
    fromHour: String(settings.fromHour),
    toHour: String(settings.toHour),
  });
  const save = useAction();
  const edit = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    save.run(() => saveScheduleAction({ ...form, fromHour: Number(form.fromHour), toHour: Number(form.toHour) }));
  };
  const act = useAction();
  const pause = useAction();
  const [paused, showPaused] = useOptimistic(!settings.enabled);
  const zone = useZone();

  return (
    <Card className={PANEL} role="region" aria-labelledby="schedule-h">
      <CardHeader className="px-4">
        <h2 id="schedule-h" className={PANEL_TITLE}>
          Scraping
        </h2>
      </CardHeader>
      <CardContent className="px-4">
        <div
          className={cn(
            'mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border bg-background px-3 py-2.5',
            paused && 'border-warning',
          )}
        >
          <p className="m-0 text-xs">
            {paused ? (
              <>
                <strong className="text-warning">
                  <PauseIcon /> Paused
                </strong>
                : nothing scrapes on its own; “Scrape now” still works.
              </>
            ) : (
              <>
                <strong className="text-success">
                  <CircleSmallIcon fill="currentColor" /> Running
                </strong>
                : every{' '}
                {settings.everyMinutes < 60 ? `${settings.everyMinutes} min` : `${settings.everyMinutes / 60} h`},{' '}
                {settings.fromHour}:00–{settings.toHour}:00 ({zoneName(zone.tz)}).
              </>
            )}
          </p>
          <Button
            type="button"
            variant={paused ? 'default' : 'outline'}
            aria-busy={pause.busy || undefined}
            onClick={() => {
              const next = !paused;
              pause.run(
                () => setScrapingPausedAction({ paused: next }),
                () => showPaused(next),
              );
            }}
          >
            {paused ? (
              <>
                <PlayIcon /> Resume scraping
              </>
            ) : (
              <>
                <PauseIcon /> Pause scraping
              </>
            )}
          </Button>
          <ActionError error={pause.error} className="mt-0 basis-full" />
        </div>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-1.5">
            every
            <NativeSelect
              value={form.everyMinutes}
              onChange={(event) => edit({ everyMinutes: Number(event.target.value) })}
            >
              {INTERVALS.map((minutes) => (
                <NativeSelectOption key={minutes} value={minutes}>
                  {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="inline-flex items-center gap-1.5">
            from
            <Input
              className="w-16"
              type="number"
              min={0}
              max={24}
              value={form.fromHour}
              onChange={(event) => edit({ fromHour: event.target.value })}
            />
            to
            <Input
              className="w-16"
              type="number"
              min={0}
              max={24}
              value={form.toHour}
              onChange={(event) => edit({ toHour: event.target.value })}
            />
            <span className="text-muted-foreground">o’clock</span>
          </label>
          <Button type="submit" disabled={save.busy || !dirty} aria-busy={save.busy || undefined}>
            {save.busy ? 'Saving…' : 'Save'}
          </Button>
          <ActionError error={save.error} className="mt-0 basis-full" />
        </form>
        <TimeZoneField value={settings.timeZone} />

        <h3 className={SUBHEAD}>Last runs</h3>
        <LastRuns runs={runs} running={running} lastCallAt={state.lastCallAt} />

        <h3 className={SUBHEAD}>What calls it</h3>
        <CronBox cron={cron} settings={settings} endpoint={endpoint} act={act} />
      </CardContent>
    </Card>
  );
}
