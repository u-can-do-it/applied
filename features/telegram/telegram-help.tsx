import { Code } from '@/components/field';

/** The Telegram panel's help: setting the bot up, the AI filter, and the chat's commands. */
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
        <strong>Mute</strong> keeps new offers in a queue instead of sending them; unmuting sends what waited.
      </p>
      <p>
        <strong>Only offers the AI profile matches:</strong> every new offer is checked right after scraping, as the AI
        tab would (also the ones that aren’t sent, like a new scraper’s first run). The message lists the matches with
        their fit; if none match, it just says how many new offers there are. One the AI can’t check for 20 minutes is
        sent anyway, marked. Without <Code>OPENAI_API_KEY</Code> or an AI profile, every new offer is sent.
      </p>
      <p>
        <strong>Commands:</strong> /mute, /resume, /send (what waits), /scrape (a run now) and /status, from your chat
        only. They reach the app once “Connect commands” has set the bot’s webhook to it. A bot gets commands either by
        webhook or by polling, not both: nothing else may be reading this bot’s updates.
      </p>
    </>
  );
}
