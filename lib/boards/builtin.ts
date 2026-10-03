// builtin.com: its listing: lib/listings/parsers/builtin.ts; its ads: lib/ads/builtin.ts.
import type { ScrapedBoard } from './types.ts';

export const builtin: ScrapedBoard<'builtin'> = {
  id: 'builtin',
  label: 'Built In',
  hosts: [/(^|\.)builtin\.com$/],
  alwaysInFilters: true,
  listing: {
    label: 'Built In search',
    hint: 'A builtin.com search page (its job cards). The link already asks for remote + Poland.',
    defaults: {
      url: 'https://builtin.com/jobs/remote?search={keyword}&daysSinceUpdated=1&city=&state=&country=POL&allLocations=true',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.12.45 Mobile Safari/537.36',
      },
      checkKeyword: true,
      checkLocation: false,
    },
    seeds: [{ name: 'Built In' }],
  },
};
