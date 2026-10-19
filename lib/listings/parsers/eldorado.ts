// czyjesteldorado.pl: its MCP server's search_jobs answer (lib/listings/eldorado-mcp.ts), JSON: up to 50 jobs.
import { arr, isObj, json, keysOf, sampleOf, seniorityOf, str } from '../extract';
import type { ListingParser } from '../types';

export const parseEldorado: ListingParser = (body, { src }) => {
  const data = json(body, 'The Eldorado search');
  const jobs = isObj(data) && Array.isArray(data.jobs) ? data.jobs.filter(isObj) : null;
  if (!jobs) throw new Error(`Eldorado: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: jobs.map((job) => {
      // https://czyjesteldorado.pl/praca/461108-python-developer-…?utm_source=mcp: its id, and the link without the tag
      const url = str(job.url).replace(/[?#].*$/, '');
      const id = /\/praca\/(\d+)/.exec(url)?.[1] ?? '';
      const title = str(job.title);
      const level = str(job.seniority); // intern, junior, mid, senior, c_level, or "other"
      return {
        src,
        id,
        title,
        company: str(job.company) || null,
        seniority: level && level !== 'other' ? level : seniorityOf(title),
        remote: arr(job.work_modes).includes('remote'),
        url,
        locations: arr(job.cities).map(str).filter(Boolean),
        skills: arr(job.keywords).map(str).filter(Boolean),
        sort: id ? Number(id) : undefined, // ascending insert counter, as the search page's
      };
    }),
  };
};
