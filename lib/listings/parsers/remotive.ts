// Remotive: its public API answers JSON, a day after the jobs are posted. candidate_required_location says
// who may apply ("Worldwide", "Europe", "USA, Canada").
import { arr, isObj, json, keysOf, sampleOf, seniorityOf, str, strip, type Obj } from '../extract';
import { remoteHere } from '../match';
import type { ListingParser } from '../types';

export const parseRemotive: ListingParser = (body, { src }) => {
  const data = json(body, 'The Remotive answer');
  const jobs = isObj(data) && Array.isArray(data.jobs) ? (data.jobs as Obj[]) : null;
  if (!jobs) throw new Error(`Remotive: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf({ ...jobs[0], description: str(jobs[0]?.description).slice(0, 300) }),
    items: jobs.map((job) => {
      const title = strip(str(job.title));
      const places = str(job.candidate_required_location)
        .split(',')
        .map((place) => place.trim())
        .filter(Boolean);
      return {
        src,
        id: str(job.id),
        title,
        company: strip(str(job.company_name)) || null,
        seniority: seniorityOf(title),
        remote: remoteHere(true, places, title),
        url: str(job.url),
        locations: places,
        skills: arr(job.tags).map(str).filter(Boolean),
        // no sort value: the jobs come a day late, not always in the order they were posted, and a watermark
        // would hide one that came later than a newer one
      };
    }),
  };
};
