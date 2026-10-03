'use client';

import {
  startTransition,
  useMemo,
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
  type SubmitEvent,
} from 'react';
import { deviceTimeZone, timeZones } from '@/lib/dates';
import { cronSchedule, describeSchedule } from '@/lib/scraping/cron';
import { INTERVALS, normalizeList, type ScrapeSettings } from '@/lib/scraping/kinds';
import type { CronStatus } from '@/lib/db/repos/cron';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';
import type { ScrapeState } from '@/lib/db/repos/scrape-state';
import { message } from '@/lib/shared/errors';
import { seconds } from '@/lib/shared/format';
import { fail, type Result } from '@/lib/shared/result';
import type { BotInfo } from '@/lib/telegram';
import { useZone } from '../time-zone';
import {
  cronConnectAction,
  cronDisconnectAction,
  saveFiltersAction,
  saveScheduleAction,
  sendQueueAction,
  setAiFilterAction,
  setMutedAction,
  setNotifyAction,
  setScrapingPausedAction,
  setTimeZoneAction,
  telegramConnectAction,
  telegramDisconnectAction,
  telegramTestAction,
} from './actions';

// How every change here behaves (the Next.js "interactive apps" patterns):
// - toggles show the new value at once (useOptimistic) until the refreshed page has it;
// - forms keep what you typed (controlled, no automatic form reset) and take the server's values
//   only where you haven't typed since;
// - answers ("Saved.") and closing a dialog are wrapped in startTransition after the await, so
//   they land in the same frame as the refreshed data instead of a moment before it.

/** What an action answers here: a message to show ("Saved."), or anything else (not shown). */
type Answer = Result<unknown>;

/**
 * Runs an action from a button or a form: busy state, an optimistic update to show right away, and
 * its answer, which shows with the refreshed page.
 */
export function useAction() {
  const [busy, start] = useTransition();
  const [state, setState] = useState<Answer | null>(null);
  const run = (fn: () => Promise<Answer>, optimistic?: () => void) => {
    setState(null);
    start(async () => {
      optimistic?.();
      const answer = await fn().catch((e: unknown) => fail(message(e)));
      startTransition(() => setState(answer));
    });
  };
  return { busy, state, run, clear: () => setState(null) };
}

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

