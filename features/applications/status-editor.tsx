'use client';

import { CheckIcon } from 'lucide-react';
import { reached, STAGES, outcomesFor, type StageId, type OutcomeId } from '@/lib/stages';
import { cn } from '@/lib/shared/cn';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { StatusTimeline } from './status-timeline';
import type { Shown } from './use-application';

/** a chip in the status editor (a stage, an outcome) */
const STEP =
  'h-auto min-w-0 rounded-full border bg-transparent px-2.5 py-1 text-[13px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground';
// an outcome's colour as its button, when picked (status-chip.tsx and status-timeline.tsx have the others)
const OUTCOME_ON: Record<OutcomeId, string> = {
  pending: 'data-[state=on]:border-brand data-[state=on]:bg-brand data-[state=on]:text-brand-foreground',
  passed: 'data-[state=on]:border-success data-[state=on]:bg-success data-[state=on]:text-success-foreground',
  failed:
    'data-[state=on]:border-destructive data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground',
  ghosted:
    'data-[state=on]:border-muted-foreground data-[state=on]:bg-muted-foreground data-[state=on]:text-background',
  pool: 'data-[state=on]:border-pool data-[state=on]:bg-pool data-[state=on]:text-pool-foreground',
};

/** An application's status: its stage, that stage's outcome, and how it got there. */
export function StatusEditor({
  app,
  busy,
  onStatus,
  onRemoveStep,
}: {
  app: Shown;
  busy: boolean;
  onStatus: (stage: StageId, outcome: OutcomeId) => void;
  onRemoveStep: (i: number) => void;
}) {
  const been = reached(app);
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border px-3 py-2.5"
      aria-label="Status"
      aria-busy={busy || undefined}
    >
      <ToggleGroup
        type="single"
        spacing={1.5}
        className="flex-wrap"
        aria-label="Stage"
        value={app.stage}
        // a new stage starts "in progress"; the current one clicked again keeps its outcome
        onValueChange={(stage) => stage && onStatus(stage as StageId, 'pending')}
      >
        {STAGES.map((stage) => (
          <ToggleGroupItem
            key={stage.id}
            value={stage.id}
            title={'hint' in stage ? `${stage.label}: ${stage.hint}` : stage.label}
            className={cn(
              STEP,
              been.has(stage.id) && 'text-foreground',
              'data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background',
            )}
          >
            {been.has(stage.id) && (
              <CheckIcon
                className="text-success group-data-[state=on]/toggle:text-current"
                role="img"
                aria-label="reached"
              />
            )}
            {stage.short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        type="single"
        spacing={1.5}
        className="flex-wrap"
        aria-label="Outcome of this stage"
        value={app.outcome}
        onValueChange={(outcome) => outcome && onStatus(app.stage, outcome as OutcomeId)}
      >
        {outcomesFor(app.stage).map((outcome) => (
          <ToggleGroupItem
            key={outcome.id}
            value={outcome.id}
            title={outcome.hint}
            className={cn(STEP, OUTCOME_ON[outcome.id])}
          >
            {outcome.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {app.history.length > 0 && <StatusTimeline history={app.history} busy={busy} onRemove={onRemoveStep} />}
    </section>
  );
}
