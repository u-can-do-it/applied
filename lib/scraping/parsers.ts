import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import type { FieldId, KindId, ScraperConfig } from './kinds';
import type { Found } from './match';

// Page / API body -> offers. The built-in boards have their own parser (their ids and links never
// change, so the database keeps matching); json / html / rss are driven by the scraper's settings.
// Filtering (keywords, cities) is not done here, see match.ts.

export type Parsed = {
  items: Found[];
  /** offers on the page, before anything was skipped */
  total: number;
  /** the first raw offer, for the Settings test (JSON or HTML) */
  sample?: string;
};

type Ctx = { src: string; url: string; config: ScraperConfig };
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const nameOf = (v: unknown) => (isObj(v) ? str(v.name ?? v.title ?? v.label ?? v.value) : str(v));
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const time = (v: unknown) => {
  if (typeof v === 'number') return v;
  const t = Date.parse(str(v));
  return Number.isFinite(t) ? t : undefined;
};
const keysOf = (v: unknown) => (isObj(v) ? Object.keys(v).slice(0, 12).join(', ') : Array.isArray(v) ? 'a list' : typeof v);
const sampleOf = (v: unknown) => JSON.stringify(v, null, 2)?.slice(0, 3000);

function json(text: string, what: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not JSON: ${text.trim().slice(0, 100)}`);
  }
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (s: string) => decode(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Angular's TransferState escapes its JSON with &q; &a; &l; &g; &s;
const angular = (s: string) => s.replace(/&q;/g, '"').replace(/&a;/g, '&').replace(/&l;/g, '<').replace(/&g;/g, '>').replace(/&s;/g, "'");

function scriptById(html: string, id: string) {
  const re = new RegExp(`<script[^>]*\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)</script>`, 'i');
  return html.match(re)?.[1] ?? null;
}

// ---- the six boards ----------------------------------------------------------------------

function justjoin(body: string, { src }: Ctx): Parsed {
  const data = json(body, 'The JustJoin API answer');
  const offers = isObj(data) && Array.isArray(data.data) ? (data.data as Obj[]) : null;
  if (!offers) throw new Error(`JustJoin API: no data list (got ${keysOf(data)})`);
  return {
    total: offers.length,
    sample: sampleOf(offers[0]),
    items: offers.map((o) => ({
      src,
      id: str(o.slug),
      title: str(o.title),
      company: str(o.companyName) || null,
      seniority: str(o.experienceLevel) || 'unknown',
      remote: o.workplaceType === 'remote',
      url: `https://justjoin.it/job-offer/${str(o.slug)}`,
      skills: [...arr(o.requiredSkills), ...arr(o.niceToHaveSkills)].map(nameOf).filter(Boolean),
      locations: [str(o.city), ...arr(o.locations).map((l) => (isObj(l) ? str(l.city) : ''))].filter(Boolean),
      sort: time(o.publishedAt), // exact chronological order
    })),
  };
}

function nofluff(body: string, { src }: Ctx): Parsed {
  const raw = scriptById(body, 'serverApp-state');
  if (raw === null) throw new Error('NoFluff: no serverApp-state in the page (blocked or the page changed)');
  const state = json(angular(raw), 'NoFluff page data');
  let postings: Obj[] | null = null;
  for (const v of Object.values(isObj(state) ? state : {})) {
    const o = isObj(v) && v.body ? v.body : v;
    if (isObj(o) && Array.isArray(o.postings) && o.postings.length) {
      postings = o.postings as Obj[];
      break;
    }
  }
  if (!postings) throw new Error('NoFluff: no postings in the page data (the page changed?)');
  return {
    total: postings.length,
    sample: sampleOf(postings[0]),
    items: postings.map((p) => {
      const loc = isObj(p.location) ? p.location : {};
      const level = Array.isArray(p.seniority) ? p.seniority[0] : p.seniority;
      return {
        src,
        id: str(p.id),
        title: str(p.title),
        company: str(p.name) || null,
        seniority: (str(level) || 'unknown').toLowerCase(),
        remote: Boolean(p.fullyRemote || loc.fullyRemote),
        url: `https://nofluffjobs.com/pl/job/${str(p.url)}`,
        skills: [str(p.technology)].filter(Boolean),
        locations: arr(loc.places ?? p.places).map((pl) => (isObj(pl) ? str(pl.city) : '')).filter(Boolean),
        sort: num(p.posted), // real publish time, not renewed
      };
    }),
  };
}

