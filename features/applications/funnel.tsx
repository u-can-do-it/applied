import type { StageId } from '@/lib/stages';
import { percentOf } from '@/lib/shared/format';

/** Applications by the stage they're at now: one bar per stage, its length the share of all sent. */
export function Funnel({
  stages,
  sent,
  isOn,
  onPick,
}: {
  stages: { stage: StageId; label: string; count: number }[];
  sent: number;
  isOn: (label: string) => boolean;
  onPick: (label: string, stage: StageId) => void;
}) {
  return (
    <ol
      className="m-0 flex list-none flex-col gap-1 rounded-xl bg-card px-3 py-2.5 ring-1 ring-foreground/10"
      aria-label="By stage, as they are now"
    >
      {stages.map(({ stage, label, count }) => (
        <li key={stage}>
          <button
            type="button"
            className="relative block w-full overflow-hidden rounded-md px-2 py-1 text-left text-[13px] aria-pressed:outline-2 aria-pressed:outline-brand"
            aria-pressed={isOn(label) || undefined}
            onClick={() => onPick(label, stage)}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-accent"
              style={{ width: `${sent ? Math.max(4, (count / sent) * 100) : 0}%` }}
            />
            <span className="relative tabular-nums">
              <strong>{count}</strong> {label}
              <span className="text-muted-foreground"> · {percentOf(count, sent)} of sent</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
