'use client';

import { FileTextIcon, NotebookPenIcon, SparklesIcon } from 'lucide-react';
import type { Application, ListedApplication } from '@/lib/applications';
import { workModeOf, workModeText } from '@/lib/ads/details';
import { cn } from '@/lib/shared/cn';
import { Badge } from '@/components/ui/badge';
import { FitScore } from '@/features/offers/fit-score';
import { isRentADev, RentADev } from '@/features/offers/rent-a-dev';
import { StatusChip } from './status-chip';
import { Check } from 'lucide-react';

const facts = (details: Application['details']) =>
  [
    { key: 'salary', text: details?.salary?.split('; ')[0] },
    { key: 'contract', text: details?.contract },
    {
      key: 'mode',
      text: workModeText(details),
      className: workModeOf(details) === 'remote' ? 'text-success' : undefined,
    },
    { key: 'location', text: details?.location },
  ].filter((fact) => fact.text);

const CONTENT_COLOUR: Record<Application['contentStatus'], string> = {
  pending: 'text-muted-foreground',
  ok: 'text-success',
  empty: 'text-destructive',
  failed: 'text-destructive',
};
const META =
  "mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']";

/**
 * One application in the list (under the day you applied: no date of its own); a click opens its window.
 * A job the active AI profile judged has its fit badge, and the verdict's line under the title.
 * "Rent-a-dev": a software house's / body leasing firm's job, by the application's own call, or else the verdict's.
 */
export function ApplicationRow({
  app,
  labels,
  active = false,
  onOpen,
}: {
  app: ListedApplication;
  labels: Record<string, string>;
  /** its window is open */
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'group/row grid w-full cursor-pointer grid-cols-[1fr_auto] items-start gap-3 px-3.5 py-3 text-left',
        active && 'bg-accent',
      )}
      aria-current={active || undefined}
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold [overflow-wrap:anywhere] group-hover/row:text-brand group-hover/row:underline group-hover/row:underline-offset-2">
          {app.title}
        </span>
        <span className={META}>
          {app.company && <span>{app.company}</span>}
          {facts(app.details).map((fact) => (
            <span key={fact.key} className={fact.className}>
              {fact.text}
            </span>
          ))}
        </span>
        {app.fit?.summary && (
          <span className="mt-1 text-xs text-brand">
            <SparklesIcon /> {app.fit.summary}
          </span>
        )}
        {app.note?.trim() && (
          <span className="mt-[3px] truncate text-[13px] text-muted-foreground">
            <NotebookPenIcon /> {app.note.trim().split('\n')[0]}
          </span>
        )}
      </span>
      <span className="flex flex-col items-end gap-1 max-[560px]:max-w-[42vw]">
        <StatusChip stage={app.stage} outcome={app.outcome} />
        <span className="flex flex-wrap items-center justify-end gap-1">
          {isRentADev(app) && <RentADev />}
          {app.fit && (
            <FitScore
              match={app.fit.match}
              score={app.fit.score}
              summary={app.fit.summary}
              checks={app.fit.checks}
              hadDescription={app.fit.hadDescription}
              inButton
            />
          )}
          <Badge variant="quiet" className="rounded-md">
            {labels[app.src] ?? app.src}
          </Badge>
        </span>
        <span className={cn('text-xs whitespace-nowrap', CONTENT_COLOUR[app.contentStatus])}>
          {app.contentStatus === 'ok' && <FileTextIcon />} <Check size="8px" />
        </span>
      </span>
    </button>
  );
}
