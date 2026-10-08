// Jobicy: its public API answers JSON. The link's geo= keeps the jobs open to a country or region, so each one
// is remote from there; jobGeo lists where it is open ("EMEA", "Anywhere", "Bulgaria, Czechia, Poland").
import { isObj, json, keysOf, sampleOf, seniorityOf, str, strip, type Obj } from '../extract';
import type { ListingParser } from '../types';

// its levels -> the ones the other boards use; "Any" says nothing, so the title does
const SENIORITY: Partial<Record<string, string>> = {
  Junior: 'junior',
  Midweight: 'mid',
  Senior: 'senior',
  Director: 'lead',
};

export const parseJobicy: ListingParser = (body, { src }) => {
  const data = json(body, 'The Jobicy answer');
  const jobs = isObj(data) && Array.isArray(data.jobs) ? (data.jobs as Obj[]) : null;
  if (!jobs) throw new Error(`Jobicy: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf({ ...jobs[0], jobDescription: str(jobs[0]?.jobDescription).slice(0, 300) }),
    items: jobs.map((job) => {
      const title = strip(str(job.jobTitle));
      return {
        src,
        id: str(job.id),
        title,
        company: strip(str(job.companyName)) || null,
        seniority: SENIORITY[str(job.jobLevel)] ?? seniorityOf(title),
        remote: true,
        url: str(job.url),
        locations: str(job.jobGeo)
          .split(',')
          .map((place) => place.trim())
          .filter(Boolean),
        // its industries ("Software Engineering") say nothing about the stack: its search (tag=) finds the keyword
        skills: [],
        // no sort value: a watermark would hide a job published a little before the newest one seen
      };
    }),
  };
};
