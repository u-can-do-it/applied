'use client';

import { FileTextIcon, NotebookPenIcon } from 'lucide-react';
import type { Application } from '@/lib/applications';
import { cn } from '@/lib/shared/cn';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from './status-chip';
import { useDay } from './use-day';

const facts = (details: Application['details']) =>
  [details?.salary?.split('; ')[0], details?.contract, details?.remote ? 'Remote' : null, details?.location]
    .filter(Boolean)
    .join(' · ');

const CONTENT: Record<Application['contentStatus'], string> = {
  pending: 'saving the ad…',
  ok: 'ad saved',
  empty: 'no ad text',
  failed: 'couldn’t fetch the ad',
};
const CONTENT_COLOUR: Record<Application['contentStatus'], string> = {
  pending: 'text-muted-foreground',
  ok: 'text-success',
  empty: 'text-destructive',
  failed: 'text-destructive',
};
const META =
  "mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']";

/** One application in the list; a click opens its window. */
export function ApplicationRow({
  app,
  labels,
  onOpen,
}: {
  app: Application;
  labels: Record<string, string>;
  onOpen: () => void;
}) {
  const day = useDay();
  return (
    <button
      type="button"
      className="group/row grid w-full cursor-pointer grid-cols-[84px_1fr_auto] items-start gap-3 px-3.5 py-3 text-left max-[560px]:grid-cols-[1fr_auto]"
      onClick={onOpen}
    >
      <time
        dateTime={app.appliedAt}
        className="pt-px text-[13px] text-muted-foreground tabular-nums max-[560px]:col-span-full"
      >
        {day(app.appliedAt)}
      </time>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold [overflow-wrap:anywhere] group-hover/row:text-brand group-hover/row:underline group-hover/row:underline-offset-2">
          {app.title}
        </span>
        <span className={META}>
          {app.company && <span>{app.company}</span>}
          {facts(app.details) && <span>{facts(app.details)}</span>}
        </span>
        {app.note?.trim() && (
          <span className="mt-[3px] truncate text-[13px] text-muted-foreground">
            <NotebookPenIcon /> {app.note.trim().split('\n')[0]}
          </span>
        )}
      </span>
      <span className="flex flex-col items-end gap-1 max-[560px]:max-w-[42vw]">
        <StatusChip stage={app.stage} outcome={app.outcome} />
        <Badge variant="quiet" className="rounded-md">
          {labels[app.src] ?? app.src}
        </Badge>
        <span className={cn('text-xs whitespace-nowrap', CONTENT_COLOUR[app.contentStatus])}>
          {app.contentStatus === 'ok' && <FileTextIcon />} {CONTENT[app.contentStatus]}
        </span>
      </span>
    </button>
  );
}
