import { Fragment, type ReactNode } from 'react';
import { ChartNoAxesColumnIncreasingIcon } from 'lucide-react';
import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/shared/cn';
import { LEVEL_OPTIONS, toggleLevel, type Level } from '@/lib/shared/seniority';

// The lists' filter chips: rounded toggles, lit while they're in use (a link's aria-current, a button's
// aria-pressed). The offers' are links that change the URL (features/offers/controls.tsx); the Applied
// tab's, buttons (it filters its list itself).

export const CHIPS = 'flex flex-wrap gap-1.5';
export const CHIP = cn(
  toggleVariants(),
  'h-auto min-w-0 rounded-full border bg-card px-2.5 py-1 text-[13px] font-normal text-muted-foreground no-underline hover:bg-card hover:text-foreground aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:text-background aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground aria-pressed:hover:text-background',
);

/** a chip row's name, before its chips */
export const CHIP_LABEL = 'flex items-center gap-1 pr-0.5 text-[13px] text-muted-foreground';

export const LEVEL_LABEL = (
  <span className={CHIP_LABEL}>
    <ChartNoAxesColumnIncreasingIcon /> Level
  </span>
);

/** One level chip as a list draws it: `on`, lit; `level`, the ?level= a click leads to (null: no filter). */
export type LevelChip = { label: string; on: boolean; level: string | null };

/**
 * The job's level (lib/shared/seniority.ts): Any, then each level, several at once (a click switches one
 * on or off). `chip` draws one, as a link or a button.
 */
export function LevelChips({
  levels,
  chip,
  className,
}: {
  levels: readonly Level[];
  chip: (chip: LevelChip) => ReactNode;
  className?: string;
}) {
  return (
    <nav className={cn(CHIPS, 'items-center', className)} aria-label="Filter by level">
      {LEVEL_LABEL}
      {chip({ label: 'Any', on: !levels.length, level: null })}
      {LEVEL_OPTIONS.map((option) => (
        <Fragment key={option.level}>
          {chip({ label: option.label, on: levels.includes(option.level), level: toggleLevel(levels, option.level) })}
        </Fragment>
      ))}
    </nav>
  );
}

/** The same row before the URL is known (the offers' static shell): nothing lit. */
export function LevelChipsFallback({ className }: { className?: string }) {
  return (
    <div className={cn(CHIPS, 'items-center', className)} aria-hidden="true">
      {LEVEL_LABEL}
      {['Any', ...LEVEL_OPTIONS.map((option) => option.label)].map((label) => (
        <span key={label} className={CHIP}>
          {label}
        </span>
      ))}
    </div>
  );
}
