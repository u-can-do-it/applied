// LinkedIn: its public (logged-out) job search, an HTML fragment of up to 10 job cards.
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import { seniorityOf } from '../extract';
import { remoteHere } from '../match';
import type { ListingParser } from '../types';

/**
 * Whether a LinkedIn job is remote, by what its card (or posting) says: "remote" or "zdalnie" in its title or
 * place, or a place that's a whole country or region (LinkedIn's "Polska", "European Union"), where it's done
 * from anywhere. Not the search's f_WT=2 ("remote only"): the logged-out search ignores it (Oct 2026: the
 * same cards with f_WT 1, 2, 3 or none), so trusting it made every office job in Poland "remote".
 */
export function linkedinRemote(title: string, place: string): boolean {
  if (/remote|zdaln/i.test(`${title} ${place}`)) return true;
  return place !== '' && !place.includes(',') && remoteHere(true, [place]);
}

export const parseLinkedin: ListingParser = (body, { src }) => {
  const root = parseHtml(body);
  const cards = root
    .querySelectorAll('[data-entity-urn]')
    .filter((card) => card.getAttribute('data-entity-urn')?.includes('jobPosting:'));
  if (!cards.length) {
    // past the last page LinkedIn answers a bare "<!DOCTYPE html><!---->": no results, not a block
    const bare = body.replace(/<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/gi, '').trim();
    if (!bare || body.includes('base-card')) return { total: 0, items: [] };
    throw new Error('LinkedIn: no job cards (it asks to log in, or blocks this server)');
  }
  const text = (card: HTMLElement, sel: string) => card.querySelector(sel)?.text.replace(/\s+/g, ' ').trim() ?? '';
  return {
    total: cards.length,
    sample: cards[0].outerHTML.slice(0, 3000),
    items: cards.map((card) => {
      const id = (card.getAttribute('data-entity-urn') ?? '').split(':').pop() ?? ''; // the filter above: always there
      const title = text(card, '.base-search-card__title');
      const location = text(card, '.job-search-card__location');
      return {
        src,
        id,
        title,
        company: text(card, '.base-search-card__subtitle') || null,
        seniority: seniorityOf(title),
        remote: linkedinRemote(title, location),
        url: `https://www.linkedin.com/jobs/view/${id}`, // without the per-request tracking parameters
        skills: [],
        locations: location ? [location] : [],
        // no "newer than what was seen" check: LinkedIn's ids don't follow posting time (an offer
        // from 20 minutes ago can have a lower id than one from 4 hours ago) and its date is only a
        // day; what's new is decided by the database (board + id) and the company + title check
        sort: undefined,
      };
    }),
  };
};
