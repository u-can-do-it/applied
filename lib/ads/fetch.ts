import 'server-only';
import { AD_TIMEOUT_MS } from '../budgets';
import { BROWSER_UA, fetchOutbound, readText } from '../outbound';

/**
 * One request to a board, as a browser would make it; an HTTP error throws (so it can be retried
 * later). The answer's body is read here, capped (readText), and handed back as a Response.
 */
export async function get(url: string, accept = 'text/html,application/json') {
  const res = await fetchOutbound(url, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'pl,en;q=0.8', Accept: accept },
    signal: AbortSignal.timeout(AD_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Response(await readText(res), { status: res.status, headers: res.headers });
}
