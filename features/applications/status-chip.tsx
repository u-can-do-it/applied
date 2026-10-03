import { stageOf, outcomeLabel, type StageId, type OutcomeId } from '@/lib/stages';
import { Badge } from '@/components/ui/badge';

// an outcome's colour as its badge
const OUTCOME_BADGE = {
  pending: 'brand',
  passed: 'success',
  failed: 'danger',
  ghosted: 'dashed',
  pool: 'pool',
} as const satisfies Record<OutcomeId, string>;

export function StatusChip({ stage, outcome }: { stage: StageId; outcome: OutcomeId }) {
  return (
    // a long status ("Screening / test · In progress") takes two lines on a phone rather than the title's room
    <Badge
      variant={OUTCOME_BADGE[outcome]}
      className="font-normal max-[560px]:h-auto max-[560px]:rounded-[10px] max-[560px]:text-right max-[560px]:whitespace-normal"
    >
      {stageOf(stage).short} · {outcomeLabel(stage, outcome)}
    </Badge>
  );
}
