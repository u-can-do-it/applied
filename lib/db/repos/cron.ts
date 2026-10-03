import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { message } from '../../shared/errors';
import { db } from '../client';

// Supabase Cron (pg_cron + pg_net): the job that calls /api/cron/scrape. The public.jw_cron_*
// functions run as their owner (security definer), who may use the cron schema.

export type CronStatus = {
  available: boolean;
  scheduled?: boolean;
  schedule?: string;
  active?: boolean;
  url?: string;
  lastStatus?: number | null;
  lastError?: string | null;
  lastAt?: string | null;
  /** what the app answered: "started", "skipped" (lastReason says why), "done" */
  lastResult?: string | null;
  lastReason?: string | null;
};

// A failure is rethrown as a new Error with the database's words only: the one drizzle-orm throws
// carries the query's values, and jw_cron_connect's are the app's URL and the cron secret. Nothing
// that logs or stores the error then can leak them.
async function call<T>(query: SQL): Promise<T> {
  try {
    const [{ result }] = await db().execute<{ result: T }>(sql`select ${query} as result`);
    return result;
  } catch (error) {
    throw new Error(message(error));
  }
}

export const status = () => call<CronStatus>(sql`public.jw_cron_status()`);

/** Schedules the job (or replaces it): 'ok', or why it can't. */
export const connect = (endpoint: string, secret: string, schedule: string, active: boolean) =>
  call<string>(sql`public.jw_cron_connect(${endpoint}::text, ${secret}::text, ${schedule}::text, ${active}::boolean)`);

/** The connected job's schedule and on/off: 'ok', or 'not connected'. */
export const reschedule = (schedule: string, active: boolean) =>
  call<string>(sql`public.jw_cron_reschedule(${schedule}::text, ${active}::boolean)`);

export const disconnect = () => call<string>(sql`public.jw_cron_disconnect()`);
