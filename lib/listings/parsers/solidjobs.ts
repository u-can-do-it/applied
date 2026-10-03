// solid.jobs: its public API answers JSON.
import { arr, isObj, json, keysOf, nameOf, sampleOf, str, time, type Obj } from '../extract';
import type { ListingParser } from '../types';

export const parseSolidjobs: ListingParser = (body, { src }) => {
  const data = json(body, 'The Solid.jobs answer');
  const jobs = isObj(data) && Array.isArray(data.jobs) ? (data.jobs as Obj[]) : null;
  if (!jobs) throw new Error(`Solid.jobs: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: jobs.map((o) => ({
      src,
      id: str(o.jobOfferKey),
      title: str(o.title),
      company: str(o.company) || null,
      seniority: (str(o.experienceLevel) || 'unknown').toLowerCase(),
      remote: Boolean(o.isRemote),
      url: str(o.url),
      skills: arr(o.skills).map(nameOf).filter(Boolean),
      locations: arr(o.locations).map(nameOf).filter(Boolean),
      sort: time(o.validFrom),
    })),
  };
};
