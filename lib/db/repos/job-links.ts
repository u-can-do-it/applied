import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { jobLinks } from '../schema';

// AI-confirmed duplicates whose keys differ: every key of a merged group points at the group's key.

/** The job a key belongs to: the group it was merged into, or itself. */
export async function groupOf(dupKey: string): Promise<string> {
  const link = first(await db().select({ jobKey: jobLinks.jobKey }).from(jobLinks).where(eq(jobLinks.dupKey, dupKey)));
  return link?.jobKey ?? dupKey;
}

/**
 * Makes `alias`'s group part of `keep`'s, with the verdicts and the application following
 * (public.jw_merge_jobs: several tables in one statement's transaction).
 */
export async function mergeJobs(keep: string, alias: string) {
  await db().execute(sql`select public.jw_merge_jobs(${keep}::text, ${alias}::text)`);
}
