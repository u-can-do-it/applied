// nofluffjobs.com: its listing: lib/listings/parsers/nofluff.ts; its ads: lib/ads/nofluff.ts.
import { pathOf, withoutQuery } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const nofluff: ScrapedBoard<'nofluff'> = {
  id: 'nofluff',
  label: 'NoFluff',
  hosts: [/(^|\.)nofluffjobs\.com$/],
  alwaysInFilters: true,
  // the link's slug is what its API takes; its scraper stores the posting id, so a saved offer is found by link
  idFromLink: (url) => pathOf(url).match(/\/job\/([^/?#]+)/)?.[1] ?? null,
  linkIdIsOfferId: false,
  cleanLink(url) {
    const clean = withoutQuery(url);
    clean.pathname = clean.pathname.replace(/^\/(?:[a-z]{2}\/)?job\//, '/pl/job/'); // the app keeps /pl/job/
    return clean.toString();
  },
  listing: {
    label: 'NoFluff listing',
    hint: 'A nofluffjobs.com listing page; the offers come from the data embedded in it. The path is a category: /pl/react.',
    defaults: { url: 'https://nofluffjobs.com/pl/{keyword_slug}?sort=newest', checkKeyword: true, checkLocation: true },
    seeds: [{ name: 'NoFluff' }],
  },
};
