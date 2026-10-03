'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useState, useTransition } from 'react';
import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import type { RunSummary } from '@/lib/listings/pipeline/model';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';

/** POST /api/scrape (app/api/scrape/route.ts). */
async function scrapeNow(): Promise<Result<RunSummary>> {
  // a lapsed login gets proxy.ts's redirect to /login: not followed, it would answer with that page
  const response = await fetch('/api/scrape', { method: 'POST', redirect: 'manual' });
  if (response.type === 'opaqueredirect') return fail('Not logged in: reload the page.');
  const answer = (await response.json().catch(() => null)) as Result<RunSummary> | null;
  return answer ?? fail(`The server answered ${response.status}.`);
}

// "Scrape now" in the header: a full run, like the scheduled one (new offers also go to
// Telegram). The page refreshes with the new offers when it's done.
export function ScrapeButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  // errors: the scrapers that failed in a run that otherwise went through; failed: the run itself
  const [result, setResult] = useState<{ text: string; title?: string; errors?: number; failed?: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 8000);
    return () => clearTimeout(timer);
  }, [result]);

  const run = () => {
    setResult(null);
    start(async () => {
      let next: typeof result;
      const answer = await scrapeNow().catch((failure: unknown) => fail(message(failure)));
      if (answer.ok) {
        const report = answer.data;
        const errors = report.errors.map((failure) => `${failure.scraper}: ${failure.error}`).join('\n');
        next = report.skipped
          ? { text: report.skipped }
          : {
              text: report.added ? `${report.added} new` : 'nothing new',
              title: `${report.found} on the pages, ${report.kept} after filters, ${report.added} new${
                report.notifyLater
                  ? ' · the AI check and Telegram run in the background'
                  : `, ${report.notified} sent to Telegram`
              }${errors ? `\n\n${errors}` : ''}`,
              errors: report.errors.length,
            };
      } else {
        next = { text: 'failed', title: answer.error, failed: true };
      }
      // with the refreshed list, not a frame before it
      startTransition(() => {
        setResult(next);
        if (answer.ok) router.refresh();
      });
    });
  };

  return (
    <span className="scrape-now">
      {result && (
        <span
          className={`scrape-result${result.failed || result.errors ? ' warn' : ''}`}
          title={result.title}
          role="status"
        >
          {result.failed && (
            <>
              <TriangleAlertIcon />{' '}
            </>
          )}
          {result.text}
          {result.errors ? (
            <>
              {' · '}
              <TriangleAlertIcon role="img" aria-label="errors:" /> {result.errors}
            </>
          ) : null}
        </span>
      )}
      <button
        type="button"
        className="secondary small-button"
        onClick={run}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? (
          'Scraping…'
        ) : (
          <>
            <RotateCwIcon /> Scrape now
          </>
        )}
      </button>
    </span>
  );
}
