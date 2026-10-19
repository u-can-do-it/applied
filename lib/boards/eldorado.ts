// czyjesteldorado.pl: its listing: lib/listings/parsers/eldorado.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const eldorado: ScrapedBoard<'eldorado'> = {
  id: 'eldorado',
  label: 'Eldorado',
  hosts: [/(^|\.)czyjesteldorado\.pl$/],
  // an employer's page opened from Eldorado counts as Eldorado
  tagsLinks: /czyjesteldorado/i,
  aggregator: true,
  blocksServer: true,
  // its search sees through ScrapingAnt's datacenter proxies; its ads stay on them (25 credits an ad is too many)
  residential: /^https:\/\/(?:www\.)?czyjesteldorado\.pl\/search\b/i,
  alwaysInFilters: true,
  idFromLink: (url) => pathOf(url).match(/\/praca\/(\d+)/)?.[1] ?? null,
  listing: {
    label: 'Eldorado search',
    hint: 'A czyjesteldorado.pl search page (its Next.js data). The tag is case-sensitive: React.',
    defaults: {
      url: 'https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest',
      checkKeyword: false,
      checkLocation: true,
    },
    // a residential proxy's 25 credits a page: one search every 3 hours from 7 to 22 is ~3,750 a month, next to
    // The Protocol's and Pracuj.pl's ~1,800 each within ScrapingAnt's free 10,000
    minutesPerCall: 180,
    seeds: [{ name: 'Eldorado' }],
  },
};
