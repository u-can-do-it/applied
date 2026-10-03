'use client';

import { XIcon } from 'lucide-react';
import { GHOST_AFTER_DAYS, stageOf, outcomeLabel, type HistoryEntry, type OutcomeId } from '@/lib/stages';
import { Button } from '@/components/ui/button';
import { useDay } from './use-day';

// an outcome's colour as its text in the history
const OUTCOME_TEXT: Record<OutcomeId, string> = {
  pending: 'text-muted-foreground',
  passed: 'text-success',
  failed: 'text-destructive',
  ghosted: 'text-muted-foreground',
  pool: 'text-pool',
};

/**
 * The status history, newest first. The X takes a step away with the ones after it (above it here),
 * not the first one: applying.
 */
export function StatusTimeline({
  history,
  busy,
  onRemove,
}: {
  history: HistoryEntry[];
  busy: boolean;
  onRemove: (i: number) => void;
}) {
  const day = useDay();
  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-muted-foreground" aria-label="History">
      {history
        .map((step, i) => ({ step, i }))
        .reverse()
        .map(({ step, i }) => {
          const later = history.length - 1 - i;
          return (
            <li
              key={`${step.at}|${step.stage}|${step.state}|${i}`}
              // what an X takes away, struck through while it's pointed at: its step and the later
              // ones, listed above it
              className="group/step flex flex-wrap items-center gap-1 [&>:not(button)]:decoration-destructive has-[button:hover:not(:disabled)]:[&>:not(button)]:line-through has-[~li_button:hover:not(:disabled)]:[&>:not(button)]:line-through"
            >
              <time dateTime={step.at} className="mr-1 tabular-nums">
                {day(step.at)}
              </time>
              <span>{stageOf(step.stage).label} ·</span>
              <span className={OUTCOME_TEXT[step.state]}>{outcomeLabel(step.stage, step.state)}</span>
              {step.auto && <span title={`No news for ${GHOST_AFTER_DAYS} days`}>(auto)</span>}
              {i > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  // shown on the step under the pointer (or with the keyboard); a touch screen can't
                  // hover: always there
                  className="h-5 text-muted-foreground transition-opacity hover:bg-background hover:text-destructive focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/step:opacity-100 pointer-fine:focus-visible:opacity-100"
                  title={later ? 'Remove this step and the ones after it' : 'Remove this step (clicked by mistake)'}
                  aria-label={`Remove “${stageOf(step.stage).label} · ${outcomeLabel(step.stage, step.state)}” of ${day(step.at)}${later ? ` and the ${later} after it` : ''}`}
                  disabled={busy}
                  onClick={() => onRemove(i)}
                >
                  <XIcon />
                </Button>
              )}
            </li>
          );
        })}
    </ol>
  );
}
