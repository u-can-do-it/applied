import 'server-only';
import { after } from 'next/server';
import { continueRun, latestRun, needsWorker, type AiRun } from '@/lib/ai/runs';
import { isPaused } from '@/lib/ai/run-view';
import type { Profile } from '@/lib/ai/profiles';
import type { RunInfo } from './ai-run-card';

/** The run as its card shows it, for the profile it belongs to. */
export function runInfo(run: AiRun, active: Profile): RunInfo {
  return {
    id: run.id,
    label: run.label,
    status: run.status,
    phase: run.phase,
    lockUntil: run.lockUntil,
    pairsChecked: run.pairsChecked,
    merged: run.merged,
    total: run.total,
    done: run.done,
    error: run.error,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    paused: isPaused(run, Date.now()),
    profile: { name: active.name, version: run.version },
    stale: active.version !== run.version,
  };
}

/**
 * The active profile's latest run; an open one no slice works on (out of time, or waiting for the
 * cron) is continued after this response.
 */
export async function activeRun(active: Profile): Promise<RunInfo | null> {
  const run = await latestRun(active.id);
  if (run && needsWorker(run)) after(() => continueRun(run.id));
  return run && runInfo(run, active);
}
