// czyjesteldorado.pl: its listing: lib/listings/parsers/eldorado.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const eldorado: ScrapedBoard<'eldorado'> = {
  id: 'eldorado',
  label: 'Eldorado',
  hosts: [/(^|\.)czyjesteldorado\.pl$/],
  // an employer's page opened from Eldorado counts as Eldorado
  tagsLinks: /czyjesteldorado/i,
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
    seeds: [{ name: 'Eldorado' }],
  },
};
