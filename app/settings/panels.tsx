'use client';

import { useActionState, useState, useTransition } from 'react';
import { formatDateTime, formatTime } from '@/lib/dates';
import { INTERVALS, type ScrapeSettings } from '@/lib/scraping/kinds';
import type { CronStatus, RunRow, ScrapeState } from '@/lib/scraping/store';
import type { BotInfo } from '@/lib/telegram';
import {
  cronConnectAction, cronDisconnectAction, saveFiltersAction, saveScheduleAction, sendQueueAction, setMutedAction,
  setNotifyAction, telegramConnectAction, telegramDisconnectAction, telegramTestAction, type ActionState,
} from './actions';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A button-driven action with its own busy state and answer. */
export function useAction() {
  const [busy, start] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      setState(null);
      try {
        setState(await fn());
      } catch (e) {
        setState({ error: message(e) });
      }
    });
  return { busy, state, run };
}

export function Feedback({ state }: { state: ActionState | null | undefined }) {
  if (state?.error) return <p className="form-error" role="alert">{state.error}</p>;
  if (state?.message) return <p className="form-ok" role="status">{state.message}</p>;
  return null;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

// ---- schedule + what calls the endpoint --------------------------------------------------

export function SchedulePanel({ settings, state, running, runs, cron, endpoint, secret }: {
  settings: ScrapeSettings;
  state: ScrapeState;
  running: boolean;
  runs: RunRow[];
  cron: CronStatus & { error?: string };
  endpoint: string;
  secret: string | null;
}) {
  const [saved, save, saving] = useActionState<ActionState, FormData>(saveScheduleAction, {});
  const act = useAction();
  const [showSecret, setShowSecret] = useState(false);

  return (
    <section className="panel" aria-labelledby="schedule-h">
      <h2 id="schedule-h">Scraping</h2>
      <form action={save} className="form-line">
        <label className="check">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> On a schedule
        </label>
        <label className="inline">
          every
          <select name="everyMinutes" defaultValue={settings.everyMinutes}>
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          from
          <input className="hour" type="number" name="fromHour" min={0} max={24} defaultValue={settings.fromHour} />
          to
          <input className="hour" type="number" name="toHour" min={0} max={24} defaultValue={settings.toHour} />
          <span className="muted">o’clock, Warsaw time</span>
        </label>
        <button type="submit" disabled={saving} aria-busy={saving || undefined}>
          Save
        </button>
        <Feedback state={saved} />
      </form>

      <h3>Last runs</h3>
      {running && <p className="muted small">● A run is going right now.</p>}
      {runs.length ? (
        <ol className="runs">
          {runs.map((r) => (
            <li key={r.id}>
              <span className="run-time">{formatDateTime(r.started_at)}</span>
              <span className="muted">{r.trigger}</span>
              {r.finished_at ? (
                <span>
                  {seconds(Date.parse(r.finished_at) - Date.parse(r.started_at))} · {r.found} on the pages · {r.kept} kept ·{' '}
                  <strong>{r.added} new</strong>
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
      {state.last_call_at && <p className="muted small">Last call from a scheduler: {formatDateTime(state.last_call_at)}</p>}

      <h3>What calls it</h3>
      <CronBox cron={cron} endpoint={endpoint} act={act} />
      <details className="endpoint">
        <summary>Another caller (Node-RED, cron-job.org, Vercel Cron on Pro)</summary>
        <p>
          Every 5 minutes: <code>GET {endpoint}</code> with the header{' '}
          <code>Authorization: Bearer {secret ? (showSecret ? secret : '••••••••') : '(set APP_PASSWORD first)'}</code>
          {secret && (
            <button type="button" className="link" onClick={() => setShowSecret((v) => !v)}>
              {showSecret ? 'hide' : 'show'}
            </button>
          )}
        </p>
        <p className="muted small">
          It scrapes only when due (the interval and hours above) and answers right away. <code className="inline">?force=1</code> runs anyway,{' '}
          <code className="inline">?wait=1</code> waits and answers with the result.
        </p>
      </details>
    </section>
  );
}

function CronBox({ cron, endpoint, act }: { cron: CronStatus & { error?: string }; endpoint: string; act: ReturnType<typeof useAction> }) {
  const connect = (
    <button type="button" onClick={() => act.run(cronConnectAction)} disabled={act.busy} aria-busy={act.busy || undefined}>
      {cron.scheduled ? 'Reconnect' : 'Connect Supabase Cron'}
    </button>
  );
  return (
    <div className="cron-box">
      {!cron.available ? (
        <p className="small">
          Supabase Cron isn’t enabled in the database{cron.error ? ` (${cron.error})` : ''}. Run <code className="inline">scripts/db-migrate.sh</code>{' '}
          (it turns on pg_cron and pg_net), or enable Cron under Integrations in Supabase.
        </p>
      ) : cron.scheduled ? (
        <>
          <p className="small">
            <span className="ok-text">✓ Supabase Cron</span> calls <code className="inline">{cron.url}</code> {cron.schedule === '*/5 * * * *' ? 'every 5 minutes' : `on ${cron.schedule}`}
            {cron.active === false && <strong className="warn"> (paused in Supabase)</strong>}.
            {cron.lastAt && (
              <>
                {' '}Last answer: {cron.lastError ? <span className="warn">{cron.lastError}</span> : `HTTP ${cron.lastStatus}`} at {formatTime(cron.lastAt)}.
              </>
            )}
          </p>
          {cron.url && cron.url !== endpoint && <p className="small warn">It calls another address than this app’s ({endpoint}). Reconnect to fix.</p>}
          <div className="button-row">
            {connect}
            <button type="button" className="secondary" onClick={() => act.run(cronDisconnectAction)} disabled={act.busy}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">Not connected. Supabase will call {endpoint} every 5 minutes; the app decides whether a run is due.</p>
          <div className="button-row">{connect}</div>
        </>
      )}
      <Feedback state={act.state} />
    </div>
  );
}

// ---- filters ------------------------------------------------------------------------------

export function FiltersPanel({ settings }: { settings: ScrapeSettings }) {
  const [saved, save, saving] = useActionState<ActionState, FormData>(saveFiltersAction, {});
  const join = (xs: string[]) => xs.join(', ');
  return (
    <section className="panel" aria-labelledby="filters-h">
      <h2 id="filters-h">Filters</h2>
      <form action={save} className="form-stack">
        <label className="field">
          <span>Keywords</span>
          <input name="keywords" defaultValue={join(settings.keywords)} placeholder="React, Next.js" />
          <small>
            Searched on every board (<code className="inline">{'{keyword}'}</code> in a scraper’s link) and, where a scraper checks it, required in the
            offer’s title or skills. A keyword starts a word: “react” matches ReactJS, not Preact.
          </small>
        </label>
        <label className="field">
          <span>Cities</span>
          <input name="cities" defaultValue={join(settings.cities)} placeholder="warszaw, warsaw" />
          <small>Part of a name is enough: “warszaw” matches Warszawa and Warszawie. Empty = anywhere. Offers that don’t say where pass.</small>
        </label>
        <label className="check">
          <input type="checkbox" name="remoteOk" defaultChecked={settings.remoteOk} /> Remote offers are fine wherever they are
        </label>
        <label className="field">
          <span>Skip titles with</span>
          <input name="ignore" defaultValue={join(settings.ignore)} placeholder="PHP, Angular" />
          <small>Not saved at all.</small>
        </label>
        <label className="field">
          <span>Save, but don’t send to Telegram</span>
          <input name="mute" defaultValue={join(settings.mute)} />
          <small>Whole words: “java” doesn’t hit JavaScript, “.net” also hits ASP.NET.</small>
        </label>
        <div className="button-row">
          <button type="submit" disabled={saving} aria-busy={saving || undefined}>
            Save filters
          </button>
          <Feedback state={saved} />
        </div>
      </form>
    </section>
  );
}

// ---- Telegram -----------------------------------------------------------------------------

export function TelegramPanel({ ready, bot, notify, muted, queued, webhookUrl }: {
  ready: boolean;
  bot: (BotInfo & { error?: undefined }) | { error: string } | null;
  notify: boolean;
  muted: boolean;
  queued: number;
  webhookUrl: string;
}) {
  const act = useAction();
  if (!ready) {
    return (
      <section className="panel" aria-labelledby="tg-h">
        <h2 id="tg-h">Telegram</h2>
        <p className="small">
          Set <code className="inline">TELEGRAM_BOT_TOKEN</code> and <code className="inline">TELEGRAM_CHAT_ID</code> in Vercel → Settings → Environment
          Variables and redeploy. The token: @BotFather → /mybots → your bot → API Token. The chat id: the <code className="inline">chatId</code> in
          Node-RED’s flush_queue node.
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
        {info ? <>Bot <strong>@{info.username}</strong></> : <span className="warn">Can’t reach the bot: {bot?.error}</span>}
      </p>
      <div className="form-line">
        <label className="check">
          <input type="checkbox" checked={notify} disabled={act.busy} onChange={(e) => act.run(() => setNotifyAction(e.target.checked))} /> Send new
          offers
        </label>
        <span className="small">{muted ? `🔕 Muted, ${queued} waiting` : queued ? `🔔 On, ${queued} waiting` : '🔔 On'}</span>
        <button type="button" className="secondary" disabled={act.busy} onClick={() => act.run(() => setMutedAction(!muted))}>
          {muted ? 'Unmute and send' : 'Mute'}
        </button>
        {queued > 0 && (
          <button type="button" className="secondary" disabled={act.busy} onClick={() => act.run(sendQueueAction)}>
            Send the {queued} now
          </button>
        )}
        <button type="button" className="secondary" disabled={act.busy} onClick={() => act.run(telegramTestAction)}>
          Test message
        </button>
      </div>
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
        <button type="button" className={hooked ? 'secondary' : undefined} disabled={act.busy} onClick={() => act.run(telegramConnectAction)}>
          {hooked ? 'Reconnect commands' : 'Connect commands'}
        </button>
        {info?.webhook && (
          <button type="button" className="secondary" disabled={act.busy} onClick={() => act.run(telegramDisconnectAction)}>
            Disconnect
          </button>
        )}
      </div>
      {!hooked && <p className="muted small">Stop Node-RED’s Telegram receiver first: a bot gets commands either by webhook or by polling, not both.</p>}
      <Feedback state={act.state} />
    </section>
  );
}