function solidjobs(body: string, { src }: Ctx): Parsed {
  const data = json(body, 'The Solid.jobs answer');
  const jobs = isObj(data) && Array.isArray(data.jobs) ? (data.jobs as Obj[]) : null;
  if (!jobs) throw new Error(`Solid.jobs: no jobs list (got ${keysOf(data)})`);
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: jobs.map((o) => ({
      src,
      id: str(o.jobOfferKey),
      title: str(o.title),
      company: str(o.company) || null,
      seniority: (str(o.experienceLevel) || 'unknown').toLowerCase(),
      remote: Boolean(o.isRemote),
      url: str(o.url),
      skills: arr(o.skills).map(nameOf).filter(Boolean),
      locations: arr(o.locations).map(nameOf).filter(Boolean),
      sort: time(o.validFrom),
    })),
  };
}

function bulldog(body: string, { src }: Ctx): Parsed {
  const raw = scriptById(body, '__NEXT_DATA__');
  if (raw === null) throw new Error('Bulldog: no __NEXT_DATA__ in the page (blocked or the page changed)');
  const data = json(raw, 'Bulldog page data') as { props?: { pageProps?: { jobs?: unknown } } };
  const jobs = data?.props?.pageProps?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Bulldog: props.pageProps.jobs is not a list (the page changed?)');
  return {
    total: jobs.length,
    sample: sampleOf(jobs[0]),
    items: (jobs as Obj[]).map((j) => {
      const counter = Number(String(j.id).split('-')[0]); // ascending insert counter
      return {
        src,
        id: str(j.id),
        title: str(j.position),
        company: (isObj(j.company) && str(j.company.name)) || 'unknown',
        seniority: str(j.experienceLevel) || 'unknown',
        remote: j.remote === true,
        url: `https://bulldogjob.pl/companies/jobs/${str(j.id)}`,
        skills: [...arr(j.technologies), ...arr(j.technologyTags)].map(nameOf).filter(Boolean),
        // "", one city, or "Krakow, London, Barcelona"
        locations: str(j.city).split(',').map((c) => c.trim()).filter(Boolean),
        sort: Number.isFinite(counter) ? counter : 0,
      };
    }),
  };
}

// Next.js app router: the data comes in self.__next_f.push([1,"…"]) chunks
function flight(html: string) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]);
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

function eldorado(body: string, { src }: Ctx): Parsed {
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
      skills: arr(j.tags).map(nameOf).filter(Boolean),
      locations: arr(j.cities).map(nameOf).filter(Boolean), // none = no pin icon
      sort: num(j.id), // insert counter = import order
    })),
  };
}

function builtin(body: string, { src }: Ctx): Parsed {
  if (!body.includes('data-id="job-card"')) throw new Error('Built In: no job cards in the page (blocked or the markup changed)');
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
      seniority: /senior|lead|principal/i.test(title) ? 'senior' : /junior|intern|gradu/i.test(title) ? 'junior' : 'unknown',
      remote: /^remote$/i.test(mode),
      url: `https://builtin.com${href}`,
      skills: [],
      locations: [], // the URL already filters remote + Poland
      sort: Number(id), // ascending job id = insert order
    });
  }
  return { total: chunks.length, items, sample: chunks[0] ? `<div id="job-card-${chunks[0].slice(0, 3000)}` : undefined };
}

