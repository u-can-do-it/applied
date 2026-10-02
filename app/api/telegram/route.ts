import { after, NextResponse, type NextRequest } from 'next/server';
import { sameString } from '@/lib/auth';
import { formatDateTime } from '@/lib/dates';
import { listProfiles } from '@/lib/profiles';
import { notify, runAll } from '@/lib/scraping/run';
import { getSettings, getState, listRuns, queueSize, setMuted, sourceCounts } from '@/lib/scraping/store';
import { ownerChat, sendMessage, telegramReady, webhookSecret } from '@/lib/telegram';

// Telegram webhook: Node-RED's tg_command. Connected from Settings; Telegram sends the secret
// back in a header, and only your own chat (TELEGRAM_CHAT_ID) may give commands.
export const maxDuration = 300;

const HELP =
  '/mute - hold notifications\n/send - deliver what is queued\n/resume - unmute and deliver\n/scrape - scrape now\n/status - show state';

export async function POST(request: NextRequest) {
  if (!telegramReady()) return NextResponse.json({ ok: false }, { status: 503 });
  if (!sameString(request.headers.get('x-telegram-bot-api-secret-token') ?? '', await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await request.json().catch(() => null)) as { message?: { chat?: { id?: number }; text?: string } } | null;
  const chatId = String(update?.message?.chat?.id ?? '');
  const text = String(update?.message?.text ?? '').trim().toLowerCase();
  // ignore everyone else: the bot's username is guessable. Always 200, or Telegram retries.
  if (!text || chatId !== ownerChat()) return NextResponse.json({ ok: true });

  const reply = (t: string) => sendMessage(t, chatId);
  const cmd = text.split(/\s+/)[0].replace(/@\w+$/, ''); // "/status@my_bot" in groups
  const queued = () => queueSize();
  // what waited goes out after the AI check (that can take a while, so after the answer)
  const deliver = () =>
    after(async () => {
      const r = await notify({ manual: true }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
      if (r.error) await reply(`⚠️ ${r.error}`);
    });

  if (['/mute', '/pause', '/stop'].includes(cmd)) {
    const was = (await getState()).muted;
    await setMuted(true);
    const n = await queued();
    await reply(was ? `🔕 Already muted. ${n} offer(s) waiting.` : `🔕 Muted.\nScraping continues - new offers are queued.\n${n} waiting.`);
  } else if (['/resume', '/unmute', '/start'].includes(cmd)) {
    const was = (await getState()).muted;
    await setMuted(false);
    const n = await queued();
    const t = was ? '🔔 Unmuted.' : '🔔 Already active.';
    await reply(n ? `${t}\nDelivering ${n} queued offer(s)...` : `${t}\nNothing queued.`);
    if (n) deliver();
  } else if (['/send', '/flush'].includes(cmd)) {
    const n = await queued();
    if (!n) await reply('📭 Nothing queued.');
    else {
      await reply(`📤 Sending ${n} queued offer(s)...`);
      deliver();
    }
  } else if (['/scrape', '/run'].includes(cmd)) {
    await reply('🔎 Scraping…');
    after(async () => {
      const r = await runAll('telegram');
      const errors = r.errors.map((e) => `\n⚠️ ${e.scraper}: ${e.error}`).join('');
      await reply(r.skipped ? `⏳ ${r.skipped}` : `✅ ${r.found} on the pages, ${r.added} new saved, ${r.notified} sent${errors}`);
    });
  } else if (cmd === '/status') {
    const [state, n, counts, runs, settings, profiles] = await Promise.all([getState(), queued(), sourceCounts(), listRuns(1), getSettings(), listProfiles()]);
    const total = Object.values(counts).reduce((s, c) => s + c.offers, 0);
    const per = Object.keys(counts).sort().map((s) => `  ${s}: ${counts[s].offers}`);
    const last = runs[0] ? `${formatDateTime(runs[0].started_at)} (${runs[0].trigger}, ${runs[0].added} new)` : 'unknown';
    const ai = !settings.aiFilter ? 'off' : !process.env.OPENAI_API_KEY ? 'on, but no OPENAI_API_KEY (all sent)' : profiles[0] ? `“${profiles[0].name}”` : 'on, but no profile (all sent)';
    const scraping = settings.enabled ? `every ${settings.everyMinutes} min, ${settings.fromHour}–${settings.toHour}` : '⏸ paused';
    await reply(
      `${state.muted ? '🔕 muted' : '🔔 active'}\n${n} queued\n🔎 scraping: ${scraping}\n✦ AI filter: ${ai}\n${total} offers stored\n${per.join('\n')}\n\nlast run: ${last}`,
    );
  } else {
    await reply(`❓ Unknown command "${text.slice(0, 50)}"\n\n${HELP}`);
  }
  return NextResponse.json({ ok: true });
}
