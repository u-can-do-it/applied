import 'server-only';
import { desc, eq, lt } from 'drizzle-orm';
import { db } from '../client';
import { scrapeRuns, type ScrapeRunRow } from '../schema';

// The run log: what each scrape found, saved and sent. Two weeks of it.

export type ScrapeRun = ScrapeRunRow;
type Counts = Pick<ScrapeRun, 'found' | 'kept' | 'added' | 'fresh' | 'notified' | 'errors'>;

const KEEP_MS = 14 * 86400_000;

export async function start(trigger: string): Promise<number> {
  const [{ id }] = await db().insert(scrapeRuns).values({ trigger }).returning({ id: scrapeRuns.id });
  return id;
}

/** The run's counts, and the log trimmed to two weeks. */
export async function finish(id: number, counts: Counts) {
  await db()
    .update(scrapeRuns)
    .set({ ...counts, finishedAt: new Date().toISOString() })
    .where(eq(scrapeRuns.id, id));
  await db()
    .delete(scrapeRuns)
    .where(lt(scrapeRuns.startedAt, new Date(Date.now() - KEEP_MS).toISOString()));
}

/** What the AI check and Telegram did, after the run itself (they can finish later). */
export async function update(id: number, fields: Partial<Pick<ScrapeRun, 'notified' | 'matched' | 'errors'>>) {
  await db().update(scrapeRuns).set(fields).where(eq(scrapeRuns.id, id));
}

/** The newest first. */
export function list(limit = 12): Promise<ScrapeRun[]> {
  return db().select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(limit);
}
