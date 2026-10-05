import { Code } from '@/components/field';

/** The Telegram panel's help: setting the bot up, and the chat's commands. */
export function TelegramHelp() {
  return (
    <>
      <p>
        <strong>Setting it up:</strong> set <Code>TELEGRAM_BOT_TOKEN</Code> and <Code>TELEGRAM_CHAT_ID</Code> in Vercel
        → Settings → Environment Variables and redeploy. The token: @BotFather → /mybots → your bot → API Token. The
        chat id: write to the bot, open <Code>api.telegram.org/bot&lt;token&gt;/getUpdates</Code> and copy{' '}
        <Code>message.chat.id</Code> (a group’s starts with -).
      </p>
      <p>
        <strong>Send to Telegram:</strong> off stops the messages about new offers and the answers to commands (they’re
        ignored), without removing the bot, its webhook or the variables. Push notifications go on.
      </p>
      <p>
        <strong>Messages:</strong> one per run, with a block per board (what doesn’t fit is counted, with a link to the
        app). Sending, mute and the AI filter are in the Notifications panel above: they apply to push notifications
        too.
      </p>
      <p>
        <strong>Commands:</strong> /mute, /resume, /send (what waits), /scrape (a run now) and /status, from your chat
        only. Mute and /send hold and send for every channel. They reach the app once “Connect commands” has set the
        bot’s webhook to it. A bot gets commands either by webhook or by polling, not both: nothing else may be reading
        this bot’s updates.
      </p>
    </>
  );
}
