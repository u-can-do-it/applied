'use client';

import { CheckIcon } from 'lucide-react';
import { Code } from '@/components/field';
import { PanelHeading } from '@/components/help';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { BotInfo } from '@/lib/telegram';
import { BUTTONS, PANEL, SMALL } from '@/features/scraping/panel-styles';
import { telegramConnectAction, telegramDisconnectAction, telegramTestAction } from './actions';
import { TelegramHelp } from './telegram-help';

// The Telegram panel in Settings: the bot, a test message and its commands. Sending, mute, the queue and
// the AI filter apply to every channel: they're in the Notifications panel. What went wrong shows next
// to the buttons (useAction).

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
  bot,
  webhookUrl,
}: {
  ready: boolean;
  bot: (BotInfo & { error?: undefined }) | { error: string } | null;
  webhookUrl: string;
}) {
  const act = useAction();
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
        <Button type="button" variant="outline" disabled={act.busy} onClick={() => act.run(telegramTestAction)}>
          Test message
        </Button>
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
