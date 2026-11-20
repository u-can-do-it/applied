import { outcomeLabel, stageOf, type AnswerTime } from '@/lib/stages';
import { duration } from '@/lib/shared/format';
import { cn } from '@/lib/shared/cn';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const ANSWER_TIME_HEADINGS = ['Status', 'Answers', 'Min', 'Avg', 'Max'];

/**
 * How long they took to answer (answerTimes): for each status they answered with, from the step
 * before it (applying, for the first answer), the shortest, average and longest wait.
 */
export function AnswerTable({ times }: { times: AnswerTime[] }) {
  return (
    <details className="overflow-x-auto">
      <summary className="cursor-pointer text-[13px] text-muted-foreground">How long they took to answer</summary>
      {times.length ? (
        <Table className="mt-1.5 text-[13px] tabular-nums">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {ANSWER_TIME_HEADINGS.map((heading, i) => (
                <TableHead
                  key={heading}
                  scope="col"
                  className={cn(
                    'h-auto px-2 py-1.5 text-xs font-medium text-muted-foreground max-[480px]:px-1',
                    i && 'text-right',
                  )}
                >
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {times.map((time) => (
              <TableRow key={`${time.stage}-${time.outcome}`} className="hover:bg-transparent">
                <TableHead scope="row" className="h-auto px-2 py-1.5 font-medium max-[480px]:px-1">
                  {stageOf(time.stage).label} · {outcomeLabel(time.stage, time.outcome)}
                </TableHead>
                <TableCell className={CELL}>{time.count}</TableCell>
                <TableCell className={CELL}>{duration(time.min)}</TableCell>
                <TableCell className={cn(CELL, 'font-medium')}>{duration(time.avg)}</TableCell>
                <TableCell className={CELL}>{duration(time.max)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="mt-1.5 text-[13px] text-muted-foreground">No answers yet.</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        From the step before (applying, for the first answer); ghosted, withdrawn and the steps the app set aren’t
        answers.
      </p>
    </details>
  );
}

const CELL = 'px-2 py-1.5 text-right max-[480px]:px-1';
