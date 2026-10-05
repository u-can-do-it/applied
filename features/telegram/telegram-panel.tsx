'use client';

import { useOptimistic } from 'react';
import { CheckIcon } from 'lucide-react';
import { CheckField, Code } from '@/components/field';
import { PanelHeading } from '@/components/help';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { BotInfo } from '@/lib/telegram';
import { BUTTONS, PANEL, SMALL } from '@/features/scraping/panel-styles';
import {
  setTelegramEnabledAction,
  telegramConnectAction,
  telegramDisconnectAction,
  telegramTestAction,
} from './actions';
import { TelegramHelp } from './telegram-help';

// The Telegram panel in Settings: Telegram on or off, the bot, a test message and its commands. Sending,
// mute, the queue and the AI filter apply to every channel: they're in the Notifications panel. The
// switch shows its new value at once (useOptimistic); what went wrong shows next to the buttons (useAction).
// Off keeps the bot and its webhook: it only stops the messages and the commands' answers.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Card className={PANEL} role="region" aria-labelledby="tg-h">
      <CardHeader className="px-4">
        <PanelHeading id="tg-h" title="Telegram" help={<TelegramHelp />} />
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

export function TelegramPanel({
  ready,
  enabled,
  bot,
  webhookUrl,
}: {
  ready: boolean;
  /** "Send to Telegram" (settings.telegramEnabled) */
  enabled: boolean;
  bot: (BotInfo & { error?: undefined }) | { error: string } | null;
  webhookUrl: string;
}) {
  const act = useAction();
  // the switch saves on its own: a slow button doesn't hold it, and it waits for its own save
  const toggle = useAction();
  // the switch right away; the refreshed page brings the real value
  const [on, show] = useOptimistic(enabled, (_, next: boolean) => next);
  if (!ready) {
    return (
      <Panel>
        <p className={SMALL}>
          <span className="text-warning">Not set up</span>: set <Code>TELEGRAM_BOT_TOKEN</Code> and{' '}
          <Code>TELEGRAM_CHAT_ID</Code> (the <q>?</q> above says how).
        </p>
      </Panel>
    );
  }
  const info = bot && !bot.error ? (bot as BotInfo) : null;
  const hooked = info?.webhook === webhookUrl;
  return (
    <Panel>
      <CheckField>
        <Switch
          checked={on}
          disabled={toggle.busy}
          onCheckedChange={(next) => {
            toggle.run(
              () => setTelegramEnabledAction({ on: next }),
              () => show(next),
            );
          }}
        />
        Send to Telegram
      </CheckField>
      <p className="mt-0.5 mb-2 ml-10 text-xs text-muted-foreground">
        {on
          ? 'On: new offers go to the chat, and it answers commands.'
          : 'Off: no messages, and commands get no answer. The bot and its webhook stay as they are.'}
      </p>
      <ActionError error={toggle.error} className="mb-2" />
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <p className={SMALL}>
          {info ? (
            <>
              Bot <strong>@{info.username}</strong>
            </>
          ) : (
            <span className="text-warning">Can’t reach the bot: {bot?.error}</span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={act.busy || !on}
          aria-describedby={on ? undefined : 'tg-test-off'}
          onClick={() => act.run(telegramTestAction)}
        >
          Test message
        </Button>
        {!on && (
          <span id="tg-test-off" className="text-xs text-muted-foreground">
            Switch Telegram on to send one.
          </span>
        )}
      </div>
      <p className={SMALL}>
        Commands in the chat:{' '}
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
      <div className={BUTTONS}>
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
      <ActionError error={act.error} />
    </Panel>
  );
}
