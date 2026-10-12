import { parse as parseHtml } from 'node-html-parser';
import { byHost } from '../boards';
import { linkedin } from '../boards/linkedin';
import { parseLink } from '../boards/links';

// LinkedIn's job alert emails (POST /api/alerts/linkedin): only the jobs' ids are taken from them, so a
// new layout of the email doesn't break it. Their title, company and place come from the posting when a
// run reads it (lib/listings/pipeline/alerts.ts).

/** What a run did with a job from an email: an offer now, left out by the filters, or a scraper's already. */
export type AlertOutcome = 'kept' | 'skipped' | 'known';

/** The LinkedIn jobs an email links to, each once, in the email's order. */
export function jobsInAlert(html: string): string[] {
  const ids = new Set<string>();
  for (const anchor of parseHtml(html).querySelectorAll('a[href]')) {
    const url = parseLink(anchor.getAttribute('href') ?? '');
    if (!url || byHost(url.hostname)?.id !== linkedin.id) continue;
    // the job's own links (/comm/jobs/view/<id>/?trackingId=…), and a search that opens on it (currentJobId=)
    const id = linkedin.idFromLink?.(url);
    if (id && /^\d{6,}$/.test(id)) ids.add(id);
  }
  return [...ids];
}
