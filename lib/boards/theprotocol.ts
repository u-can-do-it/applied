// theprotocol.it: its listing: lib/listings/parsers/theprotocol.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const theprotocol: ScrapedBoard<'theprotocol'> = {
  id: 'theprotocol',
  label: 'The Protocol',
  hosts: [/(^|\.)theprotocol\.it$/],
  // its pages answer this server with Cloudflare's challenge, and its search API (apus-api …/offers/_search)
  // wants the site's own credentials
  blocksServer: true,
  // https://theprotocol.it/szczegoly/praca/<slug>,oferta,<guid>
  idFromLink: (url) =>
    pathOf(url)
      .match(/,oferta,([0-9a-f-]{36})/i)?.[1]
      ?.toLowerCase() ?? null,
  listing: {
    label: 'The Protocol search',
    hint:
      'A theprotocol.it search page (its Next.js data), 50 offers a page, read through ScrapingAnt (its Cloudflare turns ' +
      'this server away). kw= is one keyword (two kw= must both match), sort=date the newest first; /filtry/react.js;t ' +
      'filters by technology instead. Every page costs a ScrapingAnt credit, so the schedule makes one call every 20 ' +
      'minutes between its scrapers.',
    defaults: { url: 'https://theprotocol.it/praca?kw={keyword}&sort=date', checkKeyword: true, checkLocation: true },
    // ScrapingAnt's free 10,000 credits a month, shared: one page every 20 minutes from 7 to 22 is ~1,350 (15 would
    // be every 10: a scraper is due 5 minutes early, lib/listings/quota.ts). A scraper may set its own (everyMinutes)
    minutesPerCall: 20,
    seeds: [{ name: 'The Protocol' }],
  },
};