export function Feedback({ state }: { state: Result<unknown> | null | undefined }) {
  if (state?.ok === false)
    return (
      <p className="form-error" role="alert">
        {state.error}
      </p>
    );
  if (typeof state?.data === 'string' && state.data)
    return (
      <p className="form-ok" role="status">
        {state.data}
      </p>
    );
  return null;
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
    setForm((f) => ({ ...f, ...patch }));
  };
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    save.run(() => saveScheduleAction({ ...form, fromHour: Number(form.fromHour), toHour: Number(form.toHour) }));
  };
  const act = useAction();
  const pause = useAction();
  const [paused, showPaused] = useOptimistic(!settings.enabled);
  const z = useZone();

  return (
    <section className="panel" aria-labelledby="schedule-h">
      <h2 id="schedule-h">Scraping</h2>
      <div className={`pause-row${paused ? ' is-paused' : ''}`}>
        <p className="small">
          {paused ? (
            <>
              <strong className="warn">⏸ Paused</strong>: nothing scrapes on its own; “↻ Scrape now” still works.
            </>
          ) : (
            <>
              <strong className="ok-text">● Running</strong>: every{' '}
              {settings.everyMinutes < 60 ? `${settings.everyMinutes} min` : `${settings.everyMinutes / 60} h`},{' '}
              {settings.fromHour}:00–{settings.toHour}:00 ({zoneName(z.tz)}).
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
          {paused ? '▶ Resume scraping' : '⏸ Pause scraping'}
        </button>
        <Feedback state={pause.state} />
      </div>
      <form onSubmit={submit} className="form-line">
        <label className="inline">
          every
          <select value={form.everyMinutes} onChange={(e) => edit({ everyMinutes: Number(e.target.value) })}>
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          from
          <input
            className="hour"
            type="number"
            min={0}
            max={24}
            value={form.fromHour}
            onChange={(e) => edit({ fromHour: e.target.value })}
          />
          to
          <input
            className="hour"
            type="number"
            min={0}
            max={24}
            value={form.toHour}
            onChange={(e) => edit({ toHour: e.target.value })}
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
      {running && <p className="muted small">● A run is going right now.</p>}
      {runs.length ? (
        <ol className="runs">
          {runs.map((r) => (
            <li key={r.id}>
              <span className="run-time">{z.formatDateTime(r.startedAt)}</span>
              <span className="muted">{r.trigger}</span>
              {r.finishedAt ? (
                <span>
                  {seconds(Date.parse(r.finishedAt) - Date.parse(r.startedAt))} · {r.found} on the pages · {r.kept} kept
                  · <strong>{r.added} new</strong>
                  {r.matched !== null && ` · ✦ ${r.matched} matched`}
                  {r.notified ? ` · ${r.notified} sent` : ''}
                </span>
              ) : (
                <span className="muted">unfinished</span>
              )}
              {r.errors.map((e, i) => (
                <span key={i} className="run-error">
                  {e.scraper}: {e.error}
                </span>
              ))}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No runs yet. Use “↻ Scrape now” at the top.</p>
      )}
      {state.lastCallAt && (
        <p className="muted small">Last call from a scheduler: {z.formatDateTime(state.lastCallAt)}</p>
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
      <label className="inline">
        Time zone
        <select
          value={shown}
          aria-busy={save.busy || undefined}
          onChange={(e) => {
            const next = e.target.value;
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
          <code className="inline">npm run db:migrate</code> (it turns on pg_cron and pg_net), or enable Cron under
          Integrations in Supabase.
        </p>
      </div>
    );
  }
  if (!cron.scheduled) {
    return (
      <div className="cron-box">
        <p className="small">
          <span className="status-off">○ Not connected</span>: nothing scrapes on its own, only “↻ Scrape now”.
          Connecting makes Supabase call the app {describeSchedule(settings)}; the app decides whether a run is due.
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
          <span className="warn">● Connected, with a problem</span>
        ) : paused ? (
          <span className="status-off">● Connected, paused</span>
        ) : (
          <span className="ok-text">● Connected</span>
        )}
        :{' '}
        {paused
          ? 'Supabase doesn’t call the app until you resume scraping.'
          : `Supabase calls the app ${describeSchedule(settings)}, and it scrapes when a run is due.`}
        {cron.lastAt && !cron.lastError && ` Last call ${formatTime(cron.lastAt)}: ${lastAnswer(cron)}.`}
      </p>
      <p className="muted small">
        The job (UTC, so an hour wider where clocks change): <code className="inline">{cron.schedule}</code> →{' '}
        <code className="inline">{cron.url}</code>
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
    setForm((f) => ({ ...f, ...patch }));
  };
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    // shown the way it's saved ("React,Vue " -> "React, Vue"), so it matches the refreshed page
    const normalized = { ...form };
    for (const k of LISTS) normalized[k] = join(normalizeList(form[k]));
    save.run(async () => {
      const answer = await saveFiltersAction(normalized);
      if (answer.ok) startTransition(() => setForm(normalized));
      return answer;
    });
  };
  const text = (k: (typeof LISTS)[number]) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => edit({ [k]: e.target.value }),
  });
  return (
    <section className="panel" aria-labelledby="filters-h">
      <h2 id="filters-h">Filters</h2>
      <form onSubmit={submit} className="form-stack">
        <label className="field">
          <span>Keywords</span>
          <input {...text('keywords')} placeholder="React, Next.js" />
          <small>
            Searched on every board (<code className="inline">{'{keyword}'}</code> in a scraper’s link) and, where a
            scraper checks it, required in the offer’s title or skills. A keyword starts a word: “react” matches
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
          <input type="checkbox" checked={form.remoteOk} onChange={(e) => edit({ remoteOk: e.target.checked })} />{' '}
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

// ---- Telegram -----------------------------------------------------------------------------

export function TelegramPanel({
  ready,
  bot,
  notify,
  muted,
  queued,
  ai,
  webhookUrl,
}: {
  ready: boolean;
  bot: (BotInfo & { error?: undefined }) | { error: string } | null;
  notify: boolean;
  muted: boolean;
  queued: number;
  /** the AI filter: on in settings, the active profile (if usable), whether OPENAI_API_KEY is set */
  ai: { on: boolean; profile: string | null; keySet: boolean };
  webhookUrl: string;
}) {
  const act = useAction();
  // what the buttons show right away; the refreshed page brings the real values
  type View = { notify: boolean; muted: boolean; queued: number; aiOn: boolean };
  const [view, show] = useOptimistic<View, Partial<View>>({ notify, muted, queued, aiOn: ai.on }, (cur, patch) => ({
    ...cur,
    ...patch,
  }));
  if (!ready) {
    return (
      <section className="panel" aria-labelledby="tg-h">
        <h2 id="tg-h">Telegram</h2>
        <p className="small">
          Set <code className="inline">TELEGRAM_BOT_TOKEN</code> and <code className="inline">TELEGRAM_CHAT_ID</code> in
          Vercel → Settings → Environment Variables and redeploy. The token: @BotFather → /mybots → your bot → API
          Token. The chat id: write to the bot, open{' '}
          <code className="inline">api.telegram.org/bot&lt;token&gt;/getUpdates</code> and copy{' '}
          <code className="inline">message.chat.id</code> (a group’s starts with -).
        </p>
      </section>
    );
  }
  const info = bot && !bot.error ? (bot as BotInfo) : null;
  const hooked = info?.webhook === webhookUrl;
  return (
    <section className="panel" aria-labelledby="tg-h">
      <h2 id="tg-h">Telegram</h2>
      <p className="small">
        {info ? (
          <>
            Bot <strong>@{info.username}</strong>
          </>
        ) : (
          <span className="warn">Can’t reach the bot: {bot?.error}</span>
        )}
      </p>
      <div className="form-line">
        <label className="check">
          <input
            type="checkbox"
            checked={view.notify}
            onChange={(e) => {
              const on = e.target.checked;
              act.run(
                () => setNotifyAction({ on }),
                () => show({ notify: on }),
              );
            }}
          />{' '}
          Send new offers
        </label>
        <span className="small">
          {view.muted ? `🔕 Muted, ${view.queued} waiting` : view.queued ? `🔔 On, ${view.queued} waiting` : '🔔 On'}
        </span>
        <button
          type="button"
          className="secondary"
          aria-busy={act.busy || undefined}
          onClick={() => {
            const mute = !view.muted;
            act.run(
              () => setMutedAction({ muted: mute }),
              () => show(mute ? { muted: true } : { muted: false, queued: 0 }),
            );
          }}
        >
          {view.muted ? 'Unmute and send' : 'Mute'}
        </button>
        {view.queued > 0 && (
          <button
            type="button"
            className="secondary"
            aria-busy={act.busy || undefined}
            onClick={() => act.run(sendQueueAction, () => show({ queued: 0 }))}
          >
            Send the {view.queued} now
          </button>
        )}
        <button type="button" className="secondary" disabled={act.busy} onClick={() => act.run(telegramTestAction)}>
          Test message
        </button>
      </div>
      <label className="check ai-filter">
        <input
          type="checkbox"
          checked={view.aiOn}
          onChange={(e) => {
            const on = e.target.checked;
            act.run(
              () => setAiFilterAction({ on }),
              () => show({ aiOn: on }),
            );
          }}
        />{' '}
        ✦ Only offers the AI profile matches{ai.profile ? ` (“${ai.profile}”)` : ''}
      </label>
      <p className="muted small field-note-under">
        {!view.aiOn
          ? 'Off: every new offer is sent.'
          : !ai.keySet
            ? 'Set OPENAI_API_KEY to use it: until then every new offer is sent.'
            : !ai.profile
              ? 'No AI profile yet (AI filter tab → ✦ Profile): until then every new offer is sent.'
              : 'Every new offer is checked right after scraping (as the AI tab would; also the ones that aren’t sent, like a new scraper’s first run). The message lists the matches with their fit; if none match, it just says how many new offers there are. One the AI can’t check for 20 minutes is sent anyway, marked.'}
      </p>
      <p className="small">
        Commands in the chat (/mute, /resume, /send, /scrape, /status):{' '}
        {hooked ? (
          <span className="ok-text">✓ connected</span>
        ) : info?.webhook ? (
          <span className="warn">the bot sends them to {info.webhook}</span>
        ) : (
          'not connected'
        )}
        {info?.webhookError && <span className="warn"> · last error: {info.webhookError}</span>}
      </p>
      <div className="button-row">
        <button
          type="button"
          className={hooked ? 'secondary' : undefined}
          disabled={act.busy}
          onClick={() => act.run(telegramConnectAction)}
        >
          {act.busy ? 'Working…' : hooked ? 'Reconnect commands' : 'Connect commands'}
        </button>
        {info?.webhook && (
          <button
            type="button"
            className="secondary"
            disabled={act.busy}
            onClick={() => act.run(telegramDisconnectAction)}
          >
            Disconnect
          </button>
        )}
      </div>
      {!hooked && (
        <p className="muted small">
          A bot gets commands either by webhook or by polling, not both: nothing else may be reading this bot’s updates.
        </p>
      )}
      <Feedback state={act.state} />
    </section>
  );
}
