import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/shared/cn';
import { FIT_BADGE, FIT_RANGE } from '@/lib/shared/fit';
import { DAY_PRESETS, withParams } from '@/lib/shared/search-params';
import { NavLink } from './nav';

const fmt = (count: number) => count.toLocaleString('en-GB');

/**
 * After a day's count, "| 4 7": how many of its offers are good and fair fits, in the fit badges'
 * colours (lib/shared/fit.ts), each a link to them (that day, that tier), and back to every offer once
 * it's the filter; a tier with none left out, and the bar with both.
 */
export function DayFits({
  good,
  fair,
  day,
  current,
  path,
}: {
  good: number;
  fair: number;
  day: { day: string; label: string };
  current: URLSearchParams;
  path: string;
}) {
  if (!good && !fair) return null;
  // today and yesterday as their presets, so their chips light up; another day as a range of one
  const preset = DAY_PRESETS.find((option) => option.days && option.label === day.label);
  const when = preset ? { days: preset.days, from: null, to: null } : { days: null, from: day.day, to: day.day };
  const onDay = (['days', 'from', 'to'] as const).every((key) => (current.get(key) ?? null) === when[key]);
  const all = { fit: null, days: null, from: null, to: null };
  const tiers = [
    { tier: 'good', count: good },
    { tier: 'fair', count: fair },
  ] as const;
  return (
    <>
      <span className="mx-2.5 font-normal text-border" aria-hidden>
        |
      </span>
      <span className="inline-flex gap-1.5 align-top">
        {tiers.map(({ tier, count }) => {
          if (!count) return null;
          const active = onDay && current.get('fit') === tier;
          return (
            <Badge
              key={tier}
              variant={FIT_BADGE[tier]}
              asChild
              // no taller than the heading's text, so it doesn't grow (the skeleton's is as tall)
              className={cn(
                'h-4 py-0 tracking-normal tabular-nums no-underline normal-case hover:brightness-125',
                active && 'ring-1 ring-current',
              )}
            >
              <NavLink
                href={withParams(current, active ? all : { fit: tier, ...when }, path)}
                aria-current={active ? 'true' : undefined}
                title={active ? 'Show every offer again' : `${day.label}: show the matches at ${FIT_RANGE[tier]}`}
              >
                {fmt(count)}
                <span className="sr-only">
                  {' '}
                  {tier} {count === 1 ? 'fit' : 'fits'}
                </span>
              </NavLink>
            </Badge>
          );
        })}
      </span>
    </>
  );
}
