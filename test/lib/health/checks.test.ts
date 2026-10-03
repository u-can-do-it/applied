import { describe, expect, it } from 'vitest';
import {
  cronCheck,
  lastRunCheck,
  migrationsCheck,
  openAiCheck,
  overall,
  profileCheck,
  runChecks,
  scrapingCheck,
  telegramCheck,
} from '@/lib/health/checks';
import { cronSchedule } from '@/lib/listings/cron';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';

const settings = { ...DEFAULT_SETTINGS, timeZone: 'Europe/Warsaw', everyMinutes: 10 };
const endpoint = 'https://jobwatch.example/api/cron/scrape';
const time = (iso: string) => iso.slice(11, 16);
const connected = {
  available: true,
  scheduled: true,
  schedule: cronSchedule(settings),
  active: true,
  url: endpoint,
  lastStatus: 200,
  lastError: null,
  lastAt: '2026-10-03T10:00:00Z',
  lastResult: 'started',
};

describe('runChecks', () => {
  it('runs every check; one that throws is a red row saying why, and the others still show', async () => {
    const rows = await runChecks([
      { id: 'a', label: 'A', check: () => ({ level: 'ok', reason: 'Fine.' }) },
      {
        id: 'b',
        label: 'B',
        check: () => Promise.reject(new Error('connection refused')),
      },
      { id: 'c', label: 'C', check: () => Promise.resolve({ level: 'warn' as const, reason: 'Hm.' }) },
    ]);
    expect(rows).toEqual([
      { id: 'a', label: 'A', level: 'ok', reason: 'Fine.' },
      { id: 'b', label: 'B', level: 'error', reason: 'Couldn’t check: connection refused' },
      { id: 'c', label: 'C', level: 'warn', reason: 'Hm.' },
    ]);
    expect(overall(rows)).toBe('error');
    expect(overall(rows.filter((row) => row.id !== 'b'))).toBe('warn');
    expect(overall(rows.filter((row) => row.id === 'a'))).toBe('ok');
  });
});

