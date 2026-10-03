// czyjesteldorado.pl: a search page whose offers are in its Next.js (app router) data.
import { arr, isObj, json, nameOf, num, sampleOf, str, type Obj } from '../extract';
import type { ListingParser } from '../types';

// Next.js app router: the data comes in self.__next_f.push([1,"…"]) chunks
function flight(html: string) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]) as string; // the regex only matches a JSON string
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
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return text.slice(start, k + 1);
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
    items: jobs.map((j) => ({
      src,
      id: str(j.id),
      title: str(j.title),
      company: (isObj(j.company) && str(j.company.name)) || null,
      seniority: str(j.seniority) || 'unknown',
      remote: arr(j.workModes).includes('remote'),
      url: `https://czyjesteldorado.pl/praca/${str(j.id)}-${str(j.slug)}`,
      // keywords = the tech, categories = ids like "project_management"; older pages had tags
      skills: (j.keywords || j.categories
        ? [...arr(j.keywords), ...arr(j.categories).map((c) => str(c).replace(/_/g, ' '))]
        : arr(j.tags)
      )
        .map(nameOf)
        .filter(Boolean),
      locations: arr(j.cities).map(nameOf).filter(Boolean), // none = no pin icon
      sort: num(j.id), // insert counter = import order
    })),
  };
};
