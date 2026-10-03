// rocketjobs.pl: known by its links only (an application's link), no scraper.
import type { Board } from './types.ts';

export const rocketjobs: Board<'rocketjobs'> = {
  id: 'rocketjobs',
  label: 'RocketJobs',
  hosts: [/(^|\.)rocketjobs\.pl$/],
};
