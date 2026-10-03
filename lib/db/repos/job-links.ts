import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { jobLinks } from '../schema';

// AI-confirmed duplicates whose title keys differ: every title key of a merged job points at the job's id.

/** The job a title key belongs to: the one it was merged into, or its own (a job's id is one of its title keys). */
export async function jobIdOf(titleKey: string): Promise<string> {
  const link = first(
    await db().select({ jobId: jobLinks.jobId }).from(jobLinks).where(eq(jobLinks.titleKey, titleKey)),
  );
  return link?.jobId ?? titleKey;
}

/**
 * Makes job `alias` part of job `keep`, with the verdicts and the application following
 * (public.jw_merge_jobs: several tables in one statement's transaction).
 */
export async function mergeJobs(keep: string, alias: string) {
  await db().execute(sql`select public.jw_merge_jobs(${keep}::text, ${alias}::text)`);
}
