// builtin.com: a search page of job cards (HTML).
import { parsePage } from '../../dom';
import { seniorityOf } from '../extract';
import type { Found, ListingParser } from '../types';

const MODE = /^((?:In-Office or )?Remote|In-Office|Hybrid)$/i;
const line = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim() ?? '';

export const parseBuiltin: ListingParser = (body, { src }) => {
  if (!body.includes('data-id="job-card"'))
    throw new Error('Built In: no job cards in the page (blocked or the markup changed)');
  // one card per <div id="job-card-<job id>">
  const cards = parsePage(body)
    .querySelectorAll('div[id^="job-card-"]')
    .filter((card) => /^job-card-\d+$/.test(card.id));
  const items: Found[] = [];
  for (const card of cards) {
    const id = card.id.slice('job-card-'.length);
    const title = line(card.querySelector('[data-id="job-card-title"]')?.text);
    const company = line(card.querySelector('[data-id="company-title"] span')?.text);
    const href = card
      .querySelectorAll('a[href]')
      .map((link) => link.getAttribute('href') ?? '')
      .find((link) => link.startsWith('/job/'));
    const mode =
      card
        .querySelectorAll('*')
        .find((element) => MODE.test(element.text.trim()))
        ?.text.trim() ?? '';
    if (!title || !href) continue;
    items.push({
      src,
      id,
      title,
      company: company || 'unknown',
      seniority: seniorityOf(title),
      remote: /^remote$/i.test(mode),
      url: `https://builtin.com${href}`,
      skills: [],
      locations: [], // the URL already filters remote + Poland
      sort: Number(id), // ascending job id = insert order
    });
  }
  return { total: cards.length, items, sample: cards[0]?.outerHTML.slice(0, 3000) };
};
