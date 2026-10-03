import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatEntry, log, scrubText } from '@/lib/log';

const DB_URL = 'postgresql://postgres.abc:S3cretPw@aws-0-eu.pooler.supabase.com:6543/postgres';
const BOT_TOKEN = '123456:AAE-the-bot-token-xyz0123456789';
const at = new Date('2026-10-03T12:00:00Z');
const entry = (...args: Parameters<typeof formatEntry>) => JSON.parse(formatEntry(...args)) as Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv('SUPABASE_DB_URL', DB_URL);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN);
  vi.stubEnv('APP_PASSWORD', 'hunter2-long');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a log line', () => {
  it('is one JSON object: ts, level, msg, then the context', () => {
    const line = formatEntry('warn', 'Scraper failed', { scraper: 'JustJoin', runId: 'r1', count: 3 }, at);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      ts: '2026-10-03T12:00:00.000Z',
      level: 'warn',
      msg: 'Scraper failed',
      scraper: 'JustJoin',
      runId: 'r1',
      count: 3,
    });
  });

  it('goes to stderr for warnings and errors, stdout otherwise', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.info('a');
    log.warn('b');
    log.error('c', { jobId: 'acme|dev' });
    expect(out).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({ level: 'error', msg: 'c', jobId: 'acme|dev' });
  });

  it('never throws, whatever the context', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => log.info('cycle', { cycle, big: 10n })).not.toThrow();
  });
});

