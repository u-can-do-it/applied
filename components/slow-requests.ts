import { toast } from 'sonner';
import { OPENAI_TIMEOUT_MS } from '@/lib/budgets';

// A toast when a request the browser makes takes over 3 s: server actions, page navigations (the RSC
// payload) and the /api endpoints all go through window.fetch. It shows while the request still waits
// and then says how long it took. Prefetches aren't watched: nobody is waiting for them.
// The server actions that answer only after OpenAI does get SLOW_AI_MS instead (slowAfter()).

export const SLOW_MS = 3000;

/** An AI answer often takes tens of seconds; past half its timeout it's slow. */
export const SLOW_AI_MS = OPENAI_TIMEOUT_MS / 2;

/** server action id (its Next-Action header) -> its own SLOW_MS */
const limits = new Map<string, number>();

/** These server actions (by id) are slow only after `ms`. */
export function slowAfter(actionIds: string[], ms: number) {
  for (const id of actionIds) limits.set(id, ms);
}

type Fetch = typeof fetch;

const headersOf = (input: RequestInfo | URL, init?: RequestInit) =>
  new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

/** "POST /settings (server action)", "GET /applied (page)", "GET /api/changes?since=…". */
export function describe(input: RequestInfo | URL, init?: RequestInit): string {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.href);
  url.searchParams.delete('_rsc'); // Next's cache buster on page fetches
  const where = url.origin === window.location.origin ? url.pathname + url.search : url.href;
  const headers = headersOf(input, init);
  const kind = headers.has('next-action') ? ' (server action)' : headers.has('rsc') ? ' (page)' : '';
  return `${method} ${where}${kind}`;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** window.fetch, timed: a warning toast for each request over SLOW_MS (or its slowAfter()). */
export function watchSlow(original: Fetch): Fetch {
  return (input, init) => {
    const headers = headersOf(input, init);
    if (headers.has('next-router-prefetch')) return original(input, init);
    const what = describe(input, init);
    const limit = limits.get(headers.get('next-action') ?? '') ?? SLOW_MS;
    const started = performance.now();
    let id: string | number | undefined;
    const timer = setTimeout(() => {
      id = toast.warning(`Slow response: ${what}`, { description: 'Still waiting…', duration: Infinity });
    }, limit);
    const done = (outcome: string) => {
      clearTimeout(timer);
      if (id === undefined) return;
      toast.warning(`Slow response: ${what}`, {
        id,
        description: `${outcome} ${seconds(performance.now() - started)}`,
        duration: 8000,
      });
    };
    return original(input, init).then(
      (response) => {
        done(`HTTP ${response.status} after`);
        return response;
      },
      (failure: unknown) => {
        // aborted on purpose (left the page, a newer request): nothing to show
        if (failure instanceof DOMException && failure.name === 'AbortError') {
          clearTimeout(timer);
          if (id !== undefined) toast.dismiss(id);
        } else done('Failed after');
        throw failure;
      },
    );
  };
}
