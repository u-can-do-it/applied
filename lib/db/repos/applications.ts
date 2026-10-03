import 'server-only';
import { and, desc, eq, getTableColumns, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { StageId, StateId } from '../../stages';
import { db } from '../client';
import { first } from '../rows';
import { applications, type ApplicationRow, type NewApplicationRow } from '../schema';

// Jobs you applied to: one row per job (dup_key), with a snapshot of the ad.

/** An application as the list has it: everything but the ad text. */
export type Application = Omit<ApplicationRow, 'content'>;
export type ApplicationWithContent = ApplicationRow;

const { content: _content, ...listColumns } = getTableColumns(applications);

/** Newest first. */
export function list(): Promise<Application[]> {
  return db().select(listColumns).from(applications).orderBy(desc(applications.appliedAt));
}

export async function get(key: string): Promise<ApplicationWithContent | null> {
  return first(await db().select().from(applications).where(eq(applications.dupKey, key)));
}

export async function insert(row: NewApplicationRow) {
  await db().insert(applications).values(row);
}

/** Inserts it unless the job already has an application (that one stays as it is). */
export async function insertUnlessThere(row: NewApplicationRow) {
  await db().insert(applications).values(row).onConflictDoNothing({ target: applications.dupKey });
}

export async function patch(key: string, fields: Partial<NewApplicationRow>) {
  await db().update(applications).set(fields).where(eq(applications.dupKey, key));
}

export async function remove(key: string) {
  await db().delete(applications).where(eq(applications.dupKey, key));
}

// a status change as a history entry, built from the same statement's now()
const entry = (stage: SQL, state: SQL, auto = false) =>
  sql`jsonb_build_array(jsonb_build_object('stage', ${stage}, 'state', ${state}, 'at', now()${auto ? sql`, 'auto', true` : sql``}))`;

/** One status change, appended to the history in the same statement. */
export async function setStatus(key: string, stage: StageId, state: StateId) {
  await db()
    .update(applications)
    .set({
      stage,
      stageState: state,
      stageUpdatedAt: sql`now()`,
      history: sql`${applications.history} || ${entry(sql`${stage}::text`, sql`${state}::text`)}`,
    })
    .where(eq(applications.dupKey, key));
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
      stageState: 'ghosted',
      stageUpdatedAt: sql`now()`,
      history: sql`${applications.history} || ${entry(sql`${applications.stage}`, sql`'ghosted'::text`, true)}`,
    })
    .where(
      and(
        inArray(applications.stageState, ['pending', 'passed']),
        ne(applications.stage, 'offer'),
        lt(
          sql`coalesce(${applications.stageUpdatedAt}, ${applications.appliedAt})`,
          sql`now() - make_interval(days => ${days}::int)`,
        ),
      ),
    )
    .returning({ key: applications.dupKey });
  return ghosted.length;
}

/**
 * Saves the note if nobody changed it since `seenAt` (its note_updated_at as read; null = never
 * written). Answers with the new note_updated_at, or null when it had changed (or the
 * application is gone): then nothing was written.
 */
export async function setNoteIfUnchanged(key: string, note: string | null, seenAt: string | null) {
  const saved = await db()
    .update(applications)
    .set({ note, noteUpdatedAt: sql`now()` })
    .where(
      and(
        eq(applications.dupKey, key),
        seenAt === null ? isNull(applications.noteUpdatedAt) : eq(applications.noteUpdatedAt, seenAt),
      ),
    )
    .returning({ noteUpdatedAt: applications.noteUpdatedAt });
  return first(saved)?.noteUpdatedAt ?? null;
}
