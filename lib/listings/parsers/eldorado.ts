// czyjesteldorado.pl: a search page whose offers are in its Next.js (app router) data.
import { arr, isObj, json, nameOf, num, sampleOf, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

// Next.js app router: the data comes in self.__next_f.push([1,"…"]) chunks
function flight(html: string) {
  let out = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) {
    try {
      out += JSON.parse(match[1]) as string; // the regex only matches a JSON string
    } catch {
      // a broken chunk: skip it
    }
  }
  return out;
}

/** The JSON array that starts at `key` (e.g. '"jobs":['), cut out by bracket counting. */
function sliceArray(text: string, key: string) {
  const i = text.indexOf(key);
  if (i === -1) return null;
  const start = i + key.length - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inStr) {
      if (esc) esc = false;
      else if (char === '\\') esc = true;
      else if (char === '"') inStr = false;
      continue;
    }
    if (char === '"') inStr = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

export const parseEldorado: ListingParser = (body, { src }) => {
  const raw = sliceArray(flight(body), '"jobs":[');
  if (!raw) throw new Error('Eldorado: no jobs in the page data (blocked or the page changed)');
  const jobs = json(raw, 'Eldorado jobs') as Obj[];
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: jobs.map((offer) => ({
      src,
      id: str(offer.id),
      title: str(offer.title),
      company: (isObj(offer.company) && str(offer.company.name)) || null,
      seniority: str(offer.seniority) || 'unknown',
      remote: arr(offer.workModes).includes('remote'),
      url: `https://czyjesteldorado.pl/praca/${str(offer.id)}-${str(offer.slug)}`,
      // keywords = the tech, categories = ids like "project_management"; older pages had tags
      skills: (offer.keywords || offer.categories
        ? [...arr(offer.keywords), ...arr(offer.categories).map((category) => str(category).replace(/_/g, ' '))]
        : arr(offer.tags)
      )
        .map(nameOf)
        .filter(Boolean),
      locations: arr(offer.cities).map(nameOf).filter(Boolean), // none = no pin icon
      sort: num(offer.id), // insert counter = import order
    })),
  };
};
