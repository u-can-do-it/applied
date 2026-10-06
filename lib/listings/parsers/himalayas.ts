// Himalayas: its search API answers JSON; every job on it is remote, and country=PL keeps the ones open to Poland.
import { arr, isObj, json, keysOf, sampleOf, seniorityOf, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

// its levels -> the ones the other boards use
const SENIORITY: Partial<Record<string, string>> = {
  'Entry-level': 'junior',
  'Mid-level': 'mid',
  Senior: 'senior',
  Manager: 'lead',
  Director: 'lead',
  Executive: 'lead',
};

/** "https://himalayas.app/companies/acme/jobs/react-dev-123" -> "acme/react-dev-123" (lib/boards/himalayas.ts) */
const idOf = (link: string) =>
  link
    .match(/\/companies\/([^/]+)\/jobs\/([^/?#]+)/)
    ?.slice(1, 3)
    .join('/') ?? '';

export const parseHimalayas: ListingParser = (body, { src }) => {
  const data = json(body, 'The Himalayas answer');
  const jobs = isObj(data) && Array.isArray(data.jobs) ? (data.jobs as Obj[]) : null;
  if (!jobs) throw new Error(`Himalayas: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf({ ...jobs[0], description: str(jobs[0]?.description).slice(0, 300) }),
    items: jobs.map((job) => {
      const url = str(job.applicationLink) || str(job.guid);
      const title = str(job.title);
      const countries = arr(job.locationRestrictions).map(str).filter(Boolean);
      return {
        src,
        id: idOf(url),
        title,
        company: str(job.companyName) || null,
        seniority: SENIORITY[str(arr(job.seniority)[0])] ?? seniorityOf(title),
        remote: true,
        url,
        // where you may work from: Poland when it's among them (the search asked for it), else the list, or anywhere
        locations: countries.includes('Poland') ? ['Poland'] : countries.length ? countries : ['Anywhere'],
        // the keyword check reads the title: its categories come from the description ("React-Developer" on a
        // Laravel or a .NET job), so they let any job that mentions React through
        skills: [],
        // no sort value: the first jobs are promoted ones, older than the rest, and pubDate is when it got the
        // job, which can be after a newer one; a watermark would hide new offers as "bumped up"
      };
    }),
  };
};
