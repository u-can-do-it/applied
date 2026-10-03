// nofluffjobs.com: a listing page whose offers are in the Angular state embedded in it.
import { parsePage, scriptById } from '../../dom';
import { angular, arr, isObj, json, num, sampleOf, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

export const parseNofluff: ListingParser = (body, { src }) => {
  const raw = scriptById(parsePage(body), 'serverApp-state');
  if (raw === null) throw new Error('NoFluff: no serverApp-state in the page (blocked or the page changed)');
  const state = json(angular(raw), 'NoFluff page data');
  let postings: Obj[] | null = null;
  for (const value of Object.values(isObj(state) ? state : {})) {
    const entry = isObj(value) && value.body ? value.body : value;
    if (isObj(entry) && Array.isArray(entry.postings) && entry.postings.length) {
      postings = entry.postings as Obj[];
      break;
    }
  }
  if (!postings) throw new Error('NoFluff: no postings in the page data (the page changed?)');
  return {
    total: postings.length,
    sample: sampleOf(postings[0]),
    items: postings.map((offer) => {
      const loc = isObj(offer.location) ? offer.location : {};
      const level: unknown = Array.isArray(offer.seniority) ? offer.seniority[0] : offer.seniority;
      return {
        src,
        id: str(offer.id),
        title: str(offer.title),
        company: str(offer.name) || null,
        seniority: (str(level) || 'unknown').toLowerCase(),
        remote: Boolean(offer.fullyRemote || loc.fullyRemote),
        url: `https://nofluffjobs.com/pl/job/${str(offer.url)}`,
        skills: [str(offer.technology)].filter(Boolean),
        locations: arr(loc.places ?? offer.places)
          .map((pl) => (isObj(pl) ? str(pl.city) : ''))
          .filter(Boolean),
        sort: num(offer.posted), // real publish time, not renewed
      };
    }),
  };
};
