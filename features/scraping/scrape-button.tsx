'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useState, useTransition } from 'react';
import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { RunSummary } from '@/lib/listings/pipeline/model';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';

/** POST /api/scrape (app/api/scrape/route.ts): every scraper, or the one with this id. */
async function scrapeNow(id?: string): Promise<Result<RunSummary>> {
  // a lapsed login gets proxy.ts's redirect to /login: not followed, it would answer with that page
  const response = await fetch('/api/scrape', {
    method: 'POST',
    redirect: 'manual',
    ...(id && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }),
  });
  if (response.type === 'opaqueredirect') return fail('Not logged in: reload the page.');
  const answer = (await response.json().catch(() => null)) as Result<RunSummary> | null;
  return answer ?? fail(`The server answered ${response.status}.`);
}

/**
 * A run you start yourself, like the scheduled one (new offers also go to Telegram and push): `run()` for
 * every scraper, `run(scraper)` for that one. The page refreshes with the new offers when it's done; the
 * result is a toast, a run that failed is `failure` until the next try.
 */
export function useScrapeNow() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = (scraper?: { id: string; name: string }) => {
    setFailure(null);
    setRunning(scraper?.id ?? null);
    start(async () => {
      const answer = await scrapeNow(scraper?.id).catch((failure: unknown) => fail(message(failure)));
      // with the refreshed list, not a frame before it
      startTransition(() => {
        if (answer.ok) router.refresh();
      });
      if (!answer.ok) {
        startTransition(() => setFailure(scraper ? `${scraper.name}: ${answer.error}` : answer.error));
        return;
      }
      const report = answer.data;
      if (report.skipped) {
        toast.info(report.skipped);
        return;
      }
      const title = `${scraper ? `${scraper.name}: ` : ''}${
        report.added ? `${report.added} new offer${report.added === 1 ? '' : 's'}` : 'Nothing new'
      }`;
      const summary = `${report.found} on the pages, ${report.kept} after filters, ${report.added} new${
        report.notifyLater ? ' · the AI check and the notifications run in the background' : `, ${report.notified} sent`
      }`;
      if (!report.errors.length) {
        toast.success(title, { description: summary });
        return;
      }
      // the scrapers that failed in a run that otherwise went through
      toast.warning(`${title} · ${report.errors.length} scraper${report.errors.length === 1 ? '' : 's'} failed`, {
        description: (
          <>
            {summary}
            {report.errors.map((failure, i) => (
              <span key={i} className="mt-1 block [overflow-wrap:anywhere]">
                {failure.scraper}: {failure.error}
              </span>
            ))}
          </>
        ),
        duration: 15_000,
      });
    });
  };

  /** `running`: the one scraper being run (null: all of them, or none) */
  return { busy, running: busy ? running : null, failure, run };
}

// "Scrape now" in the header: a full run; a run that failed says so next to the button until the next try.
export function ScrapeButton() {
  const { busy, failure, run } = useScrapeNow();

  return (
    <span className="inline-flex items-center gap-2">
      {failure && (
        <span role="alert" title={failure} className="max-w-[min(40ch,45vw)] truncate text-xs text-destructive">
          <TriangleAlertIcon /> Scraping failed: {failure}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => run()}
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
      </Button>
    </span>
  );
}
