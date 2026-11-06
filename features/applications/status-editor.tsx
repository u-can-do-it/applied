'use client';

import { CheckIcon } from 'lucide-react';
import { reached, STAGES, outcomeHint, outcomesFor, TALENT_POOL, type StageId, type OutcomeId } from '@/lib/stages';
import { cn } from '@/lib/shared/cn';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { RENT_A_DEV } from '@/features/offers/rent-a-dev';
import { StatusTimeline } from './status-timeline';
import type { Shown } from './use-application';
import { Hint } from '@/components/hint';

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
  withdrawn: 'data-[state=on]:border-foreground data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground',
};

/**
 * An application's status: its stage, that stage's outcome, and how it got there; after the outcomes,
 * its marks, each turned around by a click: whether it's a Rent-a-dev job (`rentADev`, your call or
 * else the AI's) and whether it's in the talent pool (app.talentPool).
 */
export function StatusEditor({
  app,
  busy,
  rentADev,
  onStatus,
  onRentADev,
  onTalentPool,
  onRemoveStep,
}: {
  app: Shown;
  busy: boolean;
  rentADev: boolean;
  onStatus: (stage: StageId, outcome: OutcomeId) => void;
  onRentADev: (rentADev: boolean) => void;
  onTalentPool: (talentPool: boolean) => void;
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
          <Hint
            key={stage.id}
            wrap
            className="inline-flex"
            text={'hint' in stage ? `${stage.label}: ${stage.hint}` : stage.label}
          >
            <ToggleGroupItem
              value={stage.id}
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
          </Hint>
        ))}
      </ToggleGroup>
      <div className="flex flex-wrap items-center gap-1.5">
        <ToggleGroup
          type="single"
          spacing={1.5}
          className="flex-wrap"
          aria-label="Outcome of this stage"
          value={app.outcome}
          onValueChange={(outcome) => outcome && onStatus(app.stage, outcome as OutcomeId)}
        >
          {outcomesFor(app.stage).map((outcome) => {
            const hint = outcomeHint(outcome.id);
            return (
              <Hint
                key={outcome.id}
                wrap
                className="inline-flex"
                text={hint ? `${outcome.label}: ${hint}` : outcome.label}
              >
                <ToggleGroupItem value={outcome.id} className={cn(STEP, OUTCOME_ON[outcome.id])}>
                  {outcome.label}
                </ToggleGroupItem>
              </Hint>
            );
          })}
        </ToggleGroup>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Hint wrap className="inline-flex" text={RENT_A_DEV.title}>
          <Toggle
            pressed={rentADev}
            onPressedChange={onRentADev}
            className={cn(
              STEP,
              'data-[state=on]:border-warning data-[state=on]:bg-warning-soft data-[state=on]:text-warning-strong',
            )}
          >
            {RENT_A_DEV.label}
          </Toggle>
        </Hint>
        <Hint wrap className="inline-flex" text={TALENT_POOL.hint}>
          <Toggle
            pressed={app.talentPool}
            onPressedChange={onTalentPool}
            className={cn(
              STEP,
              'data-[state=on]:border-pool data-[state=on]:bg-pool data-[state=on]:text-pool-foreground',
            )}
          >
            {TALENT_POOL.label}
          </Toggle>
        </Hint>
      </div>
      {app.history.length > 0 && <StatusTimeline history={app.history} busy={busy} onRemove={onRemoveStep} />}
    </section>
  );
}
