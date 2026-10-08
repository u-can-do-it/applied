// Remote OK: its public API answers JSON, a list whose first item is its terms, then its newest jobs. location
// says who may apply ("Worldwide", "Europe", "Singapore"; empty: anyone).
import { arr, isObj, json, keysOf, sampleOf, seniorityOf, str, strip, type Obj } from '../extract';
import { remoteHere } from '../match';
import type { ListingParser } from '../types';

/**
 * Remote OK sends some text as UTF-8 read as Latin-1 ("KrakÃ³w" for "Kraków"), which the city filter would
 * miss: decoded again when it is that.
 */
export function unmangled(text: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(text) || /[^\u0000-ÿ]/.test(text)) return text;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, (char) => char.charCodeAt(0)));
  } catch {
    return text;
  }
}

const textOf = (value: unknown) => unmangled(strip(str(value)));

export const parseRemoteok: ListingParser = (body, { src }) => {
  const data = json(body, 'The Remote OK answer');
  if (!Array.isArray(data)) throw new Error(`Remote OK: no jobs list (got ${keysOf(data)})`);
  // its terms, then the jobs
  const jobs = data.filter((item): item is Obj => isObj(item) && item.id !== undefined);
  return {
    total: jobs.length,
    sample: sampleOf({ ...jobs[0], description: str(jobs[0]?.description).slice(0, 300) }),
    items: jobs.map((job) => {
      const title = textOf(job.position);
      const location = textOf(job.location).replace(/,\s*$/, '');
      return {
        src,
        id: str(job.id),
        title,
        company: textOf(job.company) || null,
        seniority: seniorityOf(title),
        remote: remoteHere(true, location ? [location] : [], title),
        url: str(job.url),
        locations: location ? [location] : [],
        skills: arr(job.tags).map(str).filter(Boolean),
        // no sort value: its dates are when a job was posted, and one posted a little before the newest one
        // seen would be hidden by a watermark; a new id is what makes an offer new
      };
    }),
  };
};
