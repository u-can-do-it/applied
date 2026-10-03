import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/lib/env';

const required = { SUPABASE_DB_URL: 'postgresql://postgres:pw@localhost:5432/postgres' };

describe('parseEnv', () => {
  it('applies the defaults', () => {
    const env = parseEnv(required);
    expect(env.OPENAI_MODEL).toBe('gpt-6-luna');
    expect(env.OPENAI_ASSESS_EFFORT).toBe('high');
    expect(env.OPENAI_DEDUP_EFFORT).toBe('low');
    expect(env.OPENAI_EXTRACT_EFFORT).toBe('low');
    expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(env.TELEGRAM_API_URL).toBe('https://api.telegram.org');
    expect(env.NODE_ENV).toBe('development');
  });

  it('leaves the optional features off when their variables are missing', () => {
    const env = parseEnv(required);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_CHAT_ID).toBeUndefined();
    expect(env.APP_PASSWORD).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.VERCEL_PROJECT_PRODUCTION_URL).toBeUndefined();
  });

  it('counts an empty value (VAR= in .env) as not set', () => {
    const env = parseEnv({
      ...required,
      OPENAI_MODEL: '',
      OPENAI_BASE_URL: '',
      APP_PASSWORD: '',
      TELEGRAM_API_URL: '',
    });
    expect(env.OPENAI_MODEL).toBe('gpt-6-luna');
    expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(env.TELEGRAM_API_URL).toBe('https://api.telegram.org');
    expect(env.APP_PASSWORD).toBeUndefined();
  });

  it('keeps what is set, without trailing slashes on the URLs', () => {
    const env = parseEnv({
      ...required,
      NODE_ENV: 'production',
      OPENAI_MODEL: 'gpt-x',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1/',
      TELEGRAM_API_URL: 'http://localhost:8081//',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.OPENAI_MODEL).toBe('gpt-x');
    expect(env.OPENAI_BASE_URL).toBe('https://proxy.example.com/v1');
    expect(env.TELEGRAM_API_URL).toBe('http://localhost:8081');
  });

  it('fails with a readable message where a missing required variable is read, not before', () => {
    const env = parseEnv({ APP_PASSWORD: 'secret' });
    // the rest still works: the login and the 503 gate only need APP_PASSWORD
    expect(env.APP_PASSWORD).toBe('secret');
    expect(env.OPENAI_MODEL).toBe('gpt-6-luna');
    expect(() => env.SUPABASE_DB_URL).toThrow('SUPABASE_DB_URL is not set');
  });

  it('says which variable is malformed', () => {
    const env = parseEnv({
      ...required,
      OPENAI_BASE_URL: 'ftp://x',
      TELEGRAM_API_URL: 'api.telegram.org',
      SUPABASE_DB_URL: 'https://example.supabase.co',
    });
    expect(() => env.OPENAI_BASE_URL).toThrow('OPENAI_BASE_URL is not an http(s) URL');
    expect(() => env.TELEGRAM_API_URL).toThrow('TELEGRAM_API_URL is not an http(s) URL');
    expect(() => env.SUPABASE_DB_URL).toThrow('SUPABASE_DB_URL is not a postgresql:// URL');
    expect(env.OPENAI_MODEL).toBe('gpt-6-luna');
  });

  it('takes a postgres:// or postgresql:// database URL', () => {
    const url = 'postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
    expect(parseEnv({ ...required, SUPABASE_DB_URL: url }).SUPABASE_DB_URL).toBe(url);
    expect(parseEnv({ ...required, SUPABASE_DB_URL: 'postgres://localhost/x' }).SUPABASE_DB_URL).toBe(
      'postgres://localhost/x',
    );
  });
});

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reads process.env on first use, so importing it without any variables is fine', async () => {
    vi.stubEnv('SUPABASE_DB_URL', '');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    const { env } = await import('@/lib/env');
    expect(env.TELEGRAM_BOT_TOKEN).toBe('token');
    expect(() => env.SUPABASE_DB_URL).toThrow('SUPABASE_DB_URL is not set');
  });
});
