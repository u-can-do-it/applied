import 'server-only';
import { and, desc, eq, getTableColumns, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { SavedDetails } from '../../applications';
import type { OutcomeId, StageId } from '../../stages';
import { db } from '../client';
import { first } from '../rows';
import { aiVerdicts, applications, type ApplicationRow, type NewApplicationRow } from '../schema';
import type { Fit } from './ai-verdicts';

// Jobs you applied to: one row per job (its id in dup_key), with a snapshot of the ad.

/** An application as the list has it: everything but the ad text. */
export type Application = Omit<ApplicationRow, 'content'>;
export type ApplicationWithContent = ApplicationRow;
/** …and a profile version's verdict on the job (null: it hasn't judged it). */
export type ListedApplication = Application & { fit: Fit | null };

const { content: _content, ...listColumns } = getTableColumns(applications);

/** Newest first, each with the verdict of `judgedBy` (a profile version), when it has one. */
export async function list(judgedBy?: { id: string; version: number }): Promise<ListedApplication[]> {
  if (!judgedBy) {
    const rows = await db().select(listColumns).from(applications).orderBy(desc(applications.appliedAt));
    return rows.map((app) => ({ ...app, fit: null }));
  }
  const rows = await db()
    .select({
      ...listColumns,
      match: aiVerdicts.match,
      score: aiVerdicts.score,
      summary: aiVerdicts.summary,
      checks: aiVerdicts.checks,
      hadDescription: aiVerdicts.hadDescription,
      verdictBodyLeasing: aiVerdicts.bodyLeasing,
    })
    .from(applications)
    .leftJoin(
      aiVerdicts,
      and(
        eq(aiVerdicts.jobId, applications.jobId),
        eq(aiVerdicts.profileId, judgedBy.id),
        eq(aiVerdicts.version, judgedBy.version),
      ),
    )
    .orderBy(desc(applications.appliedAt));
  // a job it hasn't judged: the left join's nulls
  return rows.map(({ match, score, summary, checks, hadDescription, verdictBodyLeasing, ...app }) => ({
    ...app,
    fit:
      match === null || score === null
        ? null
        : {
            match,
            score,
            summary,
            checks: checks ?? [],
            hadDescription: Boolean(hadDescription),
            bodyLeasing: verdictBodyLeasing,
          },
  }));
}

export async function get(jobId: string): Promise<ApplicationWithContent | null> {
  return first(await db().select().from(applications).where(eq(applications.jobId, jobId)));
}

export async function insert(row: NewApplicationRow) {
  await db().insert(applications).values(row);
}

/** Inserts it unless the job already has an application (that one stays as it is). */
export async function insertUnlessThere(row: NewApplicationRow) {
  await db().insert(applications).values(row).onConflictDoNothing({ target: applications.jobId });
}

export async function patch(jobId: string, fields: Partial<NewApplicationRow>) {
  await db().update(applications).set(fields).where(eq(applications.jobId, jobId));
}

export async function remove(jobId: string) {
  await db().delete(applications).where(eq(applications.jobId, jobId));
}

// a status change as a history entry, built from the same statement's now() (the outcome is stored as `state`)
const entry = (stage: SQL, outcome: SQL, auto = false) =>
  sql`jsonb_build_array(jsonb_build_object('stage', ${stage}, 'state', ${outcome}, 'at', now()${auto ? sql`, 'auto', true` : sql``}))`;

/** One status change, appended to the history in the same statement. */
export async function setStatus(jobId: string, stage: StageId, outcome: OutcomeId) {
  await db()
    .update(applications)
    .set({
      stage,
      outcome,
      stageUpdatedAt: sql`now()`,
      history: sql`${applications.history} || ${entry(sql`${stage}::text`, sql`${outcome}::text`)}`,
    })
    .where(eq(applications.jobId, jobId));
}

/**
 * No news for `days` since the last status change (or since applying): ghosted, at the same
 * stage. Only what still waits for an answer: in progress, or passed and waiting for the next step
 * (not rejected, not the talent pool: those are answers). Never an offer (the decision is yours).
 * The history entry says it was automatic, to take it back. Returns how many it changed.
 */
export async function ghostStale(days: number): Promise<number> {
  const ghosted = await db()
    .update(applications)
    .set({
      outcome: 'ghosted',
      stageUpdatedAt: sql`now()`,
      history: sql`${applications.history} || ${entry(sql`${applications.stage}`, sql`'ghosted'::text`, true)}`,
    })
    .where(
      and(
        inArray(applications.outcome, ['pending', 'passed']),
        ne(applications.stage, 'offer'),
        lt(
          sql`coalesce(${applications.stageUpdatedAt}, ${applications.appliedAt})`,
          sql`now() - make_interval(days => ${days}::int)`,
        ),
      ),
    )
    .returning({ jobId: applications.jobId });
  return ghosted.length;
}

/**
 * Saves the note if nobody changed it since `seenAt` (its note_updated_at as read; null = never
 * written). Answers with the new note_updated_at, or null when it had changed (or the
 * application is gone): then nothing was written.
 */
export async function setNoteIfUnchanged(jobId: string, note: string | null, seenAt: string | null) {
  const saved = await db()
    .update(applications)
    .set({ note, noteUpdatedAt: sql`now()` })
    .where(
      and(
        eq(applications.jobId, jobId),
        seenAt === null ? isNull(applications.noteUpdatedAt) : eq(applications.noteUpdatedAt, seenAt),
      ),
    )
    .returning({ noteUpdatedAt: applications.noteUpdatedAt });
  return first(saved)?.noteUpdatedAt ?? null;
}

/** Applications with an ad text not yet read for its details (details.textRead, details.skills), newest first. */
export function withUnreadText(limit: number) {
  return db()
    .select({
      jobId: applications.jobId,
      url: applications.url,
      title: applications.title,
      content: applications.content,
      details: applications.details,
    })
    .from(applications)
    .where(
      and(
        eq(applications.contentStatus, 'ok'),
        sql`${applications.content} is not null`,
        or(sql`${applications.details}->>'textRead' is null`, sql`${applications.details}->'skills' is null`),
      ),
    )
    .orderBy(desc(applications.appliedAt))
    .limit(limit);
}

/** Sets the details if they're still `before` (nothing saved them meanwhile). Whether it did. */
export async function setDetailsIfUnchanged(jobId: string, before: SavedDetails | null, details: SavedDetails) {
  const saved = await db()
    .update(applications)
    .set({ details })
    .where(
      and(
        eq(applications.jobId, jobId),
        before ? sql`${applications.details} = ${JSON.stringify(before)}::jsonb` : isNull(applications.details),
      ),
    )
    .returning({ jobId: applications.jobId });
  return saved.length > 0;
}