describe('secrets', () => {
  it('values under secret-looking keys, at any depth', () => {
    expect(
      entry('info', 'x', {
        token: 'abc',
        headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k', accept: 'text/html' },
        password: 'p',
        cronSecret: 's',
      }),
    ).toMatchObject({
      token: '[redacted]',
      headers: { Authorization: '[redacted]', 'X-Api-Key': '[redacted]', accept: 'text/html' },
      password: '[redacted]',
      cronSecret: '[redacted]',
    });
  });

  it("the configured secrets wherever they appear, a URL's password and token-like query values", () => {
    const text = scrubText(
      `connect to ${DB_URL} failed; GET https://api.telegram.org/bot${BOT_TOKEN}/getMe ` +
        'and https://board.test/jobs?q=react&access_token=t0k&sig=abc&page=2 with hunter2-long',
    );
    expect(text).not.toContain('S3cretPw');
    expect(text).not.toContain(BOT_TOKEN);
    expect(text).not.toContain('t0k');
    expect(text).not.toContain('hunter2-long');
    expect(text).toContain('q=react');
    expect(text).toContain('page=2');
    // a parameter's whole name, or its last part, says it's a secret; a word that only contains one doesn't
    const query = new URL(
      scrubText(
        'https://x.test/?token=1&api_key=2&apikey=3&sig=4&signature=5&access_token=6&password=7&secret=8' +
          '&client_secret=9&X-Api-Key=10&keywords=react&author=ann&zipcode=00-001&page=2',
      ),
    ).searchParams;
    for (const name of [
      'token',
      'api_key',
      'apikey',
      'sig',
      'signature',
      'access_token',
      'password',
      'secret',
      'client_secret',
      'X-Api-Key',
    ])
      expect(query.get(name), name).toBe('[redacted]');
    expect(
      Object.fromEntries(['keywords', 'author', 'zipcode', 'page'].map((name) => [name, query.get(name)])),
    ).toEqual({
      keywords: 'react',
      author: 'ann',
      zipcode: '00-001',
      page: '2',
    });
    // a database URL the app isn't configured with still loses its password
    expect(scrubText('postgres://user:other-pw@db.test:5432/x')).toBe('postgres://user:%5Bredacted%5D@db.test:5432/x');
    expect(scrubText('key sk-proj-abcdefghijklmnopqrstuv and Bearer eyJhbGciOi.x.y')).toBe(
      'key [redacted] and [redacted]',
    );
  });

  it("an error: message() and its stack's frames, never a failed query's values", () => {
    const cause = new Error('duplicate key value violates unique constraint');
    const failed = new DrizzleQueryError('update applications set note = $1', ['my private note', 'secret'], cause);
    const logged = entry('error', 'Saving failed', { error: failed, jobId: 'j1' });
    expect(logged.error).toBe('duplicate key value violates unique constraint');
    expect(logged.stack).toMatch(/^at /);
    expect(JSON.stringify(logged)).not.toContain('my private note');
    expect(JSON.stringify(logged)).not.toContain('update applications');
    expect(entry('error', 'x', { error: 'plain words' })).toMatchObject({ error: 'plain words' });
    expect(entry('error', 'x', { error: new Error(`bad ${DB_URL}`) }).error).not.toContain('S3cretPw');
  });

  it('a secret as a URL carries it (percent-encoded), and the database password on its own', () => {
    vi.stubEnv('APP_PASSWORD', 'p@ss word/1');
    vi.stubEnv('SUPABASE_DB_URL', 'postgresql://postgres.abc:S3cr%40tPw@db.test:6543/postgres');
    const text = scrubText('login?pw=p%40ss%20word%2F1 then auth failed for S3cr@tPw and S3cr%40tPw');
    expect(text).not.toMatch(/p%40ss|S3cr/);
  });

  it("libpq connection strings, a token as a URL's user name, and tokens in a fragment", () => {
    expect(scrubText("host=db.test user=postgres password='it\\'s secret' dbname=x")).toBe(
      'host=db.test user=postgres password=[redacted] dbname=x',
    );
    expect(scrubText('connect: pwd=hunter3; PASSWD="a b"')).toBe('connect: pwd=[redacted]; PASSWD=[redacted]');
    expect(scrubText('git https://ghp_abcdef123456@github.test/repo.git')).toBe(
      'git https://%5Bredacted%5D@github.test/repo.git',
    );
    const url = new URL(scrubText('https://app.test/cb#access_token=t0k&state=s1&id_token=x'));
    expect(new URLSearchParams(url.hash.slice(1)).get('access_token')).toBe('[redacted]');
    expect(new URLSearchParams(url.hash.slice(1)).get('id_token')).toBe('[redacted]');
    expect(new URLSearchParams(url.hash.slice(1)).get('state')).toBe('s1');
    expect(scrubText('https://app.test/page#section-2')).toBe('https://app.test/page#section-2');
  });

  it('headers as [name, value] pairs, or a Headers object', () => {
    expect(
      entry('info', 'x', {
        sent: [
          ['Authorization', 'Bearer abc'],
          ['X-Api-Key', 'k1'],
          ['Accept', 'text/html'],
        ],
        response: new Headers({ 'set-cookie': 'sid=1', 'content-type': 'text/html' }),
      }),
    ).toMatchObject({
      sent: [
        ['Authorization', '[redacted]'],
        ['X-Api-Key', '[redacted]'],
        ['Accept', 'text/html'],
      ],
      response: [
        ['content-type', 'text/html'],
        ['set-cookie', '[redacted]'],
      ],
    });
  });

  it("an error's cause, redacted the same way", () => {
    const cause = Object.assign(new Error(`connect ECONNREFUSED 10.0.0.1:443 for ${DB_URL}`), { code: 'ECONNREFUSED' });
    const logged = entry('error', 'Fetch failed', { error: new TypeError('fetch failed', { cause }) });
    expect(logged.error).toBe('fetch failed');
    expect(logged.cause).toMatch(/^connect ECONNREFUSED 10\.0\.0\.1:443 for /);
    expect(logged.cause).not.toContain('S3cretPw');
    // a failed query: its cause is the message already, no second field
    const failed = new DrizzleQueryError('select $1', ['v'], new Error('timeout'));
    expect(entry('error', 'x', { error: failed })).not.toHaveProperty('cause');
  });
});
