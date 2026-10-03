import 'server-only';
import { hmac } from './auth';
import { env } from './env';
import type { Queued } from './scraping/store';

// Telegram bot: the messages about new offers, and the /mute /resume /send /status
// commands (they arrive at /api/telegram once the webhook is connected in Settings).
// TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (your chat with the bot).

const BATCH = 5; // offers per message
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
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`Telegram ${method}: ${data?.description ?? `HTTP ${res.status}`}`);
  }
}

export const sendMessage = (text: string, chatId = ownerChat()) =>
  call('sendMessage', { chat_id: chatId, text: text.slice(0, 4096) });

export type Outgoing = Queued & { verdict?: { score: number; summary: string | null } };
export type Message = { text: string; offers: Queued[] };

const offerText = (o: Outgoing) => {
  const where = o.remote ? 'zdalnie' : o.location || 'stacjonarnie';
  const ai = o.verdict
    ? `\n✦ ${o.verdict.score}%${o.verdict.summary ? ` · ${o.verdict.summary.slice(0, 160)}` : ''}`
    : '';
  return `🆕 ${o.title}\n${[o.company, o.seniority, where].filter(Boolean).join(' · ')}${ai}\n${o.url}`;
};

/** One block per board, five offers per message. */
function blocks(offers: Outgoing[], heading?: string): Message[] {
  const bySrc = new Map<string, Outgoing[]>();
  for (const o of offers) bySrc.set(o.src, [...(bySrc.get(o.src) ?? []), o]);
  const out: Message[] = [];
  for (const src of [...bySrc.keys()].sort()) {
    const list = bySrc.get(src) ?? [];
    for (let i = 0; i < list.length; i += BATCH) {
      const part = list.slice(i, i + BATCH);
      let text = part.map(offerText).join('\n\n');
      if (i === 0) text = `---------------------- ${src} ----------------------\n${text}`;
      out.push({ text, offers: part });
    }
  }
  if (heading && out.length) out[0] = { ...out[0], text: `${heading}\n${out[0].text}` };
  return out;
}

/**
 * What goes to the chat. With the AI filter, only the matches are listed; the others are just
 * counted ("3 new offers, none matched"), and offers the AI couldn't check in time are listed
 * with a warning, so nothing is lost when OpenAI is down.
 */
export function formatNotification(n: {
  matched: Outgoing[]; // everything new when the AI filter is off
  unmatched: Queued[];
  unchecked: Queued[];
  profile: string | null; // the AI profile's name when the AI filter decided
  held: boolean; // sent by hand after a mute
  link: string | null; // the app's AI tab, to look at what didn't match
}): Message[] {
  const total = n.matched.length + n.unmatched.length + n.unchecked.length;
  const out = [...blocks(n.matched), ...blocks(n.unchecked, '⚠ Not checked by the AI (it failed for a while):')];
  if (n.unmatched.length) {
    const what = `${n.unmatched.length} new offer(s)`;
    if (out.length) {
      // a line under the last message, so it doesn't cost a message of its own
      const last = out[out.length - 1];
      out[out.length - 1] = {
        text: `${last.text}\n\n+ ${what} didn't match “${n.profile}”.`,
        offers: [...last.offers, ...n.unmatched],
      };
    } else {
      out.push({ text: `🆕 ${what}, none matched “${n.profile}”.${n.link ? `\n${n.link}` : ''}`, offers: n.unmatched });
    }
  }
  if (n.held && out.length) out.unshift({ text: `📬 ${total} offer(s) held while muted`, offers: [] });
  return out;
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
