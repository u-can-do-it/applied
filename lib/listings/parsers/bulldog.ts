// bulldogjob.pl: a listing page whose offers are in its __NEXT_DATA__.
import { arr, isObj, json, nameOf, sampleOf, scriptById, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

export const parseBulldog: ListingParser = (body, { src }) => {
  const raw = scriptById(body, '__NEXT_DATA__');
  if (raw === null) throw new Error('Bulldog: no __NEXT_DATA__ in the page (blocked or the page changed)');
  const data = json(raw, 'Bulldog page data') as { props?: { pageProps?: { jobs?: unknown } } } | null;
  const jobs = data?.props?.pageProps?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Bulldog: props.pageProps.jobs is not a list (the page changed?)');
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: (jobs as Obj[]).map((j) => {
      const counter = Number(String(j.id).split('-')[0]); // ascending insert counter
      return {
        src,
        id: str(j.id),
        title: str(j.position),
        company: (isObj(j.company) && str(j.company.name)) || 'unknown',
        seniority: str(j.experienceLevel) || 'unknown',
        remote: j.remote === true,
        url: `https://bulldogjob.pl/companies/jobs/${str(j.id)}`,
        skills: [...arr(j.technologies), ...arr(j.technologyTags)].map(nameOf).filter(Boolean),
        // "", one city, or "Krakow, London, Barcelona"
        locations: str(j.city)
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        sort: Number.isFinite(counter) ? counter : 0,
      };
    }),
  };
};
