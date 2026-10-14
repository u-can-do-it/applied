import 'server-only';
import { byHost } from './boards';

// A board that turns a burst of requests away (its `pace`: LinkedIn): its requests go one at a time, a gap
// apart, at most a batch of them in any window, in this function: a run's pages, its ads, the AI's ads. One
// past the batch, or while the board rests after turning a request away (HTTP 429: a window long), isn't
// sent: it fails at once with Deferred, so a run leaves it for its follow-up a few minutes later
// (lib/listings/pipeline/follow-up.ts) instead of asking again into the refusal.

/** Not sent: the board's batch is used up, or it rests after turning a request away. Not the board's error. */
export class Deferred extends Error {}

type Gate = { queue: Promise<unknown>; lastAt: number; sent: number[]; restUntil: number };
const gates = new Map<string, Gate>();

/** The request in its turn; `request` starts its own timeout, so the wait doesn't count against it. */
export function paced(url: string, request: () => Promise<Response>): Promise<Response> {
  const board = byHost(new URL(url).hostname);
  const pace = board?.pace;
  if (!board || !pace) return request();
  const gate = gates.get(board.id) ?? { queue: Promise.resolve(), lastAt: 0, sent: [], restUntil: 0 };
  gates.set(board.id, gate);
  const turn = gate.queue.then(async () => {
    if (Date.now() < gate.restUntil) throw new Deferred(`${board.label} turned a request away (HTTP 429): it rests`);
    gate.sent = gate.sent.filter((at) => at > Date.now() - pace.windowMs);
    if (gate.sent.length >= pace.batch) throw new Deferred(`${board.label}'s batch of ${pace.batch} requests is used`);
    const wait = gate.lastAt + pace.gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    gate.sent.push(Date.now());
    try {
      const res = await request();
      if (res.status === 429) gate.restUntil = Date.now() + pace.windowMs;
      return res;
    } finally {
      gate.lastAt = Date.now();
    }
  });
  gate.queue = turn.catch(() => undefined);
  return turn;
}

/** For the tests: every board's gate open and empty again. */
export const resetPace = () => gates.clear();
