// Shared by the app's client (lib/db/client.ts) and drizzle.config.ts, so `next dev` and
// `npm run db:migrate` connect the same way. No `server-only`: drizzle-kit loads it in plain Node.

/** A database on this machine (a throwaway container): no TLS there. */
export function isLocalDatabase(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Supabase only takes TLS connections; the URL it shows has no sslmode, and postgres.js
 * defaults to plain text, so `sslmode=require` is added unless the URL says otherwise.
 */
export function withSsl(url: string) {
  if (isLocalDatabase(url) || /[?&]sslmode=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sslmode=require`;
}

/** Where drizzle-kit records the migrations it ran (drizzle.config.ts), read by lib/db/health.ts */
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * A timestamptz as Postgres prints it ("2026-10-03 12:34:56.123456+00", "… +05:30") in ISO 8601:
 * "2026-10-03T12:34:56.123456+00:00". Every browser's Date parses this; the
 * space and the hour-only offset aren't ISO, and Safari has refused them. The microseconds stay, so
 * the value read back in a `where` is the same instant. Anything else ('infinity') is left alone.
 */
export function isoTimestamp(value: string): string {
  const match = /^(\d{4,}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(value);
  if (!match) return value;
  const [, day, time, hours, minutes = '00', seconds] = match;
  return `${day}T${time}${hours}:${minutes}${seconds ? `:${seconds}` : ''}`;
}

/** Postgres' type id of timestamptz, for the driver's parser (lib/db/client.ts) */
export const TIMESTAMPTZ_OID = 1184;
