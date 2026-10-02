'use client';

import { useEffect, useState, useTransition } from 'react';
import { scrapeNowAction } from './settings/actions';

// "Scrape now" in the header: a full run, like the scheduled one (new offers also go to
// Telegram). The page refreshes with the new offers when it's done.
export function ScrapeButton() {
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ text: string; title?: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 8000);
    return () => clearTimeout(t);
  }, [result]);

  const run = () =>
    start(async () => {
      setResult(null);
      try {
        const r = await scrapeNowAction();
        const errors = r.errors.map((e) => `${e.scraper}: ${e.error}`).join('\n');
        if (r.skipped) setResult({ text: r.skipped });
        else
          setResult({
            text: `${r.added ? `${r.added} new` : 'nothing new'}${r.errors.length ? ` · ⚠ ${r.errors.length}` : ''}`,
            title: `${r.found} on the pages, ${r.kept} after filters, ${r.added} new, ${r.notified} sent to Telegram${errors ? `\n\n${errors}` : ''}`,
            bad: r.errors.length > 0,
          });
      } catch (e) {
        setResult({ text: '⚠ failed', title: e instanceof Error ? e.message : String(e), bad: true });
      }
    });

  return (
    <span className="scrape-now">
      {result && (
        <span className={`scrape-result${result.bad ? ' warn' : ''}`} title={result.title} role="status">
          {result.text}
        </span>
      )}
      <button type="button" className="secondary small-button" onClick={run} disabled={busy} aria-busy={busy || undefined}>
        {busy ? 'Scraping…' : '↻ Scrape now'}
      </button>
    </span>
  );
}
