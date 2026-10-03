'use client';

import { startTransition, useMemo, useOptimistic, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { CircleSmallIcon, PauseIcon, PlayIcon, SparklesIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { CheckField, Code, Field } from '@/components/field';
import { ActionError, useAction } from '@/components/use-action';
import { useZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/shared/cn';
import { deviceTimeZone, timeZones } from '@/lib/dates';
import { cronSchedule, describeSchedule } from '@/lib/listings/cron';
import { INTERVALS, normalizeList, type ScrapeSettings } from '@/lib/listings/settings';
import type { CronStatus } from '@/lib/db/repos/cron';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import type { ScrapeState } from '@/lib/db/repos/scrape-state';
import { seconds } from '@/lib/shared/format';
import {
  cronConnectAction,
  cronDisconnectAction,
  saveFiltersAction,
  saveScheduleAction,
  setScrapingPausedAction,
  setTimeZoneAction,
} from './actions';

// How every change here behaves (the Next.js "interactive apps" patterns):
// - toggles show the new value at once (useOptimistic) until the refreshed page has it;
// - forms keep what you typed (controlled, no automatic form reset) and take the server's values
//   only where you haven't typed since;
// - "Saved." is a toast; what went wrong shows next to the control until the next try (useAction).

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A form over server data: shows what you type; new server data replaces only untouched values. */
function useServerForm<T extends object>(server: T) {
  const [base, setBase] = useState(server);
  const [form, setForm] = useState(server);
  if (!same(server, base)) {
    // the page was refreshed with other values (saved here, or changed elsewhere)
    setBase(server);
    if (same(form, base)) setForm(server);
  }
  return { form, setForm, dirty: !same(form, server) };
}

const zoneName = (tz: string) => tz.replaceAll('_', ' '); // "America/New York"

/** a Settings panel (scrapers.tsx has the same) */
const PANEL = 'mb-3.5 gap-2.5 py-3.5';
const PANEL_TITLE = 'm-0 text-base font-semibold';
const SUBHEAD = 'mt-4 mb-1.5 text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase';
const SMALL = 'my-1.5 text-xs';

// ---- schedule + what calls the endpoint --------------------------------------------------

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
        {state.lastCallAt && (
          <p className={cn(SMALL, 'text-muted-foreground')}>
            Last call from a scheduler: {zone.formatDateTime(state.lastCallAt)}
          </p>
        )}

        <h3 className={SUBHEAD}>What calls it</h3>
        <CronBox cron={cron} settings={settings} endpoint={endpoint} act={act} />
      </CardContent>
    </Card>
  );
}

const noSubscribe = () => () => {};

/** The app's time zone: this browser's (the default: it follows the browser you open the app in), or a fixed one. */
function TimeZoneField({ value }: { value: string }) {
  const save = useAction();
  const [shown, show] = useOptimistic(value);
  // only the browser knows its zone: none in the server's HTML, then this one's
  const device = useSyncExternalStore(noSubscribe, deviceTimeZone, () => null);
  const zones = useMemo(() => timeZones(), []);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="inline-flex max-w-full min-w-0 flex-1 items-center gap-1.5 text-sm whitespace-nowrap">
        Time zone
        <NativeSelect
          className="max-w-[340px] min-w-0 flex-1"
          value={shown}
          aria-busy={save.busy || undefined}
          onChange={(event) => {
            const next = event.target.value;
            save.run(
              () => setTimeZoneAction({ tz: next, browser: device ?? '' }),
              () => show(next),
            );
          }}
        >
          <NativeSelectOption value="">This browser’s{device ? ` (${zoneName(device)})` : ''}</NativeSelectOption>
          {zones.map((tz) => (
            <NativeSelectOption key={tz} value={tz}>
              {zoneName(tz)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <p className="m-0 basis-full text-xs text-muted-foreground">
        For the hours above, and every day and time the app shows (lists, date filters, Telegram).
      </p>
      <ActionError error={save.error} className="mt-1 basis-full" />
    </div>
  );
}

/** What the app answered the cron's last call, in words. */
function lastAnswer(cron: CronStatus) {
  if (cron.lastResult === 'skipped') return `skipped${cron.lastReason ? `, ${cron.lastReason}` : ''}`;
  if (cron.lastResult === 'started') return 'a run started';
  if (cron.lastResult === 'done') return 'a run went through';
  return `answered ${cron.lastStatus}`;
}

function CronBox({
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

const BUTTONS = 'mt-1.5 flex flex-wrap items-center gap-2';

// ---- filters ------------------------------------------------------------------------------

const join = (xs: string[]) => xs.join(', ');
const LISTS = ['keywords', 'cities', 'ignore', 'mute'] as const;

export function FiltersPanel({ settings }: { settings: ScrapeSettings }) {
  const { form, setForm, dirty } = useServerForm({
    keywords: join(settings.keywords),
    cities: join(settings.cities),
    remoteOk: settings.remoteOk,
    ignore: join(settings.ignore),
    mute: join(settings.mute),
  });
  const save = useAction();
  const edit = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    // shown the way it's saved ("React,Vue " -> "React, Vue"), so it matches the refreshed page
    const normalized = { ...form };
    for (const field of LISTS) normalized[field] = join(normalizeList(form[field]));
    save.run(async () => {
      const answer = await saveFiltersAction(normalized);
      if (answer.ok) startTransition(() => setForm(normalized));
      return answer;
    });
  };
  const text = (field: (typeof LISTS)[number]) => ({
    value: form[field],
    onChange: (event: { target: { value: string } }) => edit({ [field]: event.target.value }),
  });
  return (
    <Card className={PANEL} role="region" aria-labelledby="filters-h">
      <CardHeader className="px-4">
        <h2 id="filters-h" className={PANEL_TITLE}>
          Filters
        </h2>
      </CardHeader>
      <CardContent className="px-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label="Keywords"
            hint={
              <>
                Searched on every board (<Code>{'{keyword}'}</Code> in a scraper’s link) and, where a scraper checks it,
                required in the offer’s title or skills. A keyword starts a word: “react” matches ReactJS, not Preact.
              </>
            }
          >
            <Input {...text('keywords')} placeholder="React, Next.js" />
          </Field>
          <Field
            label="Cities"
            hint="Part of a name is enough: “warszaw” matches Warszawa and Warszawie. Empty = anywhere. Offers that don’t say where pass."
          >
            <Input {...text('cities')} placeholder="warszaw, warsaw" />
          </Field>
          <CheckField>
            <Checkbox checked={form.remoteOk} onCheckedChange={(checked) => edit({ remoteOk: checked === true })} />
            Remote offers are fine wherever they are
          </CheckField>
          <Field label="Skip titles with" hint="Not saved at all.">
            <Input {...text('ignore')} placeholder="PHP, Angular" />
          </Field>
          <Field
            label="Save, but don’t send to Telegram"
            hint="Whole words: “java” doesn’t hit JavaScript, “.net” also hits ASP.NET."
          >
            <Input {...text('mute')} />
          </Field>
          <div className={BUTTONS}>
            <Button type="submit" disabled={save.busy || !dirty} aria-busy={save.busy || undefined}>
              {save.busy ? 'Saving…' : 'Save filters'}
            </Button>
          </div>
          <ActionError error={save.error} className="mt-0" />
        </form>
      </CardContent>
    </Card>
  );
}
