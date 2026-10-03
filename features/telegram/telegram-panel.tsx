'use client';

import { useOptimistic } from 'react';
import { BellIcon, BellOffIcon, CheckIcon, SparklesIcon } from 'lucide-react';
import { CheckField, Code } from '@/components/field';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { BotInfo } from '@/lib/telegram';
import { cn } from '@/lib/shared/cn';
import { PANEL, SMALL } from '@/features/scraping/panel-styles';
import {
  sendQueueAction,
  setAiFilterAction,
  setMutedAction,
  setNotifyAction,
  telegramConnectAction,
  telegramDisconnectAction,
  telegramTestAction,
} from './actions';

// The Telegram panel in Settings. Its buttons behave like the other panels' (features/scraping/use-server-form.ts).

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Card className={PANEL} role="region" aria-labelledby="tg-h">
      <CardHeader className="px-4">
        <h2 id="tg-h" className="m-0 text-base font-semibold">
          Telegram
        </h2>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

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
      <Panel>
        <p className={SMALL}>
          Set <Code>TELEGRAM_BOT_TOKEN</Code> and <Code>TELEGRAM_CHAT_ID</Code> in Vercel → Settings → Environment
          Variables and redeploy. The token: @BotFather → /mybots → your bot → API Token. The chat id: write to the bot,
          open <Code>api.telegram.org/bot&lt;token&gt;/getUpdates</Code> and copy <Code>message.chat.id</Code> (a
          group’s starts with -).
        </p>
      </Panel>
    );
  }
  const info = bot && !bot.error ? (bot as BotInfo) : null;
  const hooked = info?.webhook === webhookUrl;
  return (
    <Panel>
      <p className={SMALL}>
        {info ? (
          <>
            Bot <strong>@{info.username}</strong>
          </>
        ) : (
          <span className="text-warning">Can’t reach the bot: {bot?.error}</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm">
        <CheckField>
          <Switch
            checked={view.notify}
            onCheckedChange={(on) => {
              act.run(
                () => setNotifyAction({ on }),
                () => show({ notify: on }),
              );
            }}
          />
          Send new offers
        </CheckField>
        <span className="text-xs">
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
        <Button
          type="button"
          variant="outline"
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
        </Button>
        {view.queued > 0 && (
          <Button
            type="button"
            variant="outline"
            aria-busy={act.busy || undefined}
            onClick={() => act.run(sendQueueAction, () => show({ queued: 0 }))}
          >
            Send the {view.queued} now
          </Button>
        )}
        <Button type="button" variant="outline" disabled={act.busy} onClick={() => act.run(telegramTestAction)}>
          Test message
        </Button>
      </div>
      <CheckField className="mt-2.5">
        <Switch
          checked={view.aiOn}
          onCheckedChange={(on) => {
            act.run(
              () => setAiFilterAction({ on }),
              () => show({ aiOn: on }),
            );
          }}
        />
        <span>
          <SparklesIcon /> Only offers the AI profile matches{ai.profile ? ` (“${ai.profile}”)` : ''}
        </span>
      </CheckField>
      <p className="mt-0.5 mb-2 ml-10 text-xs text-muted-foreground">
        {!view.aiOn
          ? 'Off: every new offer is sent.'
          : !ai.keySet
            ? 'Set OPENAI_API_KEY to use it: until then every new offer is sent.'
            : !ai.profile
              ? 'No AI profile yet (AI filter tab → Profile): until then every new offer is sent.'
              : 'Every new offer is checked right after scraping (as the AI tab would; also the ones that aren’t sent, like a new scraper’s first run). The message lists the matches with their fit; if none match, it just says how many new offers there are. One the AI can’t check for 20 minutes is sent anyway, marked.'}
      </p>
      <p className={SMALL}>
        Commands in the chat (/mute, /resume, /send, /scrape, /status):{' '}
        {hooked ? (
          <span className="text-success">
            <CheckIcon /> connected
          </span>
        ) : info?.webhook ? (
          <span className="text-warning">the bot sends them to {info.webhook}</span>
        ) : (
          'not connected'
        )}
        {info?.webhookError && <span className="text-warning"> · last error: {info.webhookError}</span>}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={hooked ? 'outline' : 'default'}
          disabled={act.busy}
          onClick={() => act.run(telegramConnectAction)}
        >
          {act.busy ? 'Working…' : hooked ? 'Reconnect commands' : 'Connect commands'}
        </Button>
        {info?.webhook && (
          <Button type="button" variant="outline" disabled={act.busy} onClick={() => act.run(telegramDisconnectAction)}>
            Disconnect
          </Button>
        )}
      </div>
      {!hooked && (
        <p className={cn(SMALL, 'text-muted-foreground')}>
          A bot gets commands either by webhook or by polling, not both: nothing else may be reading this bot’s updates.
        </p>
      )}
      <ActionError error={act.error} />
    </Panel>
  );
}
