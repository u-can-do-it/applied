// Full ad text for one offer, from the board itself (the listings only have its title and the like).
// A board with its own way of reading an ad has a file here; the others' pages have a schema.org
// JobPosting (Eldorado, Bulldog, Solid.jobs), and any other site gives its <main> text.
import 'server-only';
import { byId, type BoardId } from '../boards';
import { decodeEntities, htmlToText } from '../shared/html';
import { readBuiltin } from './builtin';
import type { Ad, AdReader, Copy, JobDetails } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';
import { readJustjoin } from './justjoin';
import { readLinkedin } from './linkedin';
import { readNofluff } from './nofluff';
import { mainText, readPage } from './page';

export type Scraped = { status: 'ok' | 'empty'; text: string; details: JobDetails };

const AI_CHARS = 8000; // per offer for the AI; requirements come first on every board
const FULL_CHARS = 200_000; // "complete" text for applications, with a sanity cap

const READERS: Partial<Record<BoardId, AdReader>> = {
  justjoin: readJustjoin,
  nofluff: readNofluff,
  builtin: readBuiltin,
  linkedin: readLinkedin,
};

function readAd(copy: Copy): Promise<Ad> {
  const board = byId(copy.src);
  const reader = board && READERS[board.id];
  if (reader) return reader(copy);
  // a board we scrape has nothing but its JobPosting to give; your own scrapers' boards and any
  // other site: no known layout, so the page's <main> (or <article>)
  return readPage(copy.url, board?.listing ? undefined : mainText);
}

const result = (r: Ad, max: number): Scraped => {
  const text = r.text.trim();
  return text.length >= 80
    ? { status: 'ok', text: text.slice(0, max), details: r.details }
    : { status: 'empty', text: '', details: r.details };
};

/** For the AI: the ad text, capped. Only network / HTTP errors throw, so they can be retried later. */
export async function scrapeOffer(copy: Copy): Promise<Scraped> {
  return result(await readAd(copy), AI_CHARS);
}

/** For applications: the complete ad text plus its details. */
export async function scrapeOfferFull(copy: Copy): Promise<Scraped> {
  return result(await readAd(copy), FULL_CHARS);
}

/**
 * For "Add application": what a link's page says, for the AI to fill in the form. The boards with
 * an API give their text; any page gives its <title>, its JobPosting or its main text.
 */
export async function readJobPage(copy: Copy) {
  let r: Ad = { text: '', details: {} };
  try {
    if (copy.id) r = await readAd(copy);
  } catch {
    // the board's API didn't answer: the page below still can
  }
  let pageTitle = '';
  try {
    const html = await (await get(copy.url, 'text/html')).text();
    pageTitle = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (r.text.trim().length < 80) {
      const jp = findJobPosting(html);
      r = jp
        ? fromJobPosting(jp)
        : { text: mainText(html) || htmlToText(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html), details: r.details };
    }
  } catch (e) {
    if (r.text.trim().length < 80) throw e; // nothing at all from this link
  }
  return { pageTitle, text: r.text.trim().slice(0, FULL_CHARS), details: r.details };
}
