// Indeed: known by its links only (an application's link), no scraper.
import { withoutTracking } from './links.ts';
import type { Board } from './types.ts';

// viewjob?jk=…; a search page shows one job as vjk=…
const idFromLink = (url: URL) => url.searchParams.get('jk') || url.searchParams.get('vjk') || null;

export const indeed: Board<'indeed'> = {
  id: 'indeed',
  label: 'Indeed',
  hosts: [/(^|\.)indeed\.com$/],
  idFromLink,
  // the job id is in the query: the job link with only that
  cleanLink(url) {
    const id = idFromLink(url);
    return id ? `${url.origin}/viewjob?jk=${encodeURIComponent(id)}` : withoutTracking(url);
  },
};
