// theprotocol.it: a listing page (its __NEXT_DATA__: offersResponse, newest first by when an offer was last
// refreshed), or its recommendations API (JSON: the offers ranked for one visitor, its trackingId). Both list the
// offers alike.
import { parsePage, scriptById } from '../../dom';
import { arr, isObj, json, keysOf, nameOf, sampleOf, seniorityOf, str, time } from '../extract';
import type { Found, ListingParser } from '../types';

const OFFER_PAGE = 'https://theprotocol.it/szczegoly/praca/';
// its work modes come in the ad's language: "zdalna", "hybrydowa", "stacjonarna" or "remote", "hybrid", "full office"
const REMOTE = /^(?:zdalna|remote)$/i;
// "2026-10-19T09:31:25.313": UTC without saying so (the page's); the API's have their Z
const utc = (value: unknown) => time(/[zZ]|[+-]\d\d:?\d\d$/.test(str(value)) ? value : `${str(value)}Z`);

/** The listing page's offers, or null when it isn't one. */
function pageOffers(body: string): unknown[] | null {
  const raw = scriptById(parsePage(body), '__NEXT_DATA__');
  if (raw === null) return null;
  const data = json(raw, 'The theprotocol.it page data') as {
    props?: { pageProps?: { offersResponse?: { offers?: unknown } } };
  } | null;
  const offers = data?.props?.pageProps?.offersResponse?.offers;
  return Array.isArray(offers) ? offers : null;
}

export const parseTheprotocol: ListingParser = (body, { src }) => {
  const fromApi = body.trimStart().startsWith('{');
  const data = fromApi ? json(body, 'The theprotocol.it answer') : null;
  const listed = fromApi ? (isObj(data) && Array.isArray(data.offers) ? data.offers : null) : pageOffers(body);
  if (!listed)
    throw new Error(
      fromApi
        ? `theprotocol.it: no offers list (got ${keysOf(data)})`
        : 'theprotocol.it: no offers in the page (no __NEXT_DATA__ with offersResponse)',
    );
  const offers = listed.filter(isObj);
  return {
    total: offers.length,
    sample: sampleOf(offers[0]),
    items: offers.map((offer): Found => {
      const title = str(offer.title);
      // the API's link, or the page's slug; without its ?sug= (which list the click came from)
      const link = str(offer.offerUrl) || (str(offer.offerUrlName) && OFFER_PAGE + str(offer.offerUrlName));
      return {
        src,
        id: str(offer.id),
        title,
        company: str(offer.employer) || null,
        seniority: nameOf(arr(offer.positionLevels)[0]).toLowerCase() || seniorityOf(title),
        remote: arr(offer.workModes).some((mode) => REMOTE.test(str(mode))),
        url: link.replace(/[?#].*$/, ''),
        locations: [
          ...new Set(arr(offer.workplace).map((place) => (isObj(place) ? str(place.city) || str(place.location) : ''))),
        ].filter(Boolean),
        skills: arr(offer.technologies).map(str).filter(Boolean),
        // a page lists a refreshed old offer among the new ones, still with its first publication: under the mark.
        // The recommendations have no sort value: ranked for you, not dated, and an older offer they bring up for
        // the first time is still new to you
        sort: fromApi ? undefined : utc(offer.publicationDateUtc),
      };
    }),
  };
};
