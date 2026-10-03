// bulldogjob.pl: a listing page whose offers are in its __NEXT_DATA__.
import { parsePage, scriptById } from '../../dom';
import { arr, isObj, json, nameOf, sampleOf, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

export const parseBulldog: ListingParser = (body, { src }) => {
  const raw = scriptById(parsePage(body), '__NEXT_DATA__');
  if (raw === null) throw new Error('Bulldog: no __NEXT_DATA__ in the page (blocked or the page changed)');
  const data = json(raw, 'Bulldog page data') as { props?: { pageProps?: { jobs?: unknown } } } | null;
  const jobs = data?.props?.pageProps?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Bulldog: props.pageProps.jobs is not a list (the page changed?)');
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: (jobs as Obj[]).map((offer) => {
      const counter = Number(String(offer.id).split('-')[0]); // ascending insert counter
      return {
        src,
        id: str(offer.id),
        title: str(offer.position),
        company: (isObj(offer.company) && str(offer.company.name)) || 'unknown',
        seniority: str(offer.experienceLevel) || 'unknown',
        remote: offer.remote === true,
        url: `https://bulldogjob.pl/companies/jobs/${str(offer.id)}`,
        skills: [...arr(offer.technologies), ...arr(offer.technologyTags)].map(nameOf).filter(Boolean),
        // "", one city, or "Krakow, London, Barcelona"
        locations: str(offer.city)
          .split(',')
          .map((city) => city.trim())
          .filter(Boolean),
        sort: Number.isFinite(counter) ? counter : 0,
      };
    }),
  };
};
