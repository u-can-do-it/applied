// Himalayas (remote jobs): its listing: lib/listings/parsers/himalayas.ts; its ads: lib/ads/himalayas.ts (its
// job pages turn servers away, its API has the whole ad).
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const himalayas: ScrapedBoard<'himalayas'> = {
  id: 'himalayas',
  label: 'Himalayas',
  hosts: [/(^|\.)himalayas\.app$/],
  // https://himalayas.app/companies/<company>/jobs/<job> -> "<company>/<job>"
  idFromLink: (url) =>
    pathOf(url)
      .match(/\/companies\/([^/]+)\/jobs\/([^/?#]+)/)
      ?.slice(1, 3)
      .join('/') ?? null,
  listing: {
    label: 'Himalayas API',
    hint:
      'Himalayas’ remote job search, 20 a page (the first few are promoted, not the newest). country=PL keeps the jobs ' +
      'you can do from Poland: those open to it and those open anywhere. Its q= wants every word, so a run is one ' +
      'search per keyword ({keyword}); the keyword check reads the title only (its categories come from the description). It shares Adzuna’s pace: one call every 20 minutes between its scrapers, ' +
      'so one keyword of one page runs every 20 minutes, two every 40; Scrape now runs them any time.',
    defaults: {
      url: 'https://himalayas.app/jobs/api/search?q={keyword}&country=PL&sort=recent&page={page}',
      pages: 1,
      checkKeyword: true,
      checkLocation: true,
    },
    minutesPerCall: 20,
    seeds: [{ name: 'Himalayas' }],
  },
};
