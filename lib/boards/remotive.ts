// Remotive (remote jobs): its listing: lib/listings/parsers/remotive.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const remotive: ScrapedBoard<'remotive'> = {
  id: 'remotive',
  label: 'Remotive',
  hosts: [/(^|\.)remotive\.com$/, /(^|\.)remotive\.io$/],
  // https://remotive.com/remote-jobs/<category>/<title>-<id>
  idFromLink: (url) => pathOf(url).match(/\/remote-jobs\/[^/]+\/[^/?#]*?-(\d+)\/?$/)?.[1] ?? null,
  listing: {
    label: 'Remotive API',
    hint:
      'Remotive’s public API: its remote jobs of a category, all in one answer, a day after they are posted. Its ' +
      'terms ask for a few calls a day at most, so the schedule makes one every 6 hours between its scrapers; Scrape ' +
      'now runs it any time. candidate_required_location says who may apply: a job open only to other countries ' +
      'counts as not remote. The keyword check reads the title and its tags.',
    defaults: {
      url: 'https://remotive.com/api/remote-jobs?category=software-dev',
      checkKeyword: true,
      checkLocation: true,
    },
    minutesPerCall: 360,
    seeds: [{ name: 'Remotive' }],
  },
};
