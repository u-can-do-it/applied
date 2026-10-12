import 'server-only';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { keywordMisses } from '../schema';

// The offers whose ad was read for the keywords and named none (lib/listings/pipeline/ad-check.ts). Two
// weeks of them: longer than a search's {since} looks back, so an offer still found is still here.

const KEEP_MS = 14 * 86400_000;

/** Of these offers of a board, the ones whose ad named none of these keywords (`keywords`: their key). */
export async function find(src: string, ids: string[], keywords: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db()
    .select({ id: keywordMisses.id })
    .from(keywordMisses)
    .where(and(eq(keywordMisses.src, src), inArray(keywordMisses.id, ids), eq(keywordMisses.keywords, keywords)));
  return new Set(rows.map((row) => row.id));
}

/** Remembers these offers' ads as naming none of the keywords, and forgets what's older than two weeks. */
export async function save(src: string, ids: string[], keywords: string) {
  if (ids.length)
    await db()
      .insert(keywordMisses)
      .values([...new Set(ids)].map((id) => ({ src, id, keywords }))) // an upsert can't touch a row twice
      // read again for other keywords: these are the ones it's a miss for now
      .onConflictDoUpdate({
        target: [keywordMisses.src, keywordMisses.id],
        set: { keywords, checkedAt: sql`now()` },
      });
  await db()
    .delete(keywordMisses)
    .where(lt(keywordMisses.checkedAt, new Date(Date.now() - KEEP_MS).toISOString()));
}
