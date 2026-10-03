// LinkedIn: its public (logged-out) job search, an HTML fragment of up to 10 job cards.
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import { seniorityOf } from '../extract';
import type { ListingParser } from '../types';

export const parseLinkedin: ListingParser = (body, { src, url }) => {
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
  const remoteOnly = /[?&]f_WT=2(?:&|$)/.test(url); // the search itself asked for remote only
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
        remote: remoteOnly || /remote|zdaln/i.test(`${title} ${location}`),
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
