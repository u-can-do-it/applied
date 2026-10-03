// theprotocol.it: known by its links only (an application's link), no scraper.
import type { Board } from './types.ts';

export const theprotocol: Board<'theprotocol'> = {
  id: 'theprotocol',
  label: 'The Protocol',
  hosts: [/(^|\.)theprotocol\.it$/],
};
