// Password gate. The cookie holds an HMAC of the password, never the password itself,
// so it can't be read back from the browser; changing APP_PASSWORD logs everyone out.
// Web Crypto only, so it runs the same in proxy.ts, server actions and route handlers.
// No `import 'server-only'`: proxy.ts imports it, and that guard is for React Server Components bundles.

import { env } from '@/lib/env';
import { hmac, sameString } from '@/lib/hmac';

export const AUTH_COOKIE = 'jw_auth';
export const AUTH_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers keep a cookie

export const authEnabled = () => Boolean(env.APP_PASSWORD);

export const authToken = () => hmac(env.APP_PASSWORD ?? '', 'jobwatch-auth-v1');

export async function isValidToken(token: string | undefined) {
  if (!authEnabled()) return true;
  return token ? sameString(token, await authToken()) : false;
}

export async function isValidPassword(password: string) {
  return authEnabled() && sameString(await hmac(password, 'jobwatch-auth-v1'), await authToken());
}
