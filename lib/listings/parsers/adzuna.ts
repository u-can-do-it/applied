// Adzuna: its search API answers JSON, newest first with sort_by=date.
import { arr, isObj, json, keysOf, sampleOf, seniorityOf, str, strip, type Obj } from '../extract';
import type { ListingParser } from '../types';

const REMOTE = /remote|zdaln/i;
// its title may carry <strong> around the words searched for: gone without a space, so "<strong>React</strong>,"
// stays "React,"
const text = (value: unknown) => strip(str(value).replace(/<\/?strong>/gi, ''));

export const parseAdzuna: ListingParser = (body, { src }) => {
  const data = json(body, 'The Adzuna answer');
  const jobs = isObj(data) && Array.isArray(data.results) ? (data.results as Obj[]) : null;
  if (!jobs) throw new Error(`Adzuna: no results list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: jobs.map((job) => {
      const title = text(job.title);
      const location = isObj(job.location) ? job.location : {};
      const place = str(location.display_name);
      return {
        src,
        id: str(job.id),
        title,
        company: (isObj(job.company) && str(job.company.display_name)) || null,
        seniority: seniorityOf(title),
        // no work mode of its own; its description is too loose to tell ("no remote work", "remote days")
        remote: REMOTE.test(`${title} ${place}`),
        url: str(job.redirect_url),
        // "Warszawa, mazowieckie", then ["Polska", "mazowieckie", "Warszawa"]
        locations: [...new Set([place, ...arr(location.area).map(str)])].filter(Boolean),
        // no skills list, and the description mentions every stack in passing: the keyword check reads the title
        skills: [],
        // no sort value: `created` is when the ad was placed on its own site, and Adzuna lists ads hours later,
        // so one placed before the newest seen would count as an old offer bumped up and never be announced
      };
    }),
  };
};
