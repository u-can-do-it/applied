// Remote OK (remote jobs): its listing: lib/listings/parsers/remoteok.ts; its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const remoteok: ScrapedBoard<'remoteok'> = {
  id: 'remoteok',
  label: 'Remote OK',
  hosts: [/(^|\.)remoteok\.com$/, /(^|\.)remoteok\.io$/],
  // https://remoteok.com/remote-jobs/<title>-<id>
  idFromLink: (url) => pathOf(url).match(/\/remote-jobs\/[^/?#]*?-(\d+)\/?$/)?.[1] ?? null,
  listing: {
    label: 'Remote OK API',
    hint:
      'Remote OK’s public API: its newest remote jobs, about 100, all in one answer (?tag=react narrows them to a ' +
      'tag). The schedule makes one call an hour between its scrapers; Scrape now runs it any time. Its location ' +
      'says who may apply: a job open only to other countries counts as not remote. The keyword check reads the ' +
      'title and its tags.',
    defaults: {
      url: 'https://remoteok.com/api',
      checkKeyword: true,
      checkLocation: true,
    },
    minutesPerCall: 60,
    seeds: [{ name: 'Remote OK' }],
  },
};
