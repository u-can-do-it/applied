'use client';

import { Check, FileTextIcon } from 'lucide-react';
import type { Application, ListedApplication } from '@/lib/applications';
import { cn } from '@/lib/shared/cn';
import type { Marks, Snippet } from '@/lib/shared/search';
import { JobRow, detailFacts, type CompanyApplied } from '@/features/offers/job-row';
import { isRentADev } from '@/features/offers/rent-a-dev';
import { WindowButton } from '@/features/offers/row-box';
import { StatusChip } from './status-chip';
import { TalentPool } from './talent-pool';

const CONTENT_COLOUR: Record<Application['contentStatus'], string> = {
  pending: 'text-muted-foreground',
  ok: 'text-success',
  empty: 'text-destructive',
  failed: 'text-destructive',
};

/**
 * One application in the list (under the day you applied: no date of its own), as JobRow shows a job on
 * either tab: its title opens the ad, its company searches every application for it (`onCompany`), a click elsewhere
 * opens its window. Its status above the badges (and the talent pool, when it's in it), its note's first line under the verdict's. "Rent-a-dev": a
 * software house's / body leasing firm's job, by the application's own call, or else the verdict's.
 */
export function ApplicationRow({
  app,
  labels,
  marks,
  snippet,
  active = false,
  onOpen,
  onPrefetch,
  onCompany,
  companyApplied,
}: {
  app: ListedApplication;
  labels: Record<string, string>;
  /** where the search matched */
  marks?: Marks;
  /** searching everything, a piece of the ad where it matched */
  snippet?: Snippet;
  /** its window is open */
  active?: boolean;
  onOpen: () => void;
  /** the pointer came onto it (or the keyboard to its window button): its window is likely next */
  onPrefetch?: () => void;
  /** a click on the company: the list searching for it */
  onCompany?: (company: string) => void;
  /** your applications at its company, this one among them */
  companyApplied?: CompanyApplied;
}) {
  const company = app.company;
  return (
    <JobRow
      active={active}
      title={app.title}
      href={app.url || null}
      company={company}
      onCompany={company && onCompany ? () => onCompany(company) : undefined}
      companyApplied={companyApplied}
      facts={detailFacts(app.details)}
      verdict={app.fit}
      rentADev={Boolean(isRentADev(app))}
      note={app.note}
      marks={marks}
      snippet={snippet}
      boards={[{ src: app.src, url: app.url || undefined }]}
      labels={labels}
      after={<WindowButton title={app.title} onPrefetch={onPrefetch} onClick={onOpen} />}
      top={
        <div className="flex flex-wrap items-center justify-end gap-1">
          <StatusChip stage={app.stage} outcome={app.outcome} />
          {app.talentPool && <TalentPool />}
        </div>
      }
      bottom={
        <span className={cn('text-xs whitespace-nowrap', CONTENT_COLOUR[app.contentStatus])}>
          {app.contentStatus === 'ok' && <FileTextIcon />} <Check size="8px" />
        </span>
      }
    />
  );
}
