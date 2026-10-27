'use client';

import { createContext, use, useEffect, useState, useTransition, type ReactNode } from 'react';
import { CombineIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/shared/cn';
import { mergeJobsAction } from './actions';
import { ON_HOVER } from './offer-actions';

// "Same job as…": you merge two jobs the title key and the AI didn't, as the AI's duplicate check would.
// The row's button picks the job; a bar at the bottom of the window says so while you scroll, page or
// search for the other one (the pick outlives the list's navigation), whose row then shows "Same job".
// A click on that asks first, with both jobs side by side: a merge can't be undone. Escape or the bar's
// Cancel drops the pick.

/** A job as the merge's question shows it. */
export type MergeJob = {
  jobId: string;
  title: string;
  company: string | null;
  firstSeen: string;
  /** "Mon 27.10.2026, 07:10", the app's time zone */
  when: string;
  /** its boards' names */
  boards: string[];
  applied: boolean;
};

type Merge = { picked: MergeJob | null; pick: (job: MergeJob | null) => void };
const MergeContext = createContext<Merge | null>(null);

/** Around the offers' controls and list: the job picked first, and the bar while there is one. */
export function MergeProvider({ children }: { children: ReactNode }) {
  const [picked, pick] = useState<MergeJob | null>(null);
  useEffect(() => {
    if (!picked) return;
    // a dialog's Escape closes the dialog only (it prevents the default)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) pick(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picked]);
  return (
    <MergeContext value={{ picked, pick }}>
      {children}
      {picked && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-[640px] items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-lg"
        >
          <CombineIcon className="shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            Pick the job that’s the same as <strong className="font-semibold">{picked.title}</strong>
            {picked.company && <> at {picked.company}</>}
            <span className="text-muted-foreground max-[560px]:hidden"> · search or page for it · Esc cancels</span>
          </span>
          <Button type="button" variant="outline" size="xs" onClick={() => pick(null)}>
            Cancel
          </Button>
        </div>
      )}
    </MergeContext>
  );
}

/** The earlier of the two stays (as the AI's merges keep it); on a tie, the smaller id. */
const keepFirst = (a: MergeJob, b: MergeJob): [keep: MergeJob, alias: MergeJob] => {
  const [seenA, seenB] = [Date.parse(a.firstSeen), Date.parse(b.firstSeen)];
  return seenA < seenB || (seenA === seenB && a.jobId < b.jobId) ? [a, b] : [b, a];
};

/** One job in the question: its title, then company, day and boards. */
function JobLine({ label, job }: { label: string; job: MergeJob }) {
  return (
    <div className="rounded-lg border px-3 py-2 text-sm">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="font-semibold [overflow-wrap:anywhere]">{job.title}</div>
      <div className="text-[13px] text-muted-foreground">
        {[job.company, job.when, job.boards.join(', '), job.applied && 'applied'].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

/**
 * The row's merge button: "Same job as…" (on the row's hover, like archive) picks this job; while another
 * is picked, "Same job" (always shown) merges this one with it; on the picked row, × drops the pick. The
 * picked row is outlined (`data-merge-picked`: OfferRow's `has-` class).
 */
export function MergeButton({ job }: { job: MergeJob }) {
  const merge = use(MergeContext);
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  if (!merge) return null;
  const { picked, pick } = merge;

  if (!picked)
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn('rounded-full text-muted-foreground', ON_HOVER)}
        onClick={() => pick(job)}
        aria-label={`Same job as…: merge ${job.title} with another job`}
        title="Same job as…: pick the job this one duplicates, to merge them"
      >
        <CombineIcon />
      </Button>
    );

  if (picked.jobId === job.jobId)
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-full text-muted-foreground"
        onClick={() => pick(null)}
        aria-label="Cancel the merge"
        title="Cancel: pick no job"
        data-merge-picked
      >
        <XIcon />
      </Button>
    );

  const sameJob = async () => {
    const [keep, alias] = keepFirst(picked, job);
    const yes = await confirm({
      title: 'Merge into one job?',
      description:
        'The later one becomes part of the earlier one, listed once with both jobs’ boards. Its application, fit, ' +
        'note, seen and archived marks move to it; where both have one, the earlier one’s stays (and gets the ' +
        'other’s note added). The AI won’t be asked about them again. This can’t be undone.',
      details: (
        <div className="grid gap-2">
          <JobLine label="Stays" job={keep} />
          <JobLine label="Merged into it" job={alias} />
        </div>
      ),
      action: 'Merge',
    });
    if (!yes) return;
    start(async () => {
      const res = await mergeJobsAction({ jobId: picked.jobId, sameAs: job.jobId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      pick(null);
      toast.success(`Merged “${res.data.merged}” into “${res.data.kept}”`);
    });
  };

  return (
    <Button
      type="button"
      variant="brand"
      size="xs"
      className="rounded-full"
      disabled={pending}
      onClick={() => void sameJob()}
      title={`The same job as “${picked.title}”: merge them`}
    >
      <CombineIcon /> Same job
    </Button>
  );
}
