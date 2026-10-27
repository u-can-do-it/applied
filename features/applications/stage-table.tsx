import { STAGES, OUTCOMES, outcomeHeading, outcomeLabel, outcomesFor, type Stats } from '@/lib/stages';
import { cn } from '@/lib/shared/cn';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cellId, TOTAL, TOTAL_HEADING } from './status-filter';

/**
 * How far they got: each application in every stage it got to, by how it went there (Total: all of
 * them), so Passed at a stage is the ones that went on. Each count a filter (its id: cellId).
 */
export function StageTable({
  byStage,
  isOn,
  onPick,
}: {
  byStage: Stats['byStage'];
  isOn: (id: string) => 'true' | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <details className="overflow-x-auto">
      <summary className="cursor-pointer text-[13px] text-muted-foreground">How far they got</summary>
      <Table className="mt-1.5 text-[13px] tabular-nums">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              scope="col"
              className="h-auto px-2 py-1.5 text-xs font-medium text-muted-foreground max-[480px]:px-1"
            >
              Stage
            </TableHead>
            {[TOTAL_HEADING, ...OUTCOMES.map((outcome) => outcomeHeading(outcome.id))].map((heading) => (
              <TableHead
                key={heading}
                scope="col"
                className="h-auto px-2 py-1.5 text-right text-xs font-medium text-muted-foreground max-[480px]:px-1"
              >
                {heading}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b">
          {STAGES.map((stage) => (
            <TableRow key={stage.id} className="hover:bg-transparent">
              <TableHead scope="row" className="h-auto px-2 py-1.5 font-medium max-[480px]:px-1">
                {stage.label}
              </TableHead>
              <TableCell className={cn(CELL, 'font-medium')}>
                <Count
                  count={OUTCOMES.reduce((sum, outcome) => sum + byStage[stage.id][outcome.id], 0)}
                  id={cellId(stage.id, TOTAL)}
                  isOn={isOn}
                  onPick={onPick}
                />
              </TableCell>
              {OUTCOMES.map((outcome) => {
                // an offer has its own outcomes (Received / Accepted / Rejected) and is never ghosted
                if (!outcomesFor(stage.id).some((possible) => possible.id === outcome.id))
                  return (
                    <TableCell key={outcome.id} className={cn(CELL, 'text-muted-foreground')}>
                      –
                    </TableCell>
                  );
                return (
                  <TableCell key={outcome.id} className={CELL}>
                    <Count
                      count={byStage[stage.id][outcome.id]}
                      id={cellId(stage.id, outcome.id)}
                      isOn={isOn}
                      onPick={onPick}
                    />
                    {stage.id === 'offer' && (
                      <small className="text-muted-foreground">
                        {' '}
                        {outcomeLabel(stage.id, outcome.id).toLowerCase()}
                      </small>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  );
}

const CELL = 'px-2 py-1.5 text-right max-[480px]:px-1';

function Count({
  count,
  id,
  isOn,
  onPick,
}: {
  count: number;
  id: string;
  isOn: (id: string) => 'true' | undefined;
  onPick: (id: string) => void;
}) {
  if (!count) return <span className="text-muted-foreground">0</span>;
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className="h-auto p-0 text-[13px] aria-pressed:underline"
      aria-pressed={isOn(id)}
      onClick={() => onPick(id)}
    >
      {count}
    </Button>
  );
}
