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
    items: offers.map((offer) => ({
      src,
      id: str(offer.slug),
      title: str(offer.title),
      company: str(offer.companyName) || null,
      seniority: str(offer.experienceLevel) || 'unknown',
      remote: offer.workplaceType === 'remote',
      url: `https://justjoin.it/job-offer/${str(offer.slug)}`,
      skills: [...arr(offer.requiredSkills), ...arr(offer.niceToHaveSkills)].map(nameOf).filter(Boolean),
      // the offer's city is also among its locations[]
      locations: [
        ...new Set([
          str(offer.city),
          ...arr(offer.locations).map((location) => (isObj(location) ? str(location.city) : '')),
        ]),
      ].filter(Boolean),
      sort: time(offer.publishedAt), // exact chronological order
    })),
  };
};
