// Signing and comparing secrets: the login cookie (server/auth.ts), the cron endpoint's secret
// (lib/listings/schedule.ts) and Telegram's webhook secret (lib/telegram.ts).
// Web Crypto only, so it runs the same in proxy.ts, server actions and route handlers.

export async function hmac(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares in constant time, so the answer's timing doesn't say how much of a secret was right. */
export function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
