// theprotocol.it: a search page whose offers are in its __NEXT_DATA__ (offersResponse), with sort=date newest
// first by when an offer was last refreshed.
import { parsePage, scriptById } from '../../dom';
import { arr, isObj, json, nameOf, sampleOf, seniorityOf, str, time } from '../extract';
import type { ListingParser } from '../types';

const OFFER_PAGE = 'https://theprotocol.it/szczegoly/praca/';
// its work modes come in the ad's language: "zdalna", "hybrydowa", "stacjonarna" or "remote", "hybrid", "full office"
const REMOTE = /^(?:zdalna|remote)$/i;
// "2026-10-19T09:31:25.313": UTC without saying so
const utc = (value: unknown) => time(/[zZ]|[+-]\d\d:?\d\d$/.test(str(value)) ? value : `${str(value)}Z`);

export const parseTheprotocol: ListingParser = (body, { src }) => {
  const raw = scriptById(parsePage(body), '__NEXT_DATA__');
  if (raw === null) throw new Error('The Protocol: no __NEXT_DATA__ in the page (blocked or the page changed)');
  const data = json(raw, 'The Protocol page data') as {
    props?: { pageProps?: { offersResponse?: { offers?: unknown } } };
  } | null;
  const listed = data?.props?.pageProps?.offersResponse?.offers;
  if (!Array.isArray(listed))
    throw new Error('The Protocol: props.pageProps.offersResponse.offers is not a list (the page changed?)');
  const offers = listed.filter(isObj);
  return {
    total: offers.length,
    sample: sampleOf(offers[0]),
    items: offers.map((offer) => {
      const title = str(offer.title);
      return {
        src,
        id: str(offer.id),
        title,
        company: str(offer.employer) || null,
        seniority: nameOf(arr(offer.positionLevels)[0]).toLowerCase() || seniorityOf(title),
        remote: arr(offer.workModes).some((mode) => REMOTE.test(str(mode))),
        // without its ?sug= (which list the click came from)
        url: str(offer.offerUrlName) && OFFER_PAGE + str(offer.offerUrlName).replace(/[?#].*$/, ''),
        locations: [
          ...new Set(arr(offer.workplace).map((place) => (isObj(place) ? str(place.city) || str(place.location) : ''))),
        ].filter(Boolean),
        skills: arr(offer.technologies).map(str).filter(Boolean),
        // its first publication: a refreshed old offer, listed among the new ones, stays under the mark
        sort: utc(offer.publicationDateUtc),
      };
    }),
  };
};
