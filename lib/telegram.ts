import 'server-only';
import { hmac } from './auth';
import type { Queued } from './scraping/store';

// Telegram bot: the messages Node-RED's flush_queue built, and the /mute /resume /send /status
// commands (they arrive at /api/telegram once the webhook is connected in Settings).
// TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (your chat with the bot).

const BATCH = 5; // offers per message
const api = (method: string) =>
  `${process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org'}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export const telegramReady = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
export const ownerChat = () => String(process.env.TELEGRAM_CHAT_ID ?? '');

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | null;
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

/** Node-RED's format: one block per board, five offers per message. */
export function formatQueue(offers: Queued[], heldWhileMuted = false) {
  const bySrc = new Map<string, Queued[]>();
  for (const o of offers) bySrc.set(o.src, [...(bySrc.get(o.src) ?? []), o]);
  const out: { text: string; offers: Queued[] }[] = [];
  for (const src of [...bySrc.keys()].sort()) {
    const list = bySrc.get(src)!;
    for (let i = 0; i < list.length; i += BATCH) {
      const part = list.slice(i, i + BATCH);
      let text = part
        .map((o) => {
          const where = o.remote ? 'zdalnie' : o.location || 'stacjonarnie';
          return `🆕 ${o.title}\n${[o.company, o.seniority, where].filter(Boolean).join(' · ')}\n${o.url}`;
        })
        .join('\n\n');
      if (i === 0) text = `---------------------- ${src} ----------------------\n${text}`;
      out.push({ text, offers: part });
    }
  }
  if (heldWhileMuted && out.length) out.unshift({ text: `📬 ${offers.length} offer(s) held while muted`, offers: [] });
  return out;
}

// ---- webhook (commands) ------------------------------------------------------------------

/** Telegram sends it back in X-Telegram-Bot-Api-Secret-Token, so only Telegram can call /api/telegram. */
export const webhookSecret = () => hmac(process.env.TELEGRAM_BOT_TOKEN ?? '', 'jobwatch-telegram-v1');

export async function connectWebhook(url: string) {
  await call('setWebhook', { url, secret_token: await webhookSecret(), allowed_updates: ['message'], drop_pending_updates: true });
}
export const disconnectWebhook = () => call('deleteWebhook', { drop_pending_updates: false });

export type BotInfo = { username: string | null; webhook: string | null; webhookError: string | null; pending: number };

export async function botInfo(): Promise<BotInfo> {
  const [me, hook] = await Promise.all([
    call<{ username?: string }>('getMe'),
    call<{ url?: string; last_error_message?: string; pending_update_count?: number }>('getWebhookInfo'),
  ]);
  return { username: me.username ?? null, webhook: hook.url || null, webhookError: hook.last_error_message ?? null, pending: hook.pending_update_count ?? 0 };
}
