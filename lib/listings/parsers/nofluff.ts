// nofluffjobs.com: a listing page whose offers are in the Angular state embedded in it.
import { angular, arr, isObj, json, num, sampleOf, scriptById, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

export const parseNofluff: ListingParser = (body, { src }) => {
  const raw = scriptById(body, 'serverApp-state');
  if (raw === null) throw new Error('NoFluff: no serverApp-state in the page (blocked or the page changed)');
  const state = json(angular(raw), 'NoFluff page data');
  let postings: Obj[] | null = null;
  for (const v of Object.values(isObj(state) ? state : {})) {
    const o = isObj(v) && v.body ? v.body : v;
    if (isObj(o) && Array.isArray(o.postings) && o.postings.length) {
      postings = o.postings as Obj[];
      break;
    }
  }
  if (!postings) throw new Error('NoFluff: no postings in the page data (the page changed?)');
  return {
    total: postings.length,
    sample: sampleOf(postings[0]),
    items: postings.map((p) => {
      const loc = isObj(p.location) ? p.location : {};
      const level: unknown = Array.isArray(p.seniority) ? p.seniority[0] : p.seniority;
      return {
        src,
        id: str(p.id),
        title: str(p.title),
        company: str(p.name) || null,
        seniority: (str(level) || 'unknown').toLowerCase(),
        remote: Boolean(p.fullyRemote || loc.fullyRemote),
        url: `https://nofluffjobs.com/pl/job/${str(p.url)}`,
        skills: [str(p.technology)].filter(Boolean),
        locations: arr(loc.places ?? p.places)
          .map((pl) => (isObj(pl) ? str(pl.city) : ''))
          .filter(Boolean),
        sort: num(p.posted), // real publish time, not renewed
      };
    }),
  };
};
