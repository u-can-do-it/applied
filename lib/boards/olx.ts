// olx.pl: known by its links only (an application's link), no scraper.
import type { Board } from './types.ts';

export const olx: Board<'olx'> = {
  id: 'olx',
  label: 'OLX',
  hosts: [/(^|\.)olx\.pl$/],
};
