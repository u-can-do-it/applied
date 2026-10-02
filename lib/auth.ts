// Password gate. The cookie holds an HMAC of the password, never the password itself,
// so it can't be read back from the browser; changing APP_PASSWORD logs everyone out.
// Web Crypto only, so it runs the same in proxy.ts, server actions and route handlers.

export const AUTH_COOKIE = 'jw_auth';
export const AUTH_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers keep a cookie

export const authEnabled = () => Boolean(process.env.APP_PASSWORD);

async function hmac(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const authToken = () => hmac(process.env.APP_PASSWORD ?? '', 'jobwatch-auth-v1');

function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidToken(token: string | undefined) {
  if (!authEnabled()) return true;
  return Boolean(token) && sameString(token!, await authToken());
}

export async function isValidPassword(password: string) {
  return authEnabled() && sameString(await hmac(password, 'jobwatch-auth-v1'), await authToken());
}
