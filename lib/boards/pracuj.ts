// pracuj.pl: known by its links only (an application's link), no scraper.
import type { Board } from './types.ts';

export const pracuj: Board<'pracuj'> = {
  id: 'pracuj',
  label: 'Pracuj.pl',
  hosts: [/(^|\.)pracuj\.pl$/],
};
