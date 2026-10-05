# 4. One password; the login cookie is an HMAC of it

- Status: accepted (2026-10-03)
- Context: [`server/auth.ts`](../../server/auth.ts), [`proxy.ts`](../../proxy.ts)

## Context

Jobwatch has one user. It stores a CV and every application, so it must not be public, but user accounts,
sessions in the database or an identity provider would be more to run than the app itself. The check has to
work in `proxy.ts` (before every page), in server actions and in route handlers.

## Decision

- **One password**, `APP_PASSWORD`. In production without it, `proxy.ts` answers 503 everywhere (fail closed);
  a dev server without it stays open.
- The cookie `jw_auth` holds `HMAC-SHA256(APP_PASSWORD, "jobwatch-auth-v1")`: never the password, and nothing
  to store server-side. `httpOnly`, `secure` in production, `SameSite=Lax`, 400 days (the longest browsers
  keep one). It is compared in constant time (`lib/hmac.ts`), and a wrong password waits 600 ms.
- Web Crypto only, so the same code runs in the proxy and in Node.
- `proxy.ts` checks every request except the login page and the two machine endpoints; the routes that
  return data or start work (`/api/application`, `/api/health`, `/api/scrape`) and every server action
  (`action()` → `requireLogin()`) check again. `/api/scrape` also requires a same-origin request.
- The machine endpoints have their own secrets, derived the same way when not set: Supabase Cron's bearer
  token is `CRON_SECRET`, else `HMAC(APP_PASSWORD, "jobwatch-cron-v1")`; Telegram's webhook secret is
  `HMAC(TELEGRAM_BOT_TOKEN, "jobwatch-telegram-v1")`.

## Consequences

- Changing `APP_PASSWORD` logs every browser out, and that is the only way to; there is no per-device logout.
- Without `CRON_SECRET`, changing the password also changes the cron's secret: reconnect Supabase Cron
  ([OPERATIONS.md → Recovery](../OPERATIONS.md#recovery)). Changing the bot token: reconnect the commands.
- Anyone with the cookie value is logged in until the password changes; it can't be read by page scripts.
- More users would need a real session model; nothing here is in the way of adding one.
