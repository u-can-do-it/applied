'use client';

import { CheckIcon, ExternalLinkIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { seconds } from '@/lib/shared/format';
import type { Result } from '@/lib/shared/result';
import type { TestResult } from './actions';

/** What a scraper's test found: per page, the offers, and the first one as the scraper sees it. */
export function TestView({ test }: { test: Result<TestResult> }) {
  if (!test.ok) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle className="font-normal">{test.error}</AlertTitle>
      </Alert>
    );
  }
  const result = test.data;
  const skipped = [
    result.skipped.keyword && `${result.skipped.keyword} without a keyword`,
    result.skipped.area && `${result.skipped.area} not remote / not in the cities`,
    result.skipped.ignored && `${result.skipped.ignored} by title`,
  ].filter(Boolean);
  return (
    <section
      className="rounded-lg border bg-background px-3 py-2.5 text-sm [&_a]:text-foreground"
      aria-label="Test result"
      aria-live="polite"
    >
      <p className="mt-0 mb-1.5">
        {result.ok ? (
          <CheckIcon className="text-success" role="img" aria-label="OK" />
        ) : (
          <XIcon className="text-warning" role="img" aria-label="Failed" />
        )}{' '}
        {result.found} on the page
        {result.pages.length > 1 ? 's' : ''} → <strong>{result.kept} kept</strong>, {result.fresh} of them not saved yet
        · {seconds(result.ms, 1)}
        {skipped.length > 0 && <span className="text-muted-foreground"> · skipped: {skipped.join(', ')}</span>}
      </p>
      {result.pages.length > 1 || !result.ok ? (
        <ul className="my-1.5 list-disc pl-5 text-[13px]">
          {result.pages.map((page) => (
            <li key={page.url}>
              {[page.keyword, result.pages.some((other) => other.page > 1) && `page ${page.page}`]
                .filter(Boolean)
                .join(', ') || 'page'}
              : {page.ok ? `${page.total} → ${page.kept}` : <span className="text-warning">{page.error}</span>}{' '}
              <a href={page.url} target="_blank" rel="noopener noreferrer" className="underline">
                open <ExternalLinkIcon />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {result.offers.length > 0 && (
        <ol className="my-1.5 list-decimal pl-5 text-[13px]">
          {result.offers.map((offer) => (
            <li key={offer.id} className="my-[3px] [overflow-wrap:anywhere]">
              <a href={offer.url} target="_blank" rel="noopener noreferrer" className="underline">
                {offer.title}
              </a>{' '}
              {!offer.known && <Badge variant="success">new</Badge>}
              <span className="text-xs text-muted-foreground">
                {' '}
                {[offer.company, offer.remote ? 'remote' : offer.locations.join(', '), offer.seniority]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                · id {offer.id}
              </span>
            </li>
          ))}
        </ol>
      )}
      {result.sample && (
        <details>
          <summary className="cursor-pointer text-[13px] text-muted-foreground">
            The first offer as the scraper sees it
          </summary>
          <pre className="mt-1.5 mb-0 max-h-80 overflow-auto rounded-md bg-card p-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
            {result.sample}
          </pre>
        </details>
      )}
    </section>
  );
}
