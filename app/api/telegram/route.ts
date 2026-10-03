import { after, NextResponse, type NextRequest } from 'next/server';
import { sameString } from '@/lib/hmac';
import { zoneOf } from '@/lib/dates';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as offersRepo from '@/lib/db/repos/offers';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { env } from '@/lib/env';
import { listProfiles } from '@/lib/ai/profiles';
import { message } from '@/lib/shared/errors';
import { notify } from '@/lib/listings/pipeline/notify';
import { runAll } from '@/lib/listings/run';
import { effectiveTimeZone } from '@/lib/listings/settings';
import { ownerChat, sendMessage, telegramReady, webhookSecret } from '@/lib/telegram';

// Telegram webhook: the bot's commands. Connected from Settings; Telegram sends the secret
// back in a header, and only your own chat (TELEGRAM_CHAT_ID) may give commands.
export const maxDuration = 300;

const HELP =
  '/mute - hold notifications\n/send - deliver what is queued\n/resume - unmute and deliver\n/scrape - scrape now\n/status - show state';

export async function POST(request: NextRequest) {
  if (!telegramReady()) return NextResponse.json({ ok: false }, { status: 503 });
  if (!sameString(request.headers.get('x-telegram-bot-api-secret-token') ?? '', await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await request.json().catch(() => null)) as {
    message?: { chat?: { id?: number }; text?: unknown };
  } | null;
  const chatId = String(update?.message?.chat?.id ?? '');
  const sent = update?.message?.text;
  const text = (typeof sent === 'string' ? sent : '').trim().toLowerCase();
  // ignore everyone else: the bot's username is guessable. Always 200, or Telegram retries.
  if (!text || chatId !== ownerChat()) return NextResponse.json({ ok: true });

  const reply = (answer: string) => sendMessage(answer, chatId);
  const cmd = text.split(/\s+/)[0].replace(/@\w+$/, ''); // "/status@my_bot" in groups
  const queued = () => queueRepo.size();
  // what waited goes out after the AI check (that can take a while, so after the answer)
  const deliver = () =>
    after(async () => {
      const result = await notify({ manual: true }).catch((failure: unknown) => ({ error: message(failure) }));
      if (result.error) await reply(`⚠️ ${result.error}`);
    });

  if (['/mute', '/pause', '/stop'].includes(cmd)) {
    const was = (await stateRepo.get()).muted;
    await stateRepo.setMuted(true);
    const waiting = await queued();
    await reply(
      was
        ? `🔕 Already muted. ${waiting} offer(s) waiting.`
        : `🔕 Muted.\nScraping continues - new offers are queued.\n${waiting} waiting.`,
    );
  } else if (['/resume', '/unmute', '/start'].includes(cmd)) {
    const was = (await stateRepo.get()).muted;
    await stateRepo.setMuted(false);
    const waiting = await queued();
    const heading = was ? '🔔 Unmuted.' : '🔔 Already active.';
    await reply(waiting ? `${heading}\nDelivering ${waiting} queued offer(s)...` : `${heading}\nNothing queued.`);
    if (waiting) deliver();
  } else if (['/send', '/flush'].includes(cmd)) {
    const waiting = await queued();
    if (!waiting) await reply('📭 Nothing queued.');
    else {
      await reply(`📤 Sending ${waiting} queued offer(s)...`);
      deliver();
    }
  } else if (['/scrape', '/run'].includes(cmd)) {
    await reply('🔎 Scraping…');
    after(async () => {
      const result = await runAll('telegram');
      const errors = result.errors.map((failure) => `\n⚠️ ${failure.scraper}: ${failure.error}`).join('');
      await reply(
        result.skipped
          ? `⏳ ${result.skipped}`
          : `✅ ${result.found} on the pages, ${result.added} new saved, ${result.notified} sent${errors}`,
      );
    });
  } else if (cmd === '/status') {
    const [state, waiting, counts, runs, settings, profiles] = await Promise.all([
      stateRepo.get(),
      queued(),
      offersRepo.countPerBoard(),
      runsRepo.list(1),
      settingsRepo.get(),
      listProfiles(),
    ]);
    const total = Object.values(counts).reduce((sum, boardCount) => sum + boardCount.offers, 0);
    const per = Object.keys(counts)
      .sort()
      .map((src) => `  ${src}: ${counts[src].offers}`);
    const zone = zoneOf(effectiveTimeZone(settings));
    const last = runs[0]
      ? `${zone.formatDateTime(runs[0].startedAt)} (${runs[0].trigger}, ${runs[0].added} new)`
      : 'unknown';
    const ai = !settings.aiFilter
      ? 'off'
      : !env.OPENAI_API_KEY
        ? 'on, but no OPENAI_API_KEY (all sent)'
        : profiles[0]
          ? `“${profiles[0].name}”`
          : 'on, but no profile (all sent)';
    const scraping = settings.enabled
      ? `every ${settings.everyMinutes} min, ${settings.fromHour}–${settings.toHour} (${zone.tz})`
      : '⏸ paused';
    await reply(
      `${state.muted ? '🔕 muted' : '🔔 active'}\n${waiting} queued\n🔎 scraping: ${scraping}\n✦ AI filter: ${ai}\n${total} offers stored\n${per.join('\n')}\n\nlast run: ${last}`,
    );
  } else {
    await reply(`❓ Unknown command "${text.slice(0, 50)}"\n\n${HELP}`);
  }
  return NextResponse.json({ ok: true });
}
