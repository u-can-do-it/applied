'use client';

import Link from 'next/link';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CirclePauseIcon,
  CircleXIcon,
  SparklesIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/shared/cn';
import { runCard, type RunBadge, type RunFields, type StepStatus } from '@/lib/ai/run-view';
import { ago } from '@/lib/shared/format';

/** An AI run as the server read it. `paused`: open, and no slice working on it (isPaused). */
export type RunInfo = RunFields & {
  id: string;
  label: string;
  finishedAt: string | null;
  createdAt: string;
  paused: boolean;
  /** the profile, and the version the run belongs to */
  profile: { name: string; version: number };
  /** the profile has a newer version since: this run's verdicts no longer count */
  stale: boolean;
};

const STEP: Record<StepStatus, { icon: typeof CircleIcon; className: string; label: string }> = {
  waiting: { icon: CircleDashedIcon, className: 'text-muted-foreground', label: 'waiting' },
  active: { icon: CircleIcon, className: 'text-brand animate-pulse', label: 'working' },
  paused: { icon: CirclePauseIcon, className: 'text-warning', label: 'paused' },
  done: { icon: CircleCheckIcon, className: 'text-success', label: 'done' },
  stopped: { icon: CircleXIcon, className: 'text-destructive', label: 'stopped' },
};

const BADGE: Record<RunBadge, 'brand' | 'warning-soft' | 'success' | 'danger' | 'quiet'> = {
  Working: 'brand',
  Continuing: 'brand',
  Paused: 'warning-soft',
  Done: 'success',
  Failed: 'danger',
  Cancelled: 'quiet',
};

/**
 * Why a paused run waits, and what continues it (Activity; the AI tab continues it itself): Supabase
 * Cron's next call, or opening the AI tab now; selecting its profile there first (the AI tab only
 * continues the active profile's run); or nothing, since its profile changed and the next slice
 * cancels it.
 */
export type PausedHint = 'open' | 'select' | 'cancel';

/**
 * The two steps of an AI run (Duplicates → Assessment) with their counts, the profile version it
 * belongs to, and its state. `continuesHere`: the AI tab, which continues an open run (a paused one
 * shows as continuing); elsewhere a paused run says what continues it (`pausedHint`).
 */
export function AiRunCard({
  run,
  continuesHere = false,
  pausedHint = 'open',
  model,
}: {
  run: RunInfo;
  continuesHere?: boolean;
  pausedHint?: PausedHint;
  model?: string;
}) {
  const view = runCard(run, run.paused, continuesHere);
  const paused = view.state.step === 'paused';
  return (
    <Card size="sm" className="gap-0 py-2.5 text-[13px]" role={continuesHere ? 'status' : undefined}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SparklesIcon className="text-brand" aria-hidden="true" />
          <strong>{run.label}</strong>
          <span className="text-muted-foreground">
            “{run.profile.name}” v{run.profile.version}
            {run.stale && ' (an older version)'}
          </span>
          <Badge variant={BADGE[view.badge]}>{view.badge}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {/* "3 min ago" depends on the clock: server and browser may differ by a minute, the browser wins */}
            <time dateTime={run.finishedAt ?? run.createdAt} suppressHydrationWarning>
              {run.finishedAt ? `finished ${ago(run.finishedAt)}` : `started ${ago(run.createdAt)}`}
            </time>
            {model && view.state.step !== 'finished' && <> · {model}</>}
          </span>
        </div>
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0" aria-label="Steps">
          {view.steps.map((step, i) => {
            const { icon: Icon, className, label } = STEP[step.status];
            return (
              <li key={step.name} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span className="text-muted-foreground" aria-hidden="true">
                    →
                  </span>
                )}
                <Icon className={cn('size-3.5', className)} role="img" aria-label={label} />
                <span className={cn(step.status === 'waiting' && 'text-muted-foreground')}>
                  {i + 1}. {step.name}
                </span>
                <span className="text-muted-foreground">{step.counts}</span>
              </li>
            );
          })}
        </ol>
        {view.percent !== null && (
          <Progress
            value={view.percent}
            aria-label={`Assessment ${view.percent}%`}
            className={cn(
              'h-1.5',
              paused ? '[&>[data-slot=progress-indicator]]:bg-warning' : '[&>[data-slot=progress-indicator]]:bg-brand',
            )}
          />
        )}
        {paused && (
          <p className="m-0 text-xs text-warning">
            {pausedHint === 'cancel' ? (
              'Paused — it will be cancelled at the next scheduled run: the profile changed since it started.'
            ) : (
              <>
                Paused — continues at the next scheduled run, or now if you{' '}
                {pausedHint === 'select' ? `select “${run.profile.name}” on the ` : 'open the '}
                <Link href="/ai" className="text-brand underline-offset-4 hover:underline">
                  AI filter page
                </Link>
                .
              </>
            )}
          </p>
        )}
        {view.note && (
          <p
            className={cn(
              'm-0 text-xs [overflow-wrap:anywhere]',
              view.badge === 'Done' ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {view.note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
