'use client';

import { Check, FileTextIcon } from 'lucide-react';
import type { Application, ListedApplication } from '@/lib/applications';
import { cn } from '@/lib/shared/cn';
import type { Marks } from '@/lib/shared/search';
import { JobRow, detailFacts } from '@/features/offers/job-row';
import { isRentADev } from '@/features/offers/rent-a-dev';
import { WindowButton } from '@/features/offers/row-box';
import { StatusChip } from './status-chip';

const CONTENT_COLOUR: Record<Application['contentStatus'], string> = {
  pending: 'text-muted-foreground',
  ok: 'text-success',
  empty: 'text-destructive',
  failed: 'text-destructive',
};

/**
 * One application in the list (under the day you applied: no date of its own), as JobRow shows a job on
 * either tab: its title opens the ad, its company searches the list for it (`onCompany`), a click elsewhere
 * opens its window. Its status above the badges, its note's first line under the verdict's. "Rent-a-dev": a
 * software house's / body leasing firm's job, by the application's own call, or else the verdict's.
 */
export function ApplicationRow({
  app,
  labels,
  marks,
  active = false,
  onOpen,
  onCompany,
}: {
  app: ListedApplication;
  labels: Record<string, string>;
  /** where the search matched */
  marks?: Marks;
  /** its window is open */
  active?: boolean;
  onOpen: () => void;
  /** a click on the company: the list searching for it */
  onCompany?: (company: string) => void;
}) {
  const company = app.company;
  return (
    <JobRow
      active={active}
      title={app.title}
      href={app.url || null}
      company={company}
      onCompany={company && onCompany ? () => onCompany(company) : undefined}
      facts={detailFacts(app.details)}
      verdict={app.fit}
      rentADev={Boolean(isRentADev(app))}
      note={app.note}
      marks={marks}
      boards={[{ src: app.src, url: app.url || undefined }]}
      labels={labels}
      after={<WindowButton title={app.title} onClick={onOpen} />}
      top={<StatusChip stage={app.stage} outcome={app.outcome} />}
      bottom={
        <span className={cn('text-xs whitespace-nowrap', CONTENT_COLOUR[app.contentStatus])}>
          {app.contentStatus === 'ok' && <FileTextIcon />} <Check size="8px" />
        </span>
      }
    />
  );
}
