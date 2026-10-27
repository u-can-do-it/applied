'use client';

import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The company, with `applied` (your applications there, or none) on its hover, and what a click does (`search`).
 * A client component so the trigger's `<span>` is made here: one a server component makes reaches the trigger
 * as a lazy reference Radix's Slot can't unwrap, and the server rendering errors.
 */
export function CompanyHover({
  applied,
  search,
  children,
}: {
  applied: string | undefined;
  search: string | null;
  children: ReactNode;
}) {
  if (!applied) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start gap-0.5">
        <span>{applied}</span>
        {search && <span className="opacity-70">{search}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