// LinkedIn's public (logged-out) search: an HTML fragment of up to 10 job cards
function linkedin(body: string, { src, url }: Ctx): Parsed {
  const root = parseHtml(body);
  const cards = root.querySelectorAll('[data-entity-urn]').filter((c) => c.getAttribute('data-entity-urn')?.includes('jobPosting:'));
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
      const id = card.getAttribute('data-entity-urn')!.split(':').pop()!;
      const title = text(card, '.base-search-card__title');
      const location = text(card, '.job-search-card__location');
      return {
        src,
        id,
        title,
        company: text(card, '.base-search-card__subtitle') || null,
        seniority: /senior|lead|principal|staff/i.test(title) ? 'senior' : /junior|intern|trainee|stażyst/i.test(title) ? 'junior' : 'unknown',
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
}

// ---- generic: JSON ---------------------------------------------------------------------------

/**
 * Every value at a path: "data", "props.pageProps.jobs", "locations[].city" ([] = each item of a
 * list, [0] = the first one). Missing parts give nothing instead of an error.
 */
export function valuesAt(root: unknown, path: string | undefined): unknown[] {
  if (!path?.trim()) return [root];
  let cur: unknown[] = [root];
  for (const part of path.trim().split('.')) {
    const m = part.match(/^([^[\]]*)((?:\[\d*\])*)$/);
    if (!m) return [];
    if (m[1]) cur = cur.map((v) => (isObj(v) ? v[m[1]] : undefined));
    for (const b of m[2].match(/\[\d*\]/g) ?? []) {
      cur = b === '[]' ? cur.flatMap((v) => arr(v)) : cur.map((v) => arr(v)[Number(b.slice(1, -1))]);
    }
    cur = cur.filter((v) => v !== undefined && v !== null);
  }
  return cur;
}

const textOf = (v: unknown): string => (typeof v === 'boolean' ? String(v) : isObj(v) ? nameOf(v) : strip(str(v)));
const first = (v: unknown[]) => (v.length ? textOf(v[0]) : '');
const truthy = (v: unknown[]) => v.some((x) => x === true || /^(true|yes|1)$|remote|zdaln/i.test(textOf(x)));
const absolute = (link: string, base: string) => {
  try {
    return link ? new URL(link, base).toString() : '';
  } catch {
    return '';
  }
};

function jsonRoot(body: string, c: ScraperConfig): unknown {
  switch (c.from ?? 'body') {
    case 'next-data': {
      const raw = scriptById(body, '__NEXT_DATA__');
      if (raw === null) throw new Error('No <script id="__NEXT_DATA__"> in the page');
      return json(raw, '__NEXT_DATA__');
    }
    case 'ld-json': {
      const blocks = [...body.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      if (!blocks.length) throw new Error('No <script type="application/ld+json"> in the page');
      return blocks.map((m) => {
        try {
          return JSON.parse(m[1]);
        } catch {
          return null;
        }
      });
    }
    case 'script': {
      if (!c.scriptId) throw new Error('Give the id of the <script> that holds the JSON');
      const raw = scriptById(body, c.scriptId);
      if (raw === null) throw new Error(`No <script id="${c.scriptId}"> in the page`);
      try {
        return JSON.parse(raw);
      } catch {
        return json(angular(raw), `<script id="${c.scriptId}">`);
      }
    }
    default:
      return json(body, 'The answer');
  }
}

function fromJson(body: string, { src, url, config }: Ctx): Parsed {
  const root = jsonRoot(body, config);
  if (!config.items?.trim() && !Array.isArray(root)) {
    throw new Error(`Give the path to the list of offers (the JSON has: ${keysOf(root)})`);
  }
  const at = valuesAt(root, config.items);
  const list = at.length === 1 && Array.isArray(at[0]) ? (at[0] as unknown[]) : at; // "data" and "data[]" both work
  if (!list.length) throw new Error(`Nothing at "${config.items}" (the JSON has: ${keysOf(root)})`);
  const f = config.fields ?? {};
  const get = (item: unknown, field: FieldId) => (f[field]?.trim() ? valuesAt(item, f[field]) : []);
  const link = (item: unknown) => {
    const t = f.url ?? '';
    // "https://site/job/{slug}" fills in values from the offer; otherwise it's a path
    const raw = t.includes('{') ? t.replace(/\{([^}]+)\}/g, (_, p: string) => first(valuesAt(item, p))) : first(get(item, 'url'));
    return absolute(raw, url);
  };
  return { total: list.length, sample: sampleOf(list[0]), items: list.map((item) => toFound(src, item, get, link)) };
}

function toFound(src: string, item: unknown, get: (item: unknown, f: FieldId) => unknown[], link: (item: unknown) => string): Found {
  const url = link(item);
  const date = get(item, 'date')[0];
  return {
    src,
    id: first(get(item, 'id')) || url,
    title: first(get(item, 'title')),
    company: first(get(item, 'company')) || null,
    seniority: first(get(item, 'seniority')) || null,
    remote: truthy(get(item, 'remote')),
    url,
    locations: get(item, 'location').map(textOf).filter(Boolean),
    skills: get(item, 'skills').map(textOf).filter(Boolean),
    sort: num(date) ?? time(date),
  };
}

// ---- generic: HTML -------------------------------------------------------------------------

/** "a.title" = its text, "a.title@href" = an attribute, "@data-id" = the card's own attribute */
function selectorParts(sel: string) {
  const m = sel.trim().match(/^(.*?)(?:@([\w:-]+))?$/);
  return { css: m?.[1]?.trim() ?? '', attr: m?.[2] };
}

function fromHtml(body: string, { src, url, config }: Ctx): Parsed {
  if (!config.items?.trim()) throw new Error('Give the CSS selector of one offer');
  let cards: HTMLElement[];
  try {
    cards = parseHtml(body).querySelectorAll(config.items);
  } catch (e) {
    throw new Error(`Bad selector "${config.items}": ${e instanceof Error ? e.message : e}`);
  }
  if (!cards.length) throw new Error(`No "${config.items}" in the page (${body.length} bytes; blocked, or rendered by JavaScript?)`);
  const f = config.fields ?? {};
  const get = (card: unknown, field: FieldId): unknown[] => {
    const sel = f[field];
    if (!sel?.trim()) return [];
    const { css, attr } = selectorParts(sel);
    const el = card as HTMLElement;
    let found: HTMLElement[];
    try {
      found = css ? el.querySelectorAll(css) : [el];
    } catch {
      return [];
    }
    return found.map((e) => (attr ? e.getAttribute(attr) ?? '' : e.text)).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const link = (card: unknown) => absolute(first(get(card, 'url')), url);
  return { total: cards.length, sample: cards[0].outerHTML.slice(0, 3000), items: cards.map((card) => toFound(src, card, get, link)) };
}

// ---- generic: RSS / Atom ---------------------------------------------------------------------

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : '';
}

function fromRss(body: string, { src, url }: Ctx): Parsed {
  const blocks = body.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  if (!blocks.length) throw new Error('No <item> or <entry> in the feed');
  const items = blocks.map((b): Found => {
    const link = absolute(tag(b, 'link') || (b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? ''), url);
    const author = tag(b, 'dc:creator') || tag(b, 'name') || tag(b, 'author');
    return {
      src,
      id: tag(b, 'guid') || tag(b, 'id') || link,
      title: tag(b, 'title'),
      company: author || null,
      seniority: null,
      remote: /remote|zdaln/i.test(tag(b, 'title')),
      url: link,
      locations: [],
      skills: [...b.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => strip(m[1])).filter(Boolean),
      sort: time(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')),
    };
  });
  return { total: blocks.length, items, sample: blocks[0]?.slice(0, 3000) };
}

const PARSERS: Record<KindId, (body: string, ctx: Ctx) => Parsed> = {
  justjoin, nofluff, solidjobs, bulldog, eldorado, builtin, linkedin, json: fromJson, html: fromHtml, rss: fromRss,
};

/** Offers without an id, title or link are dropped (the database needs all three). */
export function parseBody(kind: KindId, body: string, ctx: Ctx): Parsed {
  const r = PARSERS[kind](body, ctx);
  return { ...r, items: r.items.filter((o) => o.id && o.title && o.url) };
}
