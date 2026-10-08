'use client';

import { useOptimistic } from 'react';
import { CircleSmallIcon, PauseIcon, PlayIcon } from 'lucide-react';
import {
  answered,
  checkOnSubmit,
  FormError,
  formSchema,
  lazySchema,
  useAppForm,
  useFollowServer,
} from '@/components/form';
import { PanelHeading } from '@/components/help';
import { ActionError, useAction } from '@/components/use-action';
import { useZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/shared/cn';
import { zoneName } from '@/lib/dates';
import { describeInterval, INTERVALS, WEEKEND_INTERVALS, type ScrapeSettings } from '@/lib/listings/settings';
import type { CronInfo } from '@/lib/db/repos/cron';
import { saveScheduleAction, setScrapingPausedAction } from './actions';
import { loadSettingsSchemas } from './settings-schemas';
import { CronBox } from './cron-box';
import { PANEL, SUBHEAD } from './panel-styles';
import { ScrapingHelp } from './scraping-help';
import { TimeZoneField } from './time-zone-field';

// Scraping: paused or running, when (the schedule and the time zone), and what calls the endpoint
// (Supabase Cron). What the runs did is on the Activity tab.

export function SchedulePanel({
  settings,
  timeZone,
  cron,
  endpoint,
}: {
  settings: ScrapeSettings;
  /** the zone the app uses (the one picked, or what it used before one was) */
  timeZone: string;
  cron: CronInfo;
  endpoint: string;
}) {
  const form = useScheduleForm(settings);
  const act = useAction();
  const pause = useAction();
  const [paused, showPaused] = useOptimistic(!settings.enabled);
  const zone = useZone();

  return (
    <Card className={PANEL} role="region" aria-labelledby="schedule-h">
      <CardHeader className="px-4">
        <PanelHeading id="schedule-h" title="Scraping" help={<ScrapingHelp cron={cron} />} />
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
                : every {describeInterval(settings.everyMinutes)} (weekends{' '}
                {describeInterval(settings.weekendEveryMinutes)}), {settings.fromHour}:00–{settings.toHour}:00 (
                {zoneName(zone.tz)}).
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          noValidate
          onFocus={() => void loadSettingsSchemas()}
          className="flex flex-wrap items-start gap-x-3.5 gap-y-2 text-sm"
        >
          <form.AppField name="everyMinutes">
            {(field) => (
              <field.SelectField label="every" toValue={Number} className={INLINE}>
                {INTERVALS.map((minutes) => (
                  <NativeSelectOption key={minutes} value={minutes}>
                    {describeInterval(minutes)}
                  </NativeSelectOption>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          <form.AppField name="weekendEveryMinutes">
            {(field) => (
              <field.SelectField label="weekends every" toValue={Number} className={INLINE}>
                {WEEKEND_INTERVALS.map((minutes) => (
                  <NativeSelectOption key={minutes} value={minutes}>
                    {describeInterval(minutes)}
                  </NativeSelectOption>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          <form.AppField name="fromHour">
            {(field) => <field.NumberField label="from" min={0} max={24} className={INLINE} controlClassName="w-16" />}
          </form.AppField>
          <form.AppField name="toHour">
            {(field) => <field.NumberField label="to" min={0} max={24} className={INLINE} controlClassName="w-16" />}
          </form.AppField>
          <span className="leading-8 text-muted-foreground">o’clock</span>
          <form.Subscribe selector={(state) => [state.isSubmitting, state.isDefaultValue] as const}>
            {([saving, unchanged]) => (
              <Button type="submit" disabled={saving || unchanged} aria-busy={saving || undefined}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </form.Subscribe>
          <FormError form={form} className="mt-0 basis-full" />
        </form>
        <TimeZoneField value={settings.timeZone} effective={timeZone} />

        <h3 className={SUBHEAD}>What calls it</h3>
        <CronBox cron={cron} settings={settings} endpoint={endpoint} act={act} />
      </CardContent>
    </Card>
  );
}

// a label beside its control, the four in a row
const INLINE =
  'grid grid-cols-[auto_auto] items-center gap-x-1.5 gap-y-1 text-sm text-foreground [&>label]:text-sm [&>label]:text-foreground [&>[aria-live]]:col-span-2';

/** The schedule as a form: what you type stays; a refreshed page brings its values while the form still shows the old ones. */
function useScheduleForm(settings: ScrapeSettings) {
  const server = {
    everyMinutes: settings.everyMinutes,
    weekendEveryMinutes: settings.weekendEveryMinutes,
    fromHour: settings.fromHour,
    toHour: settings.toHour,
  };
  const form = useAppForm({
    defaultValues: server,
    validationLogic: checkOnSubmit,
    validators: {
      onDynamicAsync: lazySchema(() => loadSettingsSchemas().then((schemas) => formSchema(schemas.scheduleSchema))),
    },
    onSubmit: async ({ value, formApi }) => {
      const answer = await answered(formApi, saveScheduleAction(value), { success: (saved) => saved });
      // saved: what you typed is what the refreshed page has, so the form follows the page again
      if (answer.ok) formApi.reset(value, { keepDefaultValues: true });
    },
  });
  useFollowServer(form, server);
  return form;
}
