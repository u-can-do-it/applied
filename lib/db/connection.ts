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
