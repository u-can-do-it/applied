'use client';

import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CompanyApplied } from './job-row';

/** the most applications the hover lists; the rest are counted */
const LISTED = 5;

/**
 * The company, with `applied` (how many applications you have there, or none) on its hover, those
 * applications (`apps`, the latest first: the day, the title, this job's own marked), and what a click does (`search`).
 * A client component so the trigger's `<span>` is made here: one a server component makes reaches the trigger
 * as a lazy reference Radix's Slot can't unwrap, and the server rendering errors.
 */
export function CompanyHover({
  applied,
  apps = [],
  search,
  children,
}: {
  applied: string | undefined;
  apps?: CompanyApplied;
  search: string | null;
  children: ReactNode;
}) {
  if (!applied) return children;
  const more = apps.length - LISTED;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm flex-col items-start gap-0.5">
        <span>{applied}</span>
        {apps.length > 0 && (
          <ul className="my-0.5 grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
            {apps.slice(0, LISTED).map((app, i) => (
              <li key={i} className="col-span-full grid grid-cols-subgrid">
                <span className="tabular-nums opacity-70">{app.day}</span>
                <span className="flex min-w-0 gap-1">
                  <span className="truncate font-medium" title={app.title}>
                    {app.title}
                  </span>
                  {app.self && <span className="shrink-0 opacity-70">· this job</span>}
                </span>
              </li>
            ))}
            {more > 0 && <li className="col-span-full opacity-70">and {more} more</li>}
          </ul>
        )}
        {search && <span className="opacity-70">{search}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
