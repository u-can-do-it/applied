// The Health card at the top of Settings: one row per thing Jobwatch depends on, each green, amber or
// red with the one-line reason and the one thing that fixes it. Pure: the card (features/health)
// reads the database, Supabase Cron and Telegram and hands the answers to these.

import { SCRAPE_LOCK_MS } from '../budgets';
import type { DbHealth } from '../db/health';
import type { CronInfo } from '../db/repos/cron';
import type { ScrapeRun } from '../db/repos/scrape-runs';
import { cronProblem, describeSchedule, lastAnswer } from '../listings/cron';
import type { ScrapeSettings } from '../listings/settings';
import { triggerLabel } from '../listings/triggers';
import { message } from '../shared/errors';
import type { BotInfo } from '../telegram';

/** ok: green; warn: amber (works, but not fully, or not set up); error: red (broken) */
export type HealthLevel = 'ok' | 'warn' | 'error';

/** The one thing that fixes a row: a page to go to, a button, or something to run or set (`code`). */
export type HealthFix =
  | { type: 'link'; href: string; label: string }
  | { type: 'action'; action: 'connectCron' | 'connectTelegram' | 'resumeScraping'; label: string }
  | { type: 'hint'; text: string; code: string };

export type HealthResult = { level: HealthLevel; reason: string; fix?: HealthFix };
export type HealthRow = HealthResult & { id: string; label: string };
export type HealthCheck = { id: string; label: string; check: () => HealthResult | Promise<HealthResult> };

/** Runs every check at once. One that throws is a red row saying why; the others still show. */
export function runChecks(checks: readonly HealthCheck[]): Promise<HealthRow[]> {
  return Promise.all(
    checks.map(async ({ id, label, check }): Promise<HealthRow> => {
      try {
        return { id, label, ...(await check()) };
      } catch (error) {
        return { id, label, level: 'error', reason: `Couldn’t check: ${message(error)}` };
      }
    }),
  );
}

/** The worst of the rows: what the card's heading says. */
export const overall = (rows: readonly HealthRow[]): HealthLevel =>
  rows.some((row) => row.level === 'error') ? 'error' : rows.some((row) => row.level === 'warn') ? 'warn' : 'ok';

// ---- the checks ---------------------------------------------------------------------------

const MIGRATE: HealthFix = { type: 'hint', text: 'Run', code: 'npm run db:migrate' };

export function migrationsCheck(health: DbHealth): HealthResult {
  if (health.db === 'unreachable')
    return {
      level: 'error',
      reason: 'Can’t reach the database.',
      fix: { type: 'hint', text: 'Check', code: 'SUPABASE_DB_URL' },
    };
  if (health.db === 'behind') {
    const count = health.pending.length;
    return {
      level: 'error',
      reason: `${count} migration${count === 1 ? '' : 's'} not applied yet: ${health.pending.join(', ')}.`,
      fix: MIGRATE,
    };
  }
  return { level: 'ok', reason: 'Every migration is applied.' };
}

/** `formatTime`: a time in the app's time zone. */
export function cronCheck(
  cron: CronInfo,
  settings: ScrapeSettings,
  endpoint: string,
  formatTime: (iso: string) => string,
): HealthResult {
  if (cron.readError) return { level: 'error', reason: `Couldn’t check: ${cron.readError}` };
  if (!cron.available) return { level: 'error', reason: 'Supabase Cron isn’t enabled in the database.', fix: MIGRATE };
  if (!cron.scheduled)
    return {
      level: 'warn',
      reason: 'Not connected: nothing scrapes on its own, only “Scrape now”.',
      fix: { type: 'action', action: 'connectCron', label: 'Connect' },
    };
  const problem = cronProblem(cron, settings, endpoint);
  if (problem)
    return { level: 'warn', reason: problem, fix: { type: 'action', action: 'connectCron', label: 'Reconnect' } };
  if (!settings.enabled) return { level: 'ok', reason: 'Connected; it doesn’t call while scraping is paused.' };
  const last = cron.lastAt ? ` Last call ${formatTime(cron.lastAt)}: ${lastAnswer(cron)}.` : '';
  return { level: 'ok', reason: `Calls the app ${describeSchedule(settings)}.${last}` };
}

export type TelegramInput = {
  /** TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set */
  ready: boolean;
  bot: BotInfo | { error: string } | null;
  webhookUrl: string;
  notify: boolean;
  /** push notifications reach a device: without Telegram, new offers still go somewhere */
  pushOn?: boolean;
};

