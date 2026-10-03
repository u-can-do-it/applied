'use client';

import { startTransition, useRef, useState, useTransition } from 'react';
import { CheckIcon, ChevronDownIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useRefreshWhile } from '@/components/use-refresh-while';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/shared/cn';
import { startRunAction } from './actions';
import { ProfileDialog, type ProfileOption } from './profile-dialog';

type RunInfo = {
  id: string;
  label: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  phase: 'dedup' | 'assess';
  pairsChecked: number;
  merged: number;
  total: number;
  done: number;
  error: string | null;
  finishedAt: string | null;
  stale: boolean; // belongs to an older version of the profile
};

const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export function AiControls({
  profiles,
  activeId,
  run,
  todayNew,
  range,
  aiConfigured,
  models,
}: {
  profiles: ProfileOption[];
  activeId: string | null;
  run: RunInfo | null;
  todayNew: number;
  range: { days: string; from: string; to: string; label: string; newCount: number } | null;
  aiConfigured: boolean;
  models: { assess: { model: string; effort: string }; dedup: { model: string; effort: string } };
}) {
  const dialog = useRef<{ open: () => void }>(null);
  const [starting, start] = useTransition();
  const [error, setError] = useState<string | null>(null); // why a run didn't start
  const active = profiles.find((profile) => profile.id === activeId) ?? null;
  const usable = Boolean(active && (active.prompt.trim() || active.fileName));
  const running = run?.status === 'running' && !run.stale;

  // while a run is open, refresh every 4 s so new verdicts show up and the next slice gets started
  // (the page does that), also when one refresh brings no progress
  useRefreshWhile(running, 4000, run);

  const runFor = (input: { days?: string; from?: string; to?: string }) => {
    if (!activeId) return; // the buttons show only with a usable profile
    setError(null);
    start(async () => {
      const res = await startRunAction({ profileId: activeId, ...input });
      // "Checking 12 offer(s)…" is what the progress card shows; only "nothing to check" needs saying
      if (!res.ok) startTransition(() => setError(res.error));
      else if (!res.data.started) toast.info(res.data.message);
    });
  };

  const disabled = !usable || !aiConfigured || running || starting;
  const doneShown = run ? Math.min(run.done, run.total) : 0;
  const pct = run && run.total ? Math.round((doneShown / run.total) * 100) : 0;

  const busy = running || starting || undefined;

  return (
    <div className="mb-3 flex min-h-9 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="brand" onClick={() => dialog.current?.open()}>
          <SparklesIcon /> {active ? active.name : 'Profile'} <ChevronDownIcon />
        </Button>

        {usable && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || todayNew === 0}
            aria-busy={busy}
            onClick={() => runFor({ days: '1' })}
          >
            {todayNew === 0 ? (
              <>
                <CheckIcon /> Today checked
              </>
            ) : (
              `Check today · ${todayNew} new`
            )}
          </Button>
        )}

        {usable && range && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || range.newCount === 0}
            aria-busy={busy}
            onClick={() =>
              runFor({ days: range.days || undefined, from: range.from || undefined, to: range.to || undefined })
            }
            title="Uses the dates picked in the filter below"
          >
            {range.newCount === 0 ? (
              <>
                <CheckIcon /> {range.label} checked
              </>
            ) : (
              `Check ${range.label} · ${range.newCount} new`
            )}
          </Button>
        )}
      </div>

      {!aiConfigured && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>OPENAI_API_KEY is not set on the server.</AlertTitle>
        </Alert>
      )}
      {error && !running && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle className="font-normal">{error}</AlertTitle>
        </Alert>
      )}
      {!active && (
        <p className="m-0 text-xs text-muted-foreground">
          Create a profile: what you&apos;re looking for, plus your CV.
        </p>
      )}

      {running ? (
        <Card size="sm" className="mt-1 gap-0 py-2.5 text-[13px]" role="status">
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="size-[7px] animate-pulse rounded-full bg-brand" aria-hidden="true" />
              {run.phase === 'dedup' ? (
                <span>
                  Looking for duplicates in {run.label}… {run.pairsChecked} pair{run.pairsChecked === 1 ? '' : 's'}{' '}
                  checked
                  {run.merged > 0 && <> · {run.merged} merged</>}
                </span>
              ) : (
                <span>
                  Checking {run.label}: {doneShown}/{run.total}
                  {run.merged > 0 && <span className="text-muted-foreground"> · {run.merged} duplicates merged</span>}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {run.phase === 'dedup'
                  ? `${models.dedup.model} · ${models.dedup.effort}`
                  : `${models.assess.model} · ${models.assess.effort}`}
              </span>
            </div>
            {run.phase === 'assess' && (
              <Progress
                value={pct}
                aria-label={`Checked ${doneShown} of ${run.total}`}
                className="h-1.5 [&>[data-slot=progress-indicator]]:bg-brand"
              />
            )}
          </CardContent>
        </Card>
      ) : run && !run.stale && run.finishedAt ? (
        <p className={cn('m-0 text-xs text-muted-foreground', run.status === 'failed' && 'text-destructive')}>
          Last run: {run.label} · {doneShown} checked
          {run.merged > 0 && (
            <>
              {' '}
              · {run.merged} duplicate{run.merged === 1 ? '' : 's'} merged
            </>
          )}{' '}
          · {/* "3 min ago" depends on the clock: server and browser may differ by a minute, the browser wins */}
          <time dateTime={run.finishedAt} suppressHydrationWarning>
            {ago(run.finishedAt)}
          </time>
          {run.status === 'failed' && <> · failed: {run.error}</>}
          {run.status === 'cancelled' && <> · {run.error}</>}
          {run.status === 'done' && run.error && <> · {run.error}</>}
        </p>
      ) : null}

      <ProfileDialog ref={dialog} profiles={profiles} activeId={activeId} />
    </div>
  );
}
