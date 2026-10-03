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
    items: jobs.map((offer) => ({
      src,
      id: str(offer.jobOfferKey),
      title: str(offer.title),
      company: str(offer.company) || null,
      seniority: (str(offer.experienceLevel) || 'unknown').toLowerCase(),
      remote: Boolean(offer.isRemote),
      url: str(offer.url),
      skills: arr(offer.skills).map(nameOf).filter(Boolean),
      locations: arr(offer.locations).map(nameOf).filter(Boolean),
      sort: time(offer.validFrom),
    })),
  };
};
