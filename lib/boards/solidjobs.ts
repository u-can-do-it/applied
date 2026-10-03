// solid.jobs: its listing: lib/listings/parsers/solidjobs.ts; its ads: the page's JobPosting.
import type { ScrapedBoard } from './types.ts';

export const solidjobs: ScrapedBoard<'solidjobs'> = {
  id: 'solidjobs',
  label: 'Solid.jobs',
  hosts: [/(^|\.)solid\.jobs$/],
  alwaysInFilters: true,
  listing: {
    label: 'Solid.jobs API',
    hint: 'solid.jobs public API; needs the X-Api-Version and campaign headers.',
    defaults: {
      url: 'https://solid.jobs/public-api/offers/IT?campaign=jobwatch&search.searchTerm={keyword}&sortActive=validFrom&sortDirection=desc&pageSize=100',
      headers: { 'X-Api-Version': '1.0', campaign: '44' },
      checkKeyword: true,
      checkLocation: true,
    },
    seeds: [{ name: 'Solid.jobs' }],
  },
};
