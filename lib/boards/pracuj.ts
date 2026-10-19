// pracuj.pl: its listing: lib/listings/parsers/pracuj.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const pracuj: ScrapedBoard<'pracuj'> = {
  id: 'pracuj',
  label: 'Pracuj.pl',
  hosts: [/(^|\.)pracuj\.pl$/],
  // its pages answer this server with Cloudflare's challenge (as The Protocol's, the same company's)
  blocksServer: true,
  // https://www.pracuj.pl/praca/<slug>,oferta,<id>
  idFromLink: (url) => pathOf(url).match(/,oferta,(\d+)/)?.[1] ?? null,
  listing: {
    label: 'Pracuj.pl search',
    hint:
      'An it.pracuj.pl search page (its Next.js data), 50 jobs a page, read through ScrapingAnt (its Cloudflare turns ' +
      'this server away). /praca/<keyword>;kw searches, sc=0 is the newest first (promoted offers lead each part of ' +
      'the list). A job in several cities is one offer with each city. ' +
      'Every page costs a ScrapingAnt credit, so the schedule makes one call every 10 minutes between its scrapers.',
    defaults: { url: 'https://it.pracuj.pl/praca/{keyword};kw?sc=0', checkKeyword: true, checkLocation: true },
    // ScrapingAnt's free 10,000 credits a month, its only two boards since Eldorado's search left it: a page a run of
    // a 10-minute schedule from 7 to 22 is ~2,700 a month (~2,060 with hourly weekends). More keywords share the
    // calls; a scraper may set its own interval (everyMinutes)
    minutesPerCall: 10,
    seeds: [{ name: 'Pracuj.pl' }],
  },
};
