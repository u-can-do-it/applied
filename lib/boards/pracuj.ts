// pracuj.pl: known by its links only (an application's link), no scraper; its ad: the page's text.
import type { Board } from './types.ts';

export const pracuj: Board<'pracuj'> = {
  id: 'pracuj',
  label: 'Pracuj.pl',
  hosts: [/(^|\.)pracuj\.pl$/],
  // its pages answer this server with Cloudflare's challenge (as The Protocol's, the same company's)
  blocksServer: true,
};