describe('the checks', () => {
  it('migrations: applied, behind (run db:migrate), unreachable', () => {
    expect(migrationsCheck({ db: 'ok', pending: [] }).level).toBe('ok');
    const behind = migrationsCheck({ db: 'behind', pending: ['0005_x'] });
    expect(behind).toMatchObject({ level: 'error', fix: { type: 'hint', code: 'npm run db:migrate' } });
    expect(behind.reason).toContain('0005_x');
    expect(migrationsCheck({ db: 'unreachable', pending: [] })).toMatchObject({
      level: 'error',
      fix: { code: 'SUPABASE_DB_URL' },
    });
  });

  it('Supabase Cron: unreadable, not enabled, not connected, out of step with the settings, paused, fine', () => {
    // the database down: it couldn't be checked, which db:migrate wouldn't fix
    expect(cronCheck({ available: false, readError: 'connection refused' }, settings, endpoint, time)).toEqual({
      level: 'error',
      reason: 'Couldn’t check: connection refused',
    });
    expect(cronCheck({ available: false }, settings, endpoint, time)).toMatchObject({
      level: 'error',
      fix: { code: 'npm run db:migrate' },
    });
    expect(cronCheck({ available: true, scheduled: false }, settings, endpoint, time)).toMatchObject({
      level: 'warn',
      fix: { type: 'action', action: 'connectCron', label: 'Connect' },
    });
    expect(cronCheck({ ...connected, schedule: '*/5 * * * *' }, settings, endpoint, time)).toMatchObject({
      level: 'warn',
      fix: { action: 'connectCron', label: 'Reconnect' },
    });
    expect(
      cronCheck({ ...connected, url: 'https://old.example/api/cron/scrape' }, settings, endpoint, time).level,
    ).toBe('warn');
    expect(cronCheck({ ...connected, lastStatus: 401 }, settings, endpoint, time).reason).toContain('401');
    const paused = { ...settings, enabled: false };
    expect(cronCheck({ ...connected, active: false }, paused, endpoint, time)).toMatchObject({ level: 'ok' });
    const fine = cronCheck(connected, settings, endpoint, time);
    expect(fine.level).toBe('ok');
    expect(fine.reason).toContain('Last call 10:00: a run started.');
  });

  it('Telegram: not set up, unreachable, commands not connected or elsewhere, fine', () => {
    const webhookUrl = 'https://jobwatch.example/api/telegram';
    const bot = { username: 'jw_bot', webhook: webhookUrl, webhookError: null, pending: 0 };
    expect(telegramCheck({ ready: false, bot: null, webhookUrl, notify: true }).level).toBe('warn');
    const unreachable = telegramCheck({ ready: true, bot: { error: 'Unauthorized' }, webhookUrl, notify: true });
    expect(unreachable.level).toBe('error');
    expect(unreachable.reason).toContain('Unauthorized');
    expect(telegramCheck({ ready: true, bot: { ...bot, webhook: null }, webhookUrl, notify: true })).toMatchObject({
      level: 'warn',
      fix: { action: 'connectTelegram', label: 'Connect' },
    });
    expect(
      telegramCheck({ ready: true, bot: { ...bot, webhook: 'https://x.example' }, webhookUrl, notify: true }).fix,
    ).toMatchObject({ label: 'Reconnect' });
    expect(
      telegramCheck({ ready: true, bot: { ...bot, webhookError: 'Bad Gateway' }, webhookUrl, notify: true }).level,
    ).toBe('warn');
    expect(telegramCheck({ ready: true, bot, webhookUrl, notify: true })).toEqual({
      level: 'ok',
      reason: '@jw_bot, commands connected.',
    });
    expect(telegramCheck({ ready: true, bot, webhookUrl, notify: false }).reason).toContain('switched off');
  });

  it('OpenAI and the AI profile', () => {
    expect(openAiCheck(true).level).toBe('ok');
    expect(openAiCheck(false)).toMatchObject({ level: 'warn', fix: { code: 'OPENAI_API_KEY' } });
    expect(profileCheck([])).toMatchObject({ level: 'warn', fix: { href: '/ai' } });
    expect(profileCheck([{ name: 'Me', version: 2, prompt: ' ', fileName: null }]).level).toBe('warn');
    expect(profileCheck([{ name: 'Me', version: 2, prompt: '', fileName: 'cv.pdf' }])).toEqual({
      level: 'ok',
      reason: '“Me”, version 2.',
    });
  });

  it('the last scrape run: none, going, died, failed, a scraper failed, fine', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    const run = {
      startedAt: '2026-10-03T11:50:00Z',
      finishedAt: '2026-10-03T11:50:30Z',
      trigger: 'cron',
      added: 3,
      errors: [],
    };
    expect(lastRunCheck(null, now, time).level).toBe('warn');
    expect(lastRunCheck({ ...run, startedAt: '2026-10-03T11:59:00Z', finishedAt: null }, now, time).level).toBe('ok');
    expect(lastRunCheck({ ...run, finishedAt: null }, now, time)).toMatchObject({
      level: 'error',
      fix: { href: '/activity' },
    });
    expect(lastRunCheck({ ...run, errors: [{ scraper: 'Run', error: 'db down' }] }, now, time).level).toBe('error');
    expect(lastRunCheck({ ...run, errors: [{ scraper: 'LinkedIn', error: 'HTTP 429' }] }, now, time)).toMatchObject({
      level: 'warn',
      reason: '11:50 (Cron): LinkedIn failed.',
    });
    expect(lastRunCheck(run, now, time)).toEqual({ level: 'ok', reason: '11:50 (Cron): 3 new.' });
  });

  it('scraping paused: amber, with Resume', () => {
    expect(scrapingCheck({ ...settings, enabled: false })).toMatchObject({
      level: 'warn',
      fix: { action: 'resumeScraping' },
    });
    expect(scrapingCheck(settings).reason).toBe('On, every 10 min, 7:00–22:00 (Europe/Warsaw).');
  });
});
