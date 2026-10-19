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
      'Every page costs a ScrapingAnt credit, so the schedule makes one call every 15 minutes between its scrapers.',
    defaults: { url: 'https://it.pracuj.pl/praca/{keyword};kw?sc=0', checkKeyword: true, checkLocation: true },
    // ScrapingAnt's free 10,000 credits a month, shared: one page every 15 minutes from 7 to 22 is ~1,800
    minutesPerCall: 15,
    seeds: [{ name: 'Pracuj.pl' }],
  },
};
