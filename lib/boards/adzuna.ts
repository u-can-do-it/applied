// Adzuna: its listing: lib/listings/parsers/adzuna.ts (its API keys: lib/listings/api-keys.ts); its ads: the
// page its link leads to.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

// one site per country the API serves
const DOMAINS = [
  'adzuna.pl',
  'adzuna.co.uk',
  'adzuna.com',
  'adzuna.de',
  'adzuna.at',
  'adzuna.ch',
  'adzuna.nl',
  'adzuna.be',
  'adzuna.fr',
  'adzuna.es',
  'adzuna.it',
  'adzuna.ca',
  'adzuna.com.au',
  'adzuna.co.nz',
  'adzuna.com.br',
  'adzuna.com.mx',
  'adzuna.in',
  'adzuna.sg',
  'adzuna.co.za',
];

export const adzuna: ScrapedBoard<'adzuna'> = {
  id: 'adzuna',
  label: 'Adzuna',
  hosts: DOMAINS.map((domain) => new RegExp(`(^|\\.)${domain.replace(/\./g, '\\.')}$`)),
  // the API's redirect_url: /details/<id>?se=…&v=…; older ones: /land/ad/<id>?…
  idFromLink: (url) => pathOf(url).match(/\/(?:land\/ad|details)\/(\d+)/)?.[1] ?? null,
  listing: {
    label: 'Adzuna API',
    hint:
      'Adzuna’s search API (developer.adzuna.com); its keys come from ADZUNA_APP_ID and ADZUNA_APP_KEY, never the link. ' +
      'pl = Poland (gb, de, us…); {keywords} = every keyword in one search (what_or), so a run is one call per page; ' +
      'where= a city, max_days_old= days back. The free plan allows 2,500 calls a month, so its scrapers make one call an hour ' +
      'between them: one scraper of one page runs hourly, two every two hours. Its results have no skills, so the keyword ' +
      'check looks at the title only.',
    defaults: {
      url: 'https://api.adzuna.com/v1/api/jobs/pl/search/{page}?what_or={keywords}&sort_by=date&max_days_old=3&results_per_page=50',
      checkKeyword: true,
      checkLocation: true,
    },
    minutesPerCall: 60,
    seeds: [{ name: 'Adzuna' }],
  },
};
