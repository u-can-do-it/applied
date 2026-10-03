import 'server-only';
import { BROWSER_UA, checkUrl } from '../outbound';

const TIMEOUT_MS = 12_000;

/** One request to a board, as a browser would make it; an HTTP error throws (so it can be retried later). */
export async function get(url: string, accept = 'text/html,application/json') {
  checkUrl(url);
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'pl,en;q=0.8', Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
