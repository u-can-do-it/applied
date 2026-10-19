// theprotocol.it: its listing: lib/listings/parsers/theprotocol.ts (the recommendations' trackingId:
// lib/listings/api-params.ts); its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const theprotocol: ScrapedBoard<'theprotocol'> = {
  id: 'theprotocol',
  label: 'The Protocol',
  hosts: [/(^|\.)theprotocol\.it$/],
  // its pages answer this server with Cloudflare's challenge; its recommendations API (apus-api) doesn't, and its
  // search API (apus-api …/offers/_search) wants the site's own credentials
  blocksServer: true,
  // https://theprotocol.it/szczegoly/praca/<slug>,oferta,<guid>
  idFromLink: (url) =>
    pathOf(url)
      .match(/,oferta,([0-9a-f-]{36})/i)?.[1]
      ?.toLowerCase() ?? null,
  listing: {
    label: 'The Protocol',
    hint:
      'A theprotocol.it listing page (its Next.js data), 50 offers a page, read through ScrapingAnt (its Cloudflare turns ' +
      'this server away). The default is every IT offer, newest first: one call a run whatever your keywords, and the ' +
      'keyword check reads the title and its technologies. A filter goes in the path: /filtry/react.js;t (the site’s ' +
      'own technology names). Or its recommendations API (apus-api.theprotocol.it/v2/recommendations): the offers ' +
      '“Recommended for you” shows you, which follow your browsing there, for THEPROTOCOL_TRACKING_ID (or trackingId= ' +
      'in the link). Every page costs ScrapingAnt credits, so the schedule makes one call every 15 minutes between its ' +
      'scrapers.',
    defaults: {
      url: 'https://theprotocol.it/praca?sort=date&pageNumber={page}',
      pages: 1,
      checkKeyword: true,
      checkLocation: true,
    },
    // ScrapingAnt's free 10,000 credits a month, shared with Eldorado: one listing page every 30 minutes is ~1,500
    minutesPerCall: 15,
    seeds: [
      { name: 'The Protocol' },
      {
        name: 'The Protocol – recommended',
        url: 'https://apus-api.theprotocol.it/v2/recommendations?context=listing&source=protocol&offset=0&limit=100',
      },
    ],
  },
};
