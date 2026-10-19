// pracuj.pl: a search page whose jobs are in its __NEXT_DATA__ (the dehydrated groupedOffers query), each a group
// of one offer per city. With sc=0 the newest first, promoted ones leading each part of the list.
import { parsePage, scriptById } from '../../dom';
import { arr, isObj, json, sampleOf, seniorityOf, str, time } from '../extract';
import type { ListingParser } from '../types';

// "Praca zdalna", "Praca hybrydowa", "Praca stacjonarna"; in English "Remote work"…
const REMOTE = /zdaln|remote/i;
// "Starszy specjalista / Starsza specjalistka (senior)", "Specjalista / Specjalistka (mid / Regular)"
const LEVEL = /\(([a-z]+)/i;

const seniority = (levels: unknown[], title: string) => {
  const level = str(levels[0]);
  return LEVEL.exec(level)?.[1].toLowerCase() ?? (/ekspert|expert/i.test(level) ? 'expert' : seniorityOf(title));
};

/** The page's groupedOffers, wherever the dehydrated query holding them is. */
function groupsIn(data: unknown): unknown[] | null {
  const queries = (data as { props?: { pageProps?: { dehydratedState?: { queries?: unknown } } } } | null)?.props
    ?.pageProps?.dehydratedState?.queries;
  for (const query of arr(queries)) {
    const found = isObj(query) && isObj(query.state) && isObj(query.state.data) ? query.state.data.groupedOffers : null;
    if (Array.isArray(found)) return found as unknown[];
  }
  return null;
}

export const parsePracuj: ListingParser = (body, { src }) => {
  const raw = scriptById(parsePage(body), '__NEXT_DATA__');
  if (raw === null) throw new Error('Pracuj.pl: no __NEXT_DATA__ in the page (blocked or the page changed)');
  const listed = groupsIn(json(raw, 'Pracuj.pl page data'));
  if (!listed) throw new Error('Pracuj.pl: no groupedOffers in the page data (the page changed?)');
  const groups = listed.filter(isObj);
  return {
    total: groups.length,
    sample: sampleOf({ ...groups[0], jobDescription: str(groups[0]?.jobDescription).slice(0, 300) }),
    items: groups.map((group) => {
      const title = str(group.jobTitle);
      // the first city's offer stands for the job; the others are its places
      const offers = arr(group.offers).filter(isObj);
      const first = offers.at(0);
      return {
        src,
        id: str(first?.partitionId),
        title,
        company: str(group.companyName) || null,
        seniority: seniority(arr(group.positionLevels), title),
        remote: group.isRemoteWorkAllowed === true || arr(group.workModes).some((mode) => REMOTE.test(str(mode))),
        url: str(first?.offerAbsoluteUri).replace(/[?#].*$/, ''),
        locations: [...new Set(offers.map((offer) => str(offer.displayWorkplace)))].filter(Boolean),
        skills: arr(group.technologies).map(str).filter(Boolean),
        // its first publication: lastPublicated moves when it is published again, an old offer bumped up
        sort: time(group.initialPublicated),
      };
    }),
  };
};
