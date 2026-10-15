'use client';

import { Check, FileTextIcon } from 'lucide-react';
import type { Application, ListedApplication } from '@/lib/applications';
import { workModeOf, workModeText } from '@/lib/ads/details';
import { cn } from '@/lib/shared/cn';
import type { Marks } from '@/lib/shared/search';
import { JOB_ROW, JobRow, type Fact } from '@/features/offers/job-row';
import { isRentADev } from '@/features/offers/rent-a-dev';
import { StatusChip } from './status-chip';

const facts = (details: Application['details']): Fact[] =>
  [
    { key: 'salary', text: details?.salary?.split('; ')[0] },
    { key: 'contract', text: details?.contract },
    {
      key: 'mode',
      text: workModeText(details),
      className: workModeOf(details) === 'remote' ? 'text-success' : undefined,
    },
    { key: 'location', text: details?.location },
  ].filter((fact): fact is Fact => Boolean(fact.text));

const CONTENT_COLOUR: Record<Application['contentStatus'], string> = {
  pending: 'text-muted-foreground',
  ok: 'text-success',
  empty: 'text-destructive',
  failed: 'text-destructive',
};

/**
 * One application in the list (under the day you applied: no date of its own), as JobRow shows a job on
 * either tab; a click opens its window. Its status above the badges, its note's first line under the
 * verdict's. "Rent-a-dev": a software house's / body leasing firm's job, by the application's own call, or
 * else the verdict's.
 */
export function ApplicationRow({
  app,
  labels,
  marks,
  active = false,
  onOpen,
}: {
  app: ListedApplication;
  labels: Record<string, string>;
  /** where the search matched */
  marks?: Marks;
  /** its window is open */
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(JOB_ROW, 'group/row w-full cursor-pointer text-left', active && 'bg-accent')}
      aria-current={active || undefined}
      onClick={onOpen}
    >
      <JobRow
        inButton
        title={app.title}
        company={app.company}
        facts={facts(app.details)}
        verdict={app.fit}
        rentADev={Boolean(isRentADev(app))}
        note={app.note}
        marks={marks}
        boards={[{ src: app.src }]}
        labels={labels}
        top={<StatusChip stage={app.stage} outcome={app.outcome} />}
        bottom={
          <span className={cn('text-xs whitespace-nowrap', CONTENT_COLOUR[app.contentStatus])}>
            {app.contentStatus === 'ok' && <FileTextIcon />} <Check size="8px" />
          </span>
        }
      />
    </button>
  );
}
