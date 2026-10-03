// justjoin.it: its candidate API answers JSON, newest first.
import { arr, isObj, json, keysOf, nameOf, sampleOf, str, time, type Obj } from '../extract';
import type { ListingParser } from '../types';

export const parseJustjoin: ListingParser = (body, { src }) => {
  const data = json(body, 'The JustJoin API answer');
  const offers = isObj(data) && Array.isArray(data.data) ? (data.data as Obj[]) : null;
  if (!offers) throw new Error(`JustJoin API: no data list (got ${keysOf(data)})`);
  return {
    total: offers.length,
    sample: sampleOf(offers[0]),
    items: offers.map((o) => ({
      src,
      id: str(o.slug),
      title: str(o.title),
      company: str(o.companyName) || null,
      seniority: str(o.experienceLevel) || 'unknown',
      remote: o.workplaceType === 'remote',
      url: `https://justjoin.it/job-offer/${str(o.slug)}`,
      skills: [...arr(o.requiredSkills), ...arr(o.niceToHaveSkills)].map(nameOf).filter(Boolean),
      // the offer's city is also among its locations[]
      locations: [...new Set([str(o.city), ...arr(o.locations).map((l) => (isObj(l) ? str(l.city) : ''))])].filter(
        Boolean,
      ),
      sort: time(o.publishedAt), // exact chronological order
    })),
  };
};
