import 'server-only';
import { hmac } from './hmac';
import { env } from './env';
import type { Queued } from './db/repos/notify-queue';
import type { Outgoing } from './channels/types';

// Telegram bot: the messages about new offers (one of the notification channels, lib/channels), and
// the /mute /resume /send /status commands (they arrive at /api/telegram once the webhook is
// connected in Settings).
// TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (your chat with the bot).

const api = (method: string) => `${env.TELEGRAM_API_URL}/bot${env.TELEGRAM_BOT_TOKEN ?? ''}/${method}`;

export const telegramReady = () => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
export const ownerChat = () => env.TELEGRAM_CHAT_ID ?? '';

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as {
      ok: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (data?.ok) return data.result as T;
    // too many messages at once: Telegram says how long to wait
    const wait = data?.parameters?.retry_after;
    if (res.status === 429 && wait && wait <= 30 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    throw new Error(`Telegram ${method}: ${data?.description ?? `HTTP ${res.status}`}`);
  }
}

export const sendMessage = (text: string, chatId = ownerChat()) =>
  call('sendMessage', { chat_id: chatId, text: text.slice(0, 4096) });

export type { Outgoing };
export type Message = { text: string; offers: Queued[] };

const LIMIT = 4096; // Telegram's longest message

const plural = (count: number) => `${count} new offer${count === 1 ? '' : 's'}`;

const offerText = (offer: Outgoing) => {
  const where = offer.remote ? 'zdalnie' : offer.location || 'stacjonarnie';
  const ai = offer.verdict
    ? `\n✦ ${offer.verdict.score}%${offer.verdict.summary ? ` · ${offer.verdict.summary.slice(0, 160)}` : ''}`
    : '';
  return `🆕 ${offer.title}\n${[offer.company, offer.seniority, where].filter(Boolean).join(' · ')}${ai}\n${offer.url}`;
};

/** One block per board, in board order. */
function blocks(offers: Outgoing[]): string[] {
  const bySrc = new Map<string, Outgoing[]>();
  for (const offer of offers) bySrc.set(offer.src, [...(bySrc.get(offer.src) ?? []), offer]);
  return [...bySrc.keys()]
    .sort()
    .map(
      (src) =>
        `---------------------- ${src} ----------------------\n${(bySrc.get(src) ?? []).map(offerText).join('\n\n')}`,
    );
}

/**
 * The one message a run's batch makes (null when there's nothing in it). With the AI filter, only
 * the matches are listed; the others are just counted ("3 new offers, none matched"), and offers the
 * AI couldn't check in time are listed with a warning, so nothing is lost when OpenAI is down. What
 * doesn't fit in a message is counted ("+ 4 more"), with a link to the app's new offers; it all
 * counts as sent.
 */
export function formatNotification(notification: {
  matched: Outgoing[]; // everything new when the AI filter is off
  unmatched: Queued[];
  unchecked: Queued[];
  profile: string | null; // the AI profile's name when the AI filter decided
  held: boolean; // sent by hand after a mute
  link: string | null; // the app's AI tab, to look at what didn't match
  more?: string | null; // the app's new offers, for what didn't fit
}): Message | null {
  const { matched, unmatched, unchecked, profile } = notification;
  const offers = [...matched, ...unmatched, ...unchecked];
  if (!offers.length) return null;
  const held = notification.held ? `📬 Held while muted.\n` : '';
  if (!matched.length && !unchecked.length)
    return {
      text: `${held}🆕 ${plural(unmatched.length)}, none matched “${profile}”.${notification.link ? `\n${notification.link}` : ''}`,
      offers,
    };

  const heading = `🆕 ${plural(offers.length)}${profile !== null && matched.length ? `, ${matched.length} matching “${profile}”` : ''}`;
  const listable = matched.length + unchecked.length;
  // the message with the first `listed` of the matches and then the unchecked ones
  const render = (listed: number) => {
    const parts = [held + heading, ...blocks(matched.slice(0, listed))];
    const uncheckedListed = unchecked.slice(0, Math.max(0, listed - matched.length));
    if (uncheckedListed.length)
      parts.push(`⚠ Not checked by the AI (it failed for a while):\n${blocks(uncheckedListed).join('\n\n')}`);
    if (listed < listable)
      parts.push(
        `+ ${listed ? `${listable - listed} more` : plural(listable)}${notification.more ? `: ${notification.more}` : '.'}`,
      );
    if (unmatched.length) parts.push(`+ ${plural(unmatched.length)} didn't match “${profile}”.`);
    return parts.join('\n\n');
  };
  // as many as fit (each one listed makes it longer)
  let [fits, tooMany] = [0, listable + 1];
  while (tooMany - fits > 1) {
    const mid = Math.floor((fits + tooMany) / 2);
    if (render(mid).length <= LIMIT) fits = mid;
    else tooMany = mid;
  }
  return { text: render(fits), offers };
}

// ---- webhook (commands) ------------------------------------------------------------------

/** Telegram sends it back in X-Telegram-Bot-Api-Secret-Token, so only Telegram can call /api/telegram. */
export const webhookSecret = () => hmac(env.TELEGRAM_BOT_TOKEN ?? '', 'jobwatch-telegram-v1');

export async function connectWebhook(url: string) {
  await call('setWebhook', {
    url,
    secret_token: await webhookSecret(),
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
}
export const disconnectWebhook = () => call('deleteWebhook', { drop_pending_updates: false });

export type BotInfo = { username: string | null; webhook: string | null; webhookError: string | null; pending: number };

export async function botInfo(): Promise<BotInfo> {
  const [me, hook] = await Promise.all([
    call<{ username?: string }>('getMe'),
    call<{ url?: string; last_error_message?: string; pending_update_count?: number }>('getWebhookInfo'),
  ]);
  return {
    username: me.username ?? null,
    webhook: hook.url || null,
    webhookError: hook.last_error_message ?? null,
    pending: hook.pending_update_count ?? 0,
  };
}
