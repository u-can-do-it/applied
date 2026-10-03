'use client';

import { useOptimistic } from 'react';
import { BellIcon, BellOffIcon, CheckIcon, SparklesIcon } from 'lucide-react';
import { Feedback, useAction } from '@/components/use-action';
import type { BotInfo } from '@/lib/telegram';
import {
  sendQueueAction,
  setAiFilterAction,
  setMutedAction,
  setNotifyAction,
  telegramConnectAction,
  telegramDisconnectAction,
  telegramTestAction,
} from './actions';

// The Telegram panel in Settings. Its buttons behave like the other panels' (features/scraping/panels.tsx).

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
          Set <code className="inline-code">TELEGRAM_BOT_TOKEN</code> and{' '}
          <code className="inline-code">TELEGRAM_CHAT_ID</code> in Vercel → Settings → Environment Variables and
          redeploy. The token: @BotFather → /mybots → your bot → API Token. The chat id: write to the bot, open{' '}
          <code className="inline-code">api.telegram.org/bot&lt;token&gt;/getUpdates</code> and copy{' '}
          <code className="inline-code">message.chat.id</code> (a group’s starts with -).
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
            onChange={(event) => {
              const on = event.target.checked;
              act.run(
                () => setNotifyAction({ on }),
                () => show({ notify: on }),
              );
            }}
          />{' '}
          Send new offers
        </label>
        <span className="small">
          {view.muted ? (
            <>
              <BellOffIcon /> Muted, {view.queued} waiting
            </>
          ) : (
            <>
              <BellIcon /> On{view.queued ? `, ${view.queued} waiting` : ''}
            </>
          )}
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
          onChange={(event) => {
            const on = event.target.checked;
            act.run(
              () => setAiFilterAction({ on }),
              () => show({ aiOn: on }),
            );
          }}
        />{' '}
        <SparklesIcon /> Only offers the AI profile matches{ai.profile ? ` (“${ai.profile}”)` : ''}
      </label>
      <p className="muted small field-note-under">
        {!view.aiOn
          ? 'Off: every new offer is sent.'
          : !ai.keySet
            ? 'Set OPENAI_API_KEY to use it: until then every new offer is sent.'
            : !ai.profile
              ? 'No AI profile yet (AI filter tab → Profile): until then every new offer is sent.'
              : 'Every new offer is checked right after scraping (as the AI tab would; also the ones that aren’t sent, like a new scraper’s first run). The message lists the matches with their fit; if none match, it just says how many new offers there are. One the AI can’t check for 20 minutes is sent anyway, marked.'}
      </p>
      <p className="small">
        Commands in the chat (/mute, /resume, /send, /scrape, /status):{' '}
        {hooked ? (
          <span className="ok-text">
            <CheckIcon /> connected
          </span>
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
