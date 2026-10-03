'use client';

import { CircleHelpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * A panel's heading with a "?" that opens its help underneath. The panel itself shows controls and
 * state; how things work and how to set them up is there on demand.
 */
export function PanelHeading({
  id,
  title,
  help,
  children,
}: {
  id: string;
  title: string;
  help?: React.ReactNode;
  /** what goes on the right of the heading (a button) */
  children?: React.ReactNode;
}) {
  return (
    <Collapsible className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-1">
        <h2 id={id} className="m-0 text-base font-semibold">
          {title}
        </h2>
        {help && (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={`About ${title}`}
              title={`About ${title}`}
            >
              <CircleHelpIcon />
            </Button>
          </CollapsibleTrigger>
        )}
        {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
      </div>
      {help && (
        <CollapsibleContent className="rounded-lg bg-muted px-3 py-0.5 text-xs leading-relaxed text-muted-foreground [&_p]:my-2">
          {help}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
