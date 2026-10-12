// LinkedIn: its listing: lib/listings/parsers/linkedin.ts; its ads: lib/ads/linkedin.ts.
import { pathOf, withoutTracking } from './links.ts';
import type { ScrapedBoard } from './types.ts';

const idFromLink = (url: URL) =>
  pathOf(url).match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/)?.[1] ?? url.searchParams.get('currentJobId');

export const linkedin: ScrapedBoard<'linkedin'> = {
  id: 'linkedin',
  label: 'LinkedIn',
  hosts: [/(^|\.)linkedin\.com$/],
  idFromLink,
  // its job id can be in the query; with one, the canonical job link
  cleanLink(url) {
    const id = idFromLink(url);
    return id ? `https://www.linkedin.com/jobs/view/${id}` : withoutTracking(url);
  },
  listing: {
    label: 'LinkedIn search (public, no login)',
    hint:
      'LinkedIn’s logged-out job search, 10 offers per page, sorted by relevance (it ignores sortBy), so the newest come from a short ' +
      'window: f_TPR=r{since} = posted since an hour before the last run that read everything (overnight too), over up to 5 pages ' +
      '(r3600 = the last hour, r86400 = 24 h). location= a city or a country; it ignores f_WT (remote only): a card is remote when it ' +
      'says so, or is placed in a whole country ("Polska"). Its search ' +
      'reads the whole ad but its cards have no skills: a title without a keyword has its ad read, once, for one.',
    defaults: {
      url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r{since}&start={start}',
      pages: 5,
      checkKeyword: true,
      checkLocation: true,
    },
    keywordsInAd: true,
    seeds: [
      { name: 'LinkedIn – Warszawa' },
      {
        name: 'LinkedIn – remote',
        url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r{since}&start={start}',
      },
    ],
  },
};
