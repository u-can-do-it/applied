import 'server-only';

// Thin client for Supabase's REST API (PostgREST). Server-side only: uses the secret key.

function config() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set');
  return { base, key };
}

export function restUrl(table: string) {
  return new URL(`/rest/v1/${table}`, config().base);
}

/** GET /rest/v1/rpc/<fn>?arg=... - filters, order and limit can be added like on a table */
export function rpcUrl(fn: string, args: Record<string, string | number | null | undefined>) {
  const url = restUrl(`rpc/${fn}`);
  for (const [k, v] of Object.entries(args))
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return url;
}

export function authHeaders(): Record<string, string> {
  const { key } = config();
  // legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export async function rest(
  url: URL,
  init: Omit<RequestInit, 'headers'> & { prefer?: string; headers?: Record<string, string> } = {},
) {
  const { prefer, headers, ...rest } = init;
  const res = await fetch(url, {
    cache: 'no-store',
    // A signal also opts out of Next's request memoization, which would otherwise hand a
    // loop (the AI worker in after()) the same cached GET answer every time.
    signal: AbortSignal.timeout(30_000),
    ...rest,
    headers: {
      ...authHeaders(),
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} on ${url.pathname}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

// Content-Range: 0-49/1234  (or */0 when empty)
export const rangeTotal = (res: Response) => Number(res.headers.get('content-range')?.split('/')[1]) || 0;
