import { STAGES, OUTCOMES, outcomeHeading, outcomeLabel, outcomesFor, type Stats } from '@/lib/stages';
import { cn } from '@/lib/shared/cn';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cellId } from './status-filter';

/** Where they are now: stage × outcome, each count a filter (its id: cellId). */
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
      <summary className="cursor-pointer text-[13px] text-muted-foreground">Where they are now</summary>
      <Table className="mt-1.5 text-[13px] tabular-nums">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              scope="col"
              className="h-auto px-2 py-1.5 text-xs font-medium text-muted-foreground max-[480px]:px-1"
            >
              Stage
            </TableHead>
            {OUTCOMES.map((outcome) => (
              <TableHead
                key={outcome.id}
                scope="col"
                className="h-auto px-2 py-1.5 text-right text-xs font-medium text-muted-foreground max-[480px]:px-1"
              >
                {outcomeHeading(outcome.id)}
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
              {OUTCOMES.map((outcome) => {
                const count = byStage[stage.id][outcome.id];
                const id = cellId(stage.id, outcome.id);
                const cell = 'px-2 py-1.5 text-right max-[480px]:px-1';
                // an offer has its own outcomes (Received / Accepted / Rejected) and is never ghosted
                if (!outcomesFor(stage.id).some((possible) => possible.id === outcome.id))
                  return (
                    <TableCell key={outcome.id} className={cn(cell, 'text-muted-foreground')}>
                      –
                    </TableCell>
                  );
                return (
                  <TableCell key={outcome.id} className={cell}>
                    {count ? (
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
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
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
