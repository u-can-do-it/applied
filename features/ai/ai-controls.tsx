'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useRef, useState, useTransition } from 'react';
import { CheckIcon, ChevronDownIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/shared/cn';
import { activeRunAction, startRunAction } from './actions';
import { ago } from '@/lib/shared/format';
import { AiRunCard, type RunInfo } from './ai-run-card';
import { loadProfileForm, ProfileDialog, type ProfileOption } from './profile-dialog';

type Range = { days: string; label: string; newCount: number };
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The profile button, "Check …" for each range (how many of its offers the active profile hasn't
 * judged), and the latest run. While a run is open its state is asked every 4 s (which also
 * continues a paused one); the panel is reloaded when it ends, for the new counts. The panel gives
 * this a new key for a new run.
 */
export function AiControls({
  profiles,
  activeId,
  run: loaded,
  ranges,
  aiConfigured,
  models,
}: {
  profiles: ProfileOption[];
  activeId: string | null;
  run: RunInfo | null;
  ranges: Range[];
  aiConfigured: boolean;
  models: { assess: { model: string; effort: string }; dedup: { model: string; effort: string } };
}) {
  const router = useRouter();
  const dialog = useRef<{ open: () => void }>(null);
  const [starting, start] = useTransition();
  const [error, setError] = useState<string | null>(null); // why a run didn't start
  const [run, setRun] = useState(loaded);
  const active = profiles.find((profile) => profile.id === activeId) ?? null;
  const usable = Boolean(active && (active.prompt.trim() || active.fileName));
  const running = run?.status === 'running' && !run.stale;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void activeRunAction().then((res) => {
        if (!res.ok) return; // a blip: the next one asks again
        setRun(res.data);
        if (res.data?.status !== 'running') router.refresh();
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [running, router]);

  const runFor = (days: string) => {
    if (!activeId) return; // the buttons show only with a usable profile
    setError(null);
    start(async () => {
      const res = await startRunAction({ profileId: activeId, days: days || undefined });
      // "Checking 12 offer(s)…" is what the progress card shows; only "nothing to check" needs saying
      if (!res.ok) startTransition(() => setError(res.error));
      else if (!res.data.started) toast.info(res.data.message);
    });
  };

  const disabled = !usable || !aiConfigured || running || starting;
  const doneShown = run ? Math.min(run.done, run.total) : 0;

  const busy = running || starting || undefined;

  return (
    <div className="mb-3 flex min-h-9 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="brand"
          onClick={() => dialog.current?.open()}
          onPointerEnter={() => void loadProfileForm()}
          onFocus={() => void loadProfileForm()}
        >
          <SparklesIcon /> {active ? active.name : 'Profile'} <ChevronDownIcon />
        </Button>

        {usable &&
          ranges.map((range) => (
            <Button
              key={range.days}
              type="button"
              variant="outline"
              disabled={disabled || range.newCount === 0}
              aria-busy={busy}
              onClick={() => runFor(range.days)}
            >
              {range.newCount === 0 ? (
                <>
                  <CheckIcon /> {capital(range.label)} checked
                </>
              ) : (
                `Check ${range.label} · ${range.newCount} new`
              )}
            </Button>
          ))}
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
        <AiRunCard
          run={run}
          continuesHere
          model={
            run.phase === 'dedup'
              ? `${models.dedup.model} · ${models.dedup.effort}`
              : `${models.assess.model} · ${models.assess.effort}`
          }
        />
      ) : run && !run.stale && run.finishedAt ? (
        <p className={cn('m-0 text-xs text-muted-foreground', run.status === 'failed' && 'text-destructive')}>
          Last run: {run.label} · Duplicates: {run.merged} merged · Assessment: {doneShown} checked ·{' '}
          {/* "3 min ago" depends on the clock: server and browser may differ by a minute, the browser wins */}
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
