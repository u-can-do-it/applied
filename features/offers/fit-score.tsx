'use client';

import { useState } from 'react';
import { CheckIcon, InfoIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Check = { item: string; met: boolean };

/**
 * "82%" and an info icon, with the requirement checklist on hover, focus or tap (the Tooltip places it
 * where there's room: below the badge, or above it for the last offers on the screen).
 */
export function FitScore({
  score,
  summary,
  checks,
  hadDescription,
}: {
  score: number;
  summary: string | null;
  checks: Check[];
  hadDescription: boolean;
}) {
  // controlled only so a tap opens it: Radix's tooltip opens on hover and keyboard focus, not on a touch
  const [open, setOpen] = useState(false);
  const tier = score >= 70 ? 'success-soft' : score >= 40 ? 'warning-soft' : 'muted';
  const met = checks.filter((check) => check.met).length;

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Badge variant={tier} asChild className="cursor-help gap-[3px] text-[13px] font-semibold tabular-nums">
          {/* a button: Tab reaches it, Enter and Space work on it */}
          <button
            type="button"
            // Radix closes an open tooltip on pointer down, and the click would open it again
            onPointerDown={(event) => open && event.preventDefault()}
            onClick={(event) => {
              event.preventDefault(); // Radix would close it: a click (a tap) opens it instead
              setOpen(true);
            }}
          >
            {score}%
            <InfoIcon className="font-normal opacity-80" />
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        showArrow={false}
        // the app's card colours rather than the inverted ones of a one-line tooltip
        className="flex max-h-[min(60vh,440px)] w-[min(300px,80vw)] max-w-none flex-col items-stretch gap-1.5 overflow-y-auto rounded-[10px] border bg-card px-3 py-2.5 text-[13px] text-foreground shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
      >
        <strong>
          {score}% fit{checks.length > 0 && ` · ${met}/${checks.length} requirements met`}
        </strong>
        {summary && <span className="text-muted-foreground">{summary}</span>}
        {checks.length > 0 && (
          <span className="flex flex-col gap-0.5">
            {checks.map((check, i) => (
              <span key={i} className={check.met ? 'text-success' : 'text-destructive'}>
                {check.met ? <CheckIcon /> : <XIcon />} {check.item}
                <span className="sr-only">{check.met ? ' (you have it)' : ' (missing)'}</span>
              </span>
            ))}
          </span>
        )}
        {!hadDescription && (
          <span className="text-xs text-muted-foreground italic">
            Judged on the title only – the ad text couldn&apos;t be read.
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
