'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A hint on hover or keyboard focus, the app's tooltip, in place of a `title` attribute (the browser's own,
 * slow and unstyled). No `text`: the child alone.
 *
 * The child is the tooltip's trigger itself (Radix's Slot), so it must be an element a client component made:
 * one a server component made reaches the Slot as a lazy reference it can't unwrap (company-hover.tsx). There,
 * and around a disabled button (it gets no pointer events, so its hint would never show), `wrap`: the trigger
 * is a `<span>` made here (`className` its classes), the child inside it.
 */
export function Hint({
  text,
  side = 'top',
  wrap = false,
  className,
  children,
}: {
  text: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  wrap?: boolean;
  className?: string;
  children: ReactElement | ReactNode;
}) {
  const trigger = wrap ? <span className={className}>{children}</span> : children;
  if (!text) return trigger;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={side}>{text}</TooltipContent>
    </Tooltip>
  );
}
