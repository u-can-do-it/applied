// Jobicy (remote jobs): its listing: lib/listings/parsers/jobicy.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const jobicy: ScrapedBoard<'jobicy'> = {
  id: 'jobicy',
  label: 'Jobicy',
  hosts: [/(^|\.)jobicy\.com$/],
  // https://jobicy.com/jobs/<id>-<title>
  idFromLink: (url) => pathOf(url).match(/\/jobs\/(\d+)(?:-|\/?$)/)?.[1] ?? null,
  listing: {
    label: 'Jobicy API',
    hint:
      'Jobicy’s public API: the remote jobs of the last 7 days, up to 100 in one answer. geo=poland keeps the ones ' +
      'open to Poland, industry=engineering the engineering ones, tag= the ones that mention a word anywhere in ' +
      'the ad (several words: all of them), so a run is one search per keyword ({keyword}). Its jobs have no ' +
      'skills, so the keyword check (the title only) is off: the search did it. Its terms ask for one call an ' +
      'hour at most, so the schedule makes one every hour between its scrapers: one keyword runs every hour, ' +
      'three every 3 hours; Scrape now runs them any time.',
    defaults: {
      url: 'https://jobicy.com/api/v2/remote-jobs?count=100&geo=poland&industry=engineering&tag={keyword}',
      checkKeyword: false,
      checkLocation: true,
    },
    minutesPerCall: 60,
    seeds: [{ name: 'Jobicy' }],
  },
};
