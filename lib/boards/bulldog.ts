// bulldogjob.pl: its listing: lib/listings/parsers/bulldog.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const bulldog: ScrapedBoard<'bulldog'> = {
  id: 'bulldog',
  label: 'Bulldog',
  hosts: [/(^|\.)bulldogjob\.pl$/],
  alwaysInFilters: true,
  idFromLink: (url) => pathOf(url).match(/\/companies\/jobs\/([^/?#]+)/)?.[1] ?? null,
  listing: {
    label: 'Bulldog listing',
    hint: 'A bulldogjob.pl listing page (its __NEXT_DATA__).',
    defaults: {
      url: 'https://bulldogjob.pl/companies/jobs/s/skills,{keyword}/order,published,desc',
      checkKeyword: false,
      checkLocation: true,
    },
    seeds: [{ name: 'Bulldog' }],
  },
};
