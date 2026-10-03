'use client';

import { startTransition, useMemo, useOptimistic, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { CircleSmallIcon, PauseIcon, PlayIcon, SparklesIcon } from 'lucide-react';
import { Feedback, useAction } from '@/components/use-action';
import { useZone } from '@/components/time-zone';
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
// - answers ("Saved.") and closing a dialog are wrapped in startTransition after the await, so
//   they land in the same frame as the refreshed data instead of a moment before it.

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
  const edit = (patch: Partial<typeof form>) => {
    save.clear();
    setForm((current) => ({ ...current, ...patch }));
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    save.run(() => saveScheduleAction({ ...form, fromHour: Number(form.fromHour), toHour: Number(form.toHour) }));
  };
  const act = useAction();
  const pause = useAction();
  const [paused, showPaused] = useOptimistic(!settings.enabled);
  const zone = useZone();

  return (
    <section className="panel" aria-labelledby="schedule-h">
      <h2 id="schedule-h">Scraping</h2>
      <div className={`pause-row${paused ? ' is-paused' : ''}`}>
        <p className="small">
          {paused ? (
            <>
              <strong className="warn">
                <PauseIcon /> Paused
              </strong>
              : nothing scrapes on its own; “Scrape now” still works.
            </>
          ) : (
            <>
              <strong className="ok-text">
                <CircleSmallIcon fill="currentColor" /> Running
              </strong>
              : every {settings.everyMinutes < 60 ? `${settings.everyMinutes} min` : `${settings.everyMinutes / 60} h`},{' '}
              {settings.fromHour}:00–{settings.toHour}:00 ({zoneName(zone.tz)}).
            </>
          )}
        </p>
        <button
          type="button"
          className={paused ? undefined : 'secondary'}
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
        </button>
        <Feedback state={pause.state} />
      </div>
      <form onSubmit={submit} className="form-line">
        <label className="inline-field">
          every
          <select value={form.everyMinutes} onChange={(event) => edit({ everyMinutes: Number(event.target.value) })}>
            {INTERVALS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          from
          <input
            className="hour"
            type="number"
            min={0}
            max={24}
            value={form.fromHour}
            onChange={(event) => edit({ fromHour: event.target.value })}
          />
          to
          <input
            className="hour"
            type="number"
            min={0}
            max={24}
            value={form.toHour}
            onChange={(event) => edit({ toHour: event.target.value })}
          />
          <span className="muted">o’clock</span>
        </label>
        <button type="submit" disabled={save.busy || !dirty} aria-busy={save.busy || undefined}>
          {save.busy ? 'Saving…' : 'Save'}
        </button>
        <Feedback state={save.state} />
      </form>
      <TimeZoneField value={settings.timeZone} />

      <h3>Last runs</h3>
      {running && (
        <p className="muted small">
          <CircleSmallIcon fill="currentColor" /> A run is going right now.
        </p>
      )}
      {runs.length ? (
        <ol className="runs">
          {runs.map((run) => (
            <li key={run.id}>
              <span className="run-time">{zone.formatDateTime(run.startedAt)}</span>
              <span className="muted">{run.trigger}</span>
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
                <span className="muted">unfinished</span>
              )}
              {run.errors.map((failure, i) => (
                <span key={i} className="run-error">
                  {failure.scraper}: {failure.error}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No runs yet. Use “Scrape now” at the top.</p>
      )}
      {state.lastCallAt && (
        <p className="muted small">Last call from a scheduler: {zone.formatDateTime(state.lastCallAt)}</p>
      )}

      <h3>What calls it</h3>
      <CronBox cron={cron} settings={settings} endpoint={endpoint} act={act} />
    </section>
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
    <div className="tz-row">
      <label className="inline-field">
        Time zone
        <select
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
          <option value="">This browser’s{device ? ` (${zoneName(device)})` : ''}</option>
          {zones.map((tz) => (
            <option key={tz} value={tz}>
              {zoneName(tz)}
            </option>
          ))}
        </select>
      </label>
      <Feedback state={save.state} />
      <p className="muted small">
        For the hours above, and every day and time the app shows (lists, date filters, Telegram).
      </p>
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
  const connect = (label: string) => (
    <button
      type="button"
      onClick={() => act.run(cronConnectAction)}
      disabled={act.busy}
      aria-busy={act.busy || undefined}
    >
      {act.busy ? 'Working…' : label}
    </button>
  );
  if (!cron.available) {
    return (
      <div className="cron-box">
        <p className="small">
          Supabase Cron isn’t enabled in the database{cron.error ? ` (${cron.error})` : ''}. Run{' '}
          <code className="inline-code">npm run db:migrate</code> (it turns on pg_cron and pg_net), or enable Cron under
          Integrations in Supabase.
        </p>
      </div>
    );
  }
  if (!cron.scheduled) {
    return (
      <div className="cron-box">
        <p className="small">
          <span className="status-off">
            <CircleSmallIcon /> Not connected
          </span>
          : nothing scrapes on its own, only “Scrape now”. Connecting makes Supabase call the app{' '}
          {describeSchedule(settings)}; the app decides whether a run is due.
        </p>
        <div className="button-row">{connect('Connect Supabase Cron')}</div>
        <Feedback state={act.state} />
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
    <div className="cron-box">
      <p className="small">
        {problem ? (
          <span className="warn">
            <CircleSmallIcon fill="currentColor" /> Connected, with a problem
          </span>
        ) : paused ? (
          <span className="status-off">
            <CircleSmallIcon fill="currentColor" /> Connected, paused
          </span>
        ) : (
          <span className="ok-text">
            <CircleSmallIcon fill="currentColor" /> Connected
          </span>
        )}
        :{' '}
        {paused
          ? 'Supabase doesn’t call the app until you resume scraping.'
          : `Supabase calls the app ${describeSchedule(settings)}, and it scrapes when a run is due.`}
        {cron.lastAt && !cron.lastError && ` Last call ${formatTime(cron.lastAt)}: ${lastAnswer(cron)}.`}
      </p>
      <p className="muted small">
        The job (UTC, so an hour wider where clocks change): <code className="inline-code">{cron.schedule}</code> →{' '}
        <code className="inline-code">{cron.url}</code>
      </p>
      {problem && <p className="small warn">{problem}</p>}
      <div className="button-row">
        {problem && connect('Reconnect')}
        <button
          type="button"
          className="secondary"
          disabled={act.busy}
          onClick={() =>
            confirm('Stop Supabase Cron? Nothing will scrape on its own until you connect it again.') &&
            act.run(cronDisconnectAction)
          }
        >
          Disconnect
        </button>
      </div>
      <Feedback state={act.state} />
    </div>
  );
}

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
  const edit = (patch: Partial<typeof form>) => {
    save.clear();
    setForm((current) => ({ ...current, ...patch }));
  };
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
    <section className="panel" aria-labelledby="filters-h">
      <h2 id="filters-h">Filters</h2>
      <form onSubmit={submit} className="form-stack">
        <label className="field">
          <span>Keywords</span>
          <input {...text('keywords')} placeholder="React, Next.js" />
          <small>
            Searched on every board (<code className="inline-code">{'{keyword}'}</code> in a scraper’s link) and, where
            a scraper checks it, required in the offer’s title or skills. A keyword starts a word: “react” matches
            ReactJS, not Preact.
          </small>
        </label>
        <label className="field">
          <span>Cities</span>
          <input {...text('cities')} placeholder="warszaw, warsaw" />
          <small>
            Part of a name is enough: “warszaw” matches Warszawa and Warszawie. Empty = anywhere. Offers that don’t say
            where pass.
          </small>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.remoteOk}
            onChange={(event) => edit({ remoteOk: event.target.checked })}
          />{' '}
          Remote offers are fine wherever they are
        </label>
        <label className="field">
          <span>Skip titles with</span>
          <input {...text('ignore')} placeholder="PHP, Angular" />
          <small>Not saved at all.</small>
        </label>
        <label className="field">
          <span>Save, but don’t send to Telegram</span>
          <input {...text('mute')} />
          <small>Whole words: “java” doesn’t hit JavaScript, “.net” also hits ASP.NET.</small>
        </label>
        <div className="button-row">
          <button type="submit" disabled={save.busy || !dirty} aria-busy={save.busy || undefined}>
            {save.busy ? 'Saving…' : 'Save filters'}
          </button>
          <Feedback state={save.state} />
        </div>
      </form>
    </section>
  );
}
