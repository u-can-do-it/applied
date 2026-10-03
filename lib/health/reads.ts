import 'server-only';
import { cache } from 'react';
import { listProfiles } from '../ai/profiles';
import * as cronRepo from '../db/repos/cron';
import { message } from '../shared/errors';
import { botInfo, telegramReady, type BotInfo } from '../telegram';

// What the Health card and the panels under it both show, read once per request (React.cache): the
// Supabase Cron job and the Telegram bot. The bot is asked only where Settings asked it before (one
// getMe + getWebhookInfo per Settings load), not on the other pages.

export type CronInfo = cronRepo.CronInfo;
export type BotAnswer = BotInfo | { error: string } | null;

/** The job; when it can't be read (the database down), `readError` says why. */
export const cronInfo = cache((): Promise<CronInfo> =>
  cronRepo.status().catch((failure: unknown) => ({ available: false, readError: message(failure) })),
);

/** The bot and its webhook; null when Telegram isn't set up, `{ error }` when it can't be reached. */
export const botAnswer = cache((): Promise<BotAnswer> =>
  telegramReady() ? botInfo().catch((failure: unknown) => ({ error: message(failure) })) : Promise.resolve(null),
);

/** The AI profiles, most recently used first (the first is the active one). */
export const profileList = cache(() => listProfiles());
