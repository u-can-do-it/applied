import 'server-only';
import { sql } from 'drizzle-orm';
import type { JobDetails } from '../../ads/details';
import { db } from '../client';
import { newestFirst } from './offer-order';
import { matching, type JobFilter } from './offers';
import { offersUnique } from '../schema';

// What the offers' search looks through (lib/shared/search.ts ranks it, lib/jobs.ts lists what it found):
// every job the rest of the filter leaves (archived or not: the list counts the archived ones it finds
// too), newest first.

type SearchFilter = Omit<JobFilter, 'ranked' | 'byDate' | 'byFit' | 'archived'>;

/** Each job's title and company. */
export function searchable(filter: SearchFilter) {
  return db()
    .select({ jobId: offersUnique.jobId, title: offersUnique.title, company: offersUnique.company })
    .from(offersUnique)
    .where(matching(filter))
    .orderBy(...newestFirst);
}

/** One of a job's offers' ads, as saved: its text and what the board said besides. */
export type SavedAd = { description: string | null; details: JobDetails | null };

/**
 * searchable(), with the rest a search of everything reads: your note on the job (the application's,
 * once applied to) and its offers' ads (none read: null). The note tables' job ids go by other names in
 * there, so the job's own (unqualified "dup_key") isn't taken for theirs.
 */
export function searchableAll(filter: SearchFilter) {
  return db()
    .select({
      jobId: offersUnique.jobId,
      title: offersUnique.title,
      company: offersUnique.company,
      note: sql<string | null>`coalesce(
        (select a.note from (select dup_key as app_id, note from public.applications) a
          where a.app_id = ${offersUnique.jobId}),
        (select n.note from (select dup_key as note_id, note from public.job_notes) n
          where n.note_id = ${offersUnique.jobId}))`,
      ads: sql<SavedAd[] | null>`(select json_agg(json_build_object('description', d.description, 'details', d.details))
        from public.offer_details d
        join jsonb_to_recordset(${offersUnique.offers}) c(src text, id text) on d.src = c.src and d.id = c.id)`,
    })
    .from(offersUnique)
    .where(matching(filter))
    .orderBy(...newestFirst);
}
