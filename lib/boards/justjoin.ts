// justjoin.it: its listing: lib/listings/parsers/justjoin.ts; its ads: lib/ads/justjoin.ts.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const justjoin: ScrapedBoard<'justjoin'> = {
  id: 'justjoin',
  label: 'JustJoin',
  hosts: [/(^|\.)justjoin\.it$/],
  alwaysInFilters: true,
  idFromLink: (url) => pathOf(url).match(/\/job-offer\/([^/?#]+)/)?.[1] ?? null,
  listing: {
    label: 'JustJoin API',
    hint: 'justjoin.it candidate API, answers JSON.',
    defaults: {
      url: 'https://justjoin.it/api/candidate-api/offers?keywords={keyword}&keywordType=any&sortBy=publishedAt&orderBy=descending&itemsCount=100',
      checkKeyword: true,
      checkLocation: true,
    },
    seeds: [{ name: 'JustJoin' }],
  },
};
