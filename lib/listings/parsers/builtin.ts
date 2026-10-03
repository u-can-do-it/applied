// builtin.com: a search page of job cards (HTML).
import { seniorityOf, strip } from '../extract';
import type { Found, ListingParser } from '../types';

export const parseBuiltin: ListingParser = (body, { src }) => {
  if (!body.includes('data-id="job-card"'))
    throw new Error('Built In: no job cards in the page (blocked or the markup changed)');
  const chunks = body.split(/<div id="job-card-(?=\d)/).slice(1); // one chunk per card
  const items: Found[] = [];
  for (const c of chunks) {
    const id = c.match(/^(\d+)/)?.[1];
    const title = strip(c.match(/data-id="job-card-title"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
    const company = strip(c.match(/data-id="company-title"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const href = c.match(/href="(\/job\/[^"]+)"/)?.[1];
    const mode = strip(c.match(/>((?:In-Office or )?Remote|In-Office|Hybrid)</i)?.[1] ?? '');
    if (!id || !title || !href) continue;
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
  return {
    total: chunks.length,
    items,
    sample: chunks[0] ? `<div id="job-card-${chunks[0].slice(0, 3000)}` : undefined,
  };
};