export function telegramCheck({ ready, bot, webhookUrl, notify, pushOn }: TelegramInput): HealthResult {
  if (!ready && pushOn)
    return { level: 'ok', reason: 'Not set up; push notifications send new offers (no chat commands).' };
  if (!ready)
    return {
      level: 'warn',
      reason: 'Not set up: no messages about new offers, no commands.',
      fix: { type: 'hint', text: 'Set', code: 'TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID' },
    };
  if (!bot || 'error' in bot)
    return {
      level: 'error',
      reason: `Can’t reach the bot${bot ? `: ${bot.error}` : ''}.`,
      fix: { type: 'hint', text: 'Check', code: 'TELEGRAM_BOT_TOKEN' },
    };
  const name = bot.username ? `@${bot.username}` : 'The bot';
  const connect = (label: string): HealthFix => ({ type: 'action', action: 'connectTelegram', label });
  if (!bot.webhook) return { level: 'warn', reason: `${name}: commands aren’t connected.`, fix: connect('Connect') };
  if (bot.webhook !== webhookUrl)
    return {
      level: 'warn',
      reason: `${name} sends commands to another address (${bot.webhook}).`,
      fix: connect('Reconnect'),
    };
  if (bot.webhookError)
    return {
      level: 'warn',
      reason: `${name}: the last command failed (${bot.webhookError}).`,
      fix: connect('Reconnect'),
    };
  return {
    level: 'ok',
    reason: `${name}, commands connected${notify ? '' : '; sending new offers is switched off'}.`,
  };
}

const VAPID = 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT';

export type PushInput = {
  /** what's wrong with the VAPID variables (lib/push.ts pushProblem): 'not set', one malformed…; null: fine */
  problem: string | null;
  /** subscribed devices */
  devices: number;
  notify: boolean;
  /** Telegram is set up: without push, new offers still go somewhere */
  telegram: boolean;
};

export function pushCheck({ problem, devices, notify, telegram }: PushInput): HealthResult {
  if (problem === 'not set')
    return telegram
      ? { level: 'ok', reason: 'Off (no VAPID keys); Telegram sends new offers.' }
      : {
          level: 'warn',
          reason: 'Not set up: no notifications on your phone.',
          fix: { type: 'hint', text: 'Set', code: VAPID },
        };
  if (problem) return { level: 'error', reason: `${problem}.`, fix: { type: 'hint', text: 'Check', code: VAPID } };
  if (!devices)
    return {
      level: 'warn',
      reason: 'No device gets them yet.',
      fix: { type: 'link', href: '#notifications-h', label: 'Enable on this device' },
    };
  return {
    level: 'ok',
    reason: `${devices} device${devices === 1 ? '' : 's'} subscribed${notify ? '' : '; sending new offers is switched off'}.`,
  };
}

export function openAiCheck(keySet: boolean): HealthResult {
  return keySet
    ? { level: 'ok', reason: 'The key is set.' }
    : {
        level: 'warn',
        reason: 'No key: no AI filter and no AI runs.',
        fix: { type: 'hint', text: 'Set', code: 'OPENAI_API_KEY' },
      };
}

type ProfileInfo = { name: string; version: number; prompt: string; fileName: string | null };

/** `profiles`: most recently used first (the first is the active one). */
export function profileCheck(profiles: readonly ProfileInfo[]): HealthResult {
  const active = profiles.at(0);
  if (!active)
    return {
      level: 'warn',
      reason: 'No profile yet: the AI has nothing to judge offers against.',
      fix: { type: 'link', href: '/ai', label: 'Create one' },
    };
  if (!active.prompt.trim() && !active.fileName)
    return {
      level: 'warn',
      reason: `“${active.name}” has neither criteria nor a CV.`,
      fix: { type: 'link', href: '/ai', label: 'Edit it' },
    };
  return { level: 'ok', reason: `“${active.name}”, version ${active.version}.` };
}

const SEE_RUNS: HealthFix = { type: 'link', href: '/activity', label: 'See the runs' };

/** The newest scrape run. `now` and `formatTime` (the app's time zone) come from the caller. */
export function lastRunCheck(
  run: Pick<ScrapeRun, 'startedAt' | 'finishedAt' | 'trigger' | 'added' | 'errors'> | null,
  now: number,
  formatTime: (iso: string) => string,
): HealthResult {
  if (!run) return { level: 'warn', reason: 'No scrape run yet: “Scrape now” at the top starts one.' };
  const when = formatTime(run.startedAt);
  if (!run.finishedAt) {
    // a run that held the lock this long has died (the lock ran out)
    if (now - Date.parse(run.startedAt) > SCRAPE_LOCK_MS)
      return { level: 'error', reason: `The run of ${when} didn’t finish.`, fix: SEE_RUNS };
    return { level: 'ok', reason: `A run is going (started ${when}).` };
  }
  // a warning (a channel failed, another sent) isn't a failure
  const failed = run.errors.filter((failure) => failure.scraper !== 'Run' && !failure.warning);
  if (run.errors.some((failure) => failure.scraper === 'Run'))
    return { level: 'error', reason: `The run of ${when} failed.`, fix: SEE_RUNS };
  if (failed.length) {
    const names = [...new Set(failed.map((failure) => failure.scraper))];
    return {
      level: 'warn',
      reason: `${when} (${triggerLabel(run.trigger)}): ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''} failed.`,
      fix: SEE_RUNS,
    };
  }
  return { level: 'ok', reason: `${when} (${triggerLabel(run.trigger)}): ${run.added} new.` };
}

export function scrapingCheck(settings: ScrapeSettings): HealthResult {
  if (!settings.enabled)
    return {
      level: 'warn',
      reason: 'Paused: nothing scrapes on its own; “Scrape now” still works.',
      fix: { type: 'action', action: 'resumeScraping', label: 'Resume' },
    };
  return { level: 'ok', reason: `On, ${describeSchedule(settings)}.` };
}
