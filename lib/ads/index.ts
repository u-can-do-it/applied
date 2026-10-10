// Full ad text for one offer, from the board itself (the listings only have its title and the like).
// A board with its own way of reading an ad has a file here; the others' pages have a schema.org
// JobPosting (Eldorado, Bulldog, Solid.jobs), and any other site gives its <main> text.
import 'server-only';
import { byId, type BoardId } from '../boards';
import { mainText, pageTitle, parsePage } from '../dom';
import { htmlToText } from '../shared/html';
import { readBuiltin } from './builtin';
import type { Ad, AdReader, JobDetails, OfferLink } from './details';
import { get } from './fetch';
import { readHimalayas } from './himalayas';
import { findJobPosting, fromJobPosting } from './job-posting';
import { readJustjoin } from './justjoin';
import { readLinkedin } from './linkedin';
import { readNofluff } from './nofluff';
import { readPage } from './page';

export type Scraped = { status: 'ok' | 'empty'; text: string; details: JobDetails };

const AI_CHARS = 8000; // per offer for the AI; requirements come first on every board
const FULL_CHARS = 200_000; // "complete" text for applications, with a sanity cap

const READERS: Partial<Record<BoardId, AdReader>> = {
  justjoin: readJustjoin,
  nofluff: readNofluff,
  builtin: readBuiltin,
  linkedin: readLinkedin,
  himalayas: readHimalayas,
};

function readAd(offer: OfferLink): Promise<Ad> {
  const board = byId(offer.src);
  const reader = board && READERS[board.id];
  if (reader) return reader(offer);
  // a board we scrape has nothing but its JobPosting to give; your own scrapers' boards and any
  // other site: no known layout, so the page's <main> (or <article>)
  return readPage(offer.url, board?.listing ? undefined : (_, html) => mainText(html));
}

const result = (ad: Ad, max: number): Scraped => {
  const text = ad.text.trim();
  return text.length >= 80
    ? { status: 'ok', text: text.slice(0, max), details: ad.details }
    : { status: 'empty', text: '', details: ad.details };
};

/** An ad's text as the AI reads it: an offer's window saves it complete, an AI run reads this much. */
export const adForAi = (text: string) => text.slice(0, AI_CHARS);

/** For the AI: the ad text, capped. Only network / HTTP errors throw, so they can be retried later. */
export async function scrapeOffer(offer: OfferLink): Promise<Scraped> {
  return result(await readAd(offer), AI_CHARS);
}

/** For applications: the complete ad text plus its details. */
export async function scrapeOfferFull(offer: OfferLink): Promise<Scraped> {
  return result(await readAd(offer), FULL_CHARS);
}

/**
 * For "Add application": what a link's page says, for the AI to fill in the form. The boards with
 * an API give their text; any page gives its <title>, its JobPosting or its main text.
 */
export async function readJobPage(offer: OfferLink) {
  let ad: Ad = { text: '', details: {} };
  try {
    if (offer.id) ad = await readAd(offer);
  } catch {
    // the board's API didn't answer: the page below still can
  }
  let title = '';
  try {
    const html = await (await get(offer.url, 'text/html')).text();
    const page = parsePage(html);
    title = pageTitle(page);
    if (ad.text.trim().length < 80) {
      const jp = findJobPosting(page);
      ad = jp
        ? fromJobPosting(jp)
        : {
            text: mainText(html) || htmlToText((page.querySelector('body') ?? page).innerHTML),
            details: ad.details,
          };
    }
  } catch (error) {
    if (ad.text.trim().length < 80) throw error; // nothing at all from this link
  }
  return { pageTitle: title, text: ad.text.trim().slice(0, FULL_CHARS), details: ad.details };
}
