import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { isKind } from '../../scraping/kinds';
import { db } from '../client';
import { first } from '../rows';
import { scrapers, type ScraperRow } from '../schema';

// The scrapers: one search on one board each, in the order Settings shows them.

/** A scraper as the app uses it (without its row's own timestamps). */
export type Scraper = Omit<ScraperRow, 'createdAt' | 'updatedAt'>;
/** What the Settings form edits. */
export type ScraperInput = Pick<Scraper, 'name' | 'src' | 'kind' | 'enabled' | 'config'>;

const columns = {
  id: scrapers.id,
  position: scrapers.position,
  name: scrapers.name,
  src: scrapers.src,
  kind: scrapers.kind,
  enabled: scrapers.enabled,
  config: scrapers.config,
  mark: scrapers.mark,
  lastRunAt: scrapers.lastRunAt,
  lastStatus: scrapers.lastStatus,
  lastFound: scrapers.lastFound,
  lastKept: scrapers.lastKept,
  lastNew: scrapers.lastNew,
  lastError: scrapers.lastError,
  lastMs: scrapers.lastMs,
} satisfies Record<keyof Scraper, unknown>;

const inOrder = [asc(scrapers.position), asc(scrapers.createdAt)];

/** In order; a kind this version doesn't know (a newer one's row) is left out. */
export async function list(): Promise<Scraper[]> {
  const rows = await db()
    .select(columns)
    .from(scrapers)
    .orderBy(...inOrder);
  return rows.filter((row) => isKind(row.kind));
}

export async function get(id: string): Promise<Scraper | null> {
  return first(await db().select(columns).from(scrapers).where(eq(scrapers.id, id)));
}

/** Each scraper's board and name, in order (for the board names in the filters). */
export function boards(): Promise<Pick<Scraper, 'src' | 'name'>[]> {
  return db()
    .select({ src: scrapers.src, name: scrapers.name })
    .from(scrapers)
    .orderBy(...inOrder);
}

export async function insert(scraper: ScraperInput & { position: number }): Promise<string> {
  const [{ id }] = await db().insert(scrapers).values(scraper).returning({ id: scrapers.id });
  return id;
}

/** resetMark: the search changed, so its next run only saves (no Telegram flood) */
export async function update(id: string, fields: Partial<ScraperInput & { position: number }>, resetMark = false) {
  await db()
    .update(scrapers)
    .set({ ...fields, ...(resetMark ? { mark: null } : {}), updatedAt: new Date().toISOString() })
    .where(eq(scrapers.id, id));
}

export async function remove(id: string) {
  await db().delete(scrapers).where(eq(scrapers.id, id));
}

export type ScraperOutcome = {
  ok: boolean;
  found: number;
  kept: number;
  added: number;
  error: string | null;
  ms: number;
  mark: number | null;
};

/** What its last run did, and the new watermark. */
export async function saveOutcome(id: string, outcome: ScraperOutcome) {
  await db()
    .update(scrapers)
    .set({
      mark: outcome.mark,
      lastRunAt: new Date().toISOString(),
      lastStatus: outcome.ok ? 'ok' : 'error',
      lastFound: outcome.found,
      lastKept: outcome.kept,
      lastNew: outcome.added,
      lastError: outcome.error,
      lastMs: outcome.ms,
    })
    .where(eq(scrapers.id, id));
}
