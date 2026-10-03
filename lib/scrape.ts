// Full ad text for one offer, from the board itself.
// JustJoin and NoFluff: their public offer API (formatted body, skills, salary). JustJoin's
// JobPosting text has its list items glued together, NoFluff's only has the benefits.
// Eldorado, Bulldog, Solid.jobs: the schema.org JobPosting on the page (what Google Jobs reads).
// Built In: no JobPosting, so the ad body is cut out of the HTML.
// LinkedIn: its public (logged-out) job posting fragment.

import { parse as parseHtml } from 'node-html-parser';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const AI_CHARS = 8000; // per offer for the AI; requirements come first on every board
const FULL_CHARS = 200_000; // "complete" text for applications, with a sanity cap
const TIMEOUT_MS = 12_000;

/** What the board says about the job besides the text (any of it may be missing). */
export type JobDetails = {
  salary?: string; // "20 200–23 500 PLN / month; 140–160 PLN / hour (B2B)"
  contract?: string; // "B2B", "Full-time"
  location?: string; // "Warszawa, Gdańsk"
  remote?: boolean;
  posted?: string; // YYYY-MM-DD
  validUntil?: string; // YYYY-MM-DD
  company?: string;
};
export type Scraped = { status: 'ok' | 'empty'; text: string; details: JobDetails };

const ENTITIES: Partial<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
};
function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

// a real tag starts with a letter, "/" or "!": in "a < b and c > d" the signs are text
const TAG = /<\/?[a-z!][^<>]*>/gi;
const ESCAPED_TAG = /&lt;\/?[a-z!][^<>]*?&gt;/gi;
// untyped JSON from a board (a string, a number, an array of them…) printed the way String() prints it
// eslint-disable-next-line @typescript-eslint/no-base-to-string -- the value is untyped JSON; String() is the conversion we want
const str = (v: unknown) => String(v ?? '');
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
// comments and <?xml …?> go first: a "<" or ">" inside them would cut the tag pass short
const dropComments = (s: string) => s.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, ' ');

/** HTML (possibly entity-escaped, as inside JSON-LD) -> readable plain text with line breaks and bullets */
export function htmlToText(html: unknown): string {
  let s = dropComments(str(html));
  // at least as many escaped tags as real ones (JSON-LD): HTML escaped as text, decoded first
  // ("&lt;li&gt;" -> "<li>"); otherwise an escaped tag is text ("knowledge of &lt;canvas&gt;"),
  // decoded after the tags go
  const escaped = count(s, ESCAPED_TAG);
  if (escaped && escaped >= count(s, TAG)) s = dropComments(decodeEntities(s));
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, '\n')
    .replace(TAG, ' ');
  return decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n{2,}(?=• )/g, '\n') // <li><p>…</p></li> would leave a blank line between bullets
    .trim();
}

const asText = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.description ?? o.value ?? o.credentialCategory ?? '');
  }
  return htmlToText(v);
};

const day = (v: unknown) => {
  const s = typeof v === 'number' ? new Date(v).toISOString() : str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
};
const money = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('pl-PL') : str(n));
const unit = (u: unknown) => {
  const x = str(u).toLowerCase();
  return (
    ({ hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' } as Partial<Record<string, string>>)[x] ??
    x
  );
};
const CONTRACTS: Partial<Record<string, string>> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'B2B / contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
  PER_DIEM: 'Per diem',
  OTHER: 'Other',
  b2b: 'B2B',
  permanent: 'Permanent (UoP)',
  zlecenie: 'Mandate (zlecenie)',
  uop: 'Permanent (UoP)',
  mandate_contract: 'Mandate (zlecenie)',
  specific_task_contract: 'Specific-task (o dzieło)',
  internship: 'Internship',
  any: 'Any',
};
const unique = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

function findJobPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== 'object') continue;
      if (Array.isArray(x)) {
        stack.push(...(x as unknown[]));
        continue;
      }
      const o = x as Record<string, unknown>;
      if (([] as unknown[]).concat(o['@type'] ?? []).includes('JobPosting')) return o;
      if (o['@graph']) stack.push(o['@graph']);
    }
  }
  return null;
}

function detailsFromJobPosting(jp: Record<string, unknown>): JobDetails {
  const salaries = ([] as unknown[]).concat(jp.baseSalary ?? []).map((s) => {
    const m = s as {
      currency?: string;
      value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string };
    } | null;
    const v = m?.value ?? {};
    const range =
      v.minValue != null && v.maxValue != null
        ? `${money(v.minValue)}–${money(v.maxValue)}`
        : money(v.value ?? v.minValue ?? v.maxValue);
    return range
      ? `${range} ${m?.currency ?? ''}${v.unitText ? ` / ${unit(v.unitText)}` : ''}`.replace(/\s+/g, ' ').trim()
      : undefined;
  });
  const places = ([] as unknown[])
    .concat(jp.jobLocation ?? [])
    .map((p) => (p as { address?: { addressLocality?: string } } | null)?.address?.addressLocality);
  return {
    salary: unique(salaries).join('; ') || undefined,
    contract:
      unique(([] as unknown[]).concat(jp.employmentType ?? []).map((t) => CONTRACTS[str(t)] ?? str(t))).join(', ') ||
      undefined,
    location: unique(places).join(', ') || undefined,
    remote: str(jp.jobLocationType).toUpperCase() === 'TELECOMMUTE' || undefined,
    posted: day(jp.datePosted),
    validUntil: day(jp.validThrough),
    company: asText((jp.hiringOrganization as { name?: string } | undefined)?.name) || undefined,
  };
}

function fromJobPosting(jp: Record<string, unknown>) {
  const parts = [
    ['Skills', asText(jp.skills)],
    ['Experience', asText(jp.experienceRequirements)],
    ['Qualifications', asText(jp.qualifications)],
    ['Responsibilities', asText(jp.responsibilities)],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return { text: [...parts, asText(jp.description)].filter(Boolean).join('\n\n'), details: detailsFromJobPosting(jp) };
}

async function get(url: string, accept = 'text/html,application/json') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pl,en;q=0.8', Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// the parts of the boards' offer APIs that are read below; all of it may be missing
type Language = { code?: string; level?: string };
type NofluffPosting = {
  specs?: { dailyTasks?: unknown[] };
  requirements?: {
    musts?: { value?: string }[];
    nices?: { value?: string }[];
    languages?: Language[];
    description?: string;
  };
  basics?: { seniority?: string[] };
  details?: { description?: string };
  essentials?: {
    originalSalary?: { currency?: string; types?: Record<string, { period?: string; range?: number[] }> };
  };
  location?: { places?: { city?: string }[] };
  posted?: number;
  expiresAt?: number;
  company?: { name?: string };
};
type Skill = { name?: string; level?: number };
// employmentTypes also lists conversions to other currencies: keep the offer's own
// from / to are monthly amounts; fromPerUnit / toPerUnit are per `unit` (100 PLN / hour, not 16 800)
type Pay = {
  from?: number;
  to?: number;
  fromPerUnit?: number;
  toPerUnit?: number;
  currency?: string;
  currencySource?: string;
  type?: string;
  unit?: string;
};
type JustjoinOffer = {
  requiredSkills?: Skill[];
  niceToHaveSkills?: Skill[];
  experienceLevel?: string;
  languages?: Language[];
  body?: string;
  employmentTypes?: Pay[];
  workplaceType?: string;
  city?: string;
  publishedAt?: string;
  expiredAt?: string;
  companyName?: string;
};
const languages = (xs: Language[]) => xs.map((l) => [l.code, l.level].filter(Boolean).join(' ')).join(', ');

async function nofluff(id: string) {
  const p = (await (
    await get(`https://nofluffjobs.com/api/posting/${encodeURIComponent(id)}`)
  ).json()) as NofluffPosting;
  const list = (xs: { value?: string }[] | undefined) =>
    (xs ?? [])
      .map((x) => x.value)
      .filter(Boolean)
      .join(', ');
  const tasks = (p.specs?.dailyTasks ?? []).map((t) => `• ${str(t).trim()}`).join('\n');
  const text = [
    list(p.requirements?.musts) && `Must have: ${list(p.requirements?.musts)}`,
    list(p.requirements?.nices) && `Nice to have: ${list(p.requirements?.nices)}`,
    p.basics?.seniority?.length && `Seniority: ${p.basics.seniority.join(', ')}`,
    p.requirements?.languages?.length && `Languages: ${languages(p.requirements.languages)}`,
    htmlToText(p.requirements?.description),
    tasks && `Daily tasks:\n${tasks}`,
    htmlToText(p.details?.description),
  ]
    .filter(Boolean)
    .join('\n\n');

  const sal = p.essentials?.originalSalary;
  const types = Object.entries(sal?.types ?? {});
  const cities = (p.location?.places ?? []).map((pl) => pl.city);
  const details: JobDetails = {
    salary:
      types
        .map(([k, t]) =>
          `${(t.range ?? []).map(money).join('–')} ${sal?.currency ?? ''} / ${unit(t.period)} (${CONTRACTS[k] ?? k})`.replace(
            /\s+/g,
            ' ',
          ),
        )
        .join('; ') || undefined,
    contract: unique(types.map(([k]) => CONTRACTS[k] ?? k)).join(', ') || undefined,
    location: unique(cities.filter((c) => c && c !== 'Remote')).join(', ') || undefined,
    remote: cities.includes('Remote') || undefined,
    posted: day(p.posted),
    validUntil: day(p.expiresAt),
    company: p.company?.name || undefined,
  };
  return { text, details };
}

async function justjoin(slug: string) {
  const j = (await (
    await get(`https://justjoin.it/api/candidate-api/offers/${encodeURIComponent(slug)}`, 'application/json')
  ).json()) as JustjoinOffer;
  const skills = (xs: Skill[] | undefined) =>
    (xs ?? [])
      .map((x) => (x.level ? `${x.name} (${x.level}/5)` : x.name))
      .filter(Boolean)
      .join(', ');
  const text = [
    skills(j.requiredSkills) && `Must have: ${skills(j.requiredSkills)}`,
    skills(j.niceToHaveSkills) && `Nice to have: ${skills(j.niceToHaveSkills)}`,
    j.experienceLevel && `Seniority: ${j.experienceLevel}`,
    j.languages?.length && `Languages: ${languages(j.languages)}`,
    htmlToText(j.body),
  ]
    .filter(Boolean)
    .join('\n\n');

  const amount = (perUnit?: number, monthly?: number) => {
    const v = perUnit ?? monthly;
    return v == null ? undefined : Math.round(v * 100) / 100;
  };
  const pay = (j.employmentTypes ?? []).filter((e) => e.currencySource !== 'conversion');
  const workplace = str(j.workplaceType);
  const details: JobDetails = {
    salary:
      unique(
        pay
          .filter((e) => e.from || e.to)
          .map((e) =>
            `${[amount(e.fromPerUnit, e.from), amount(e.toPerUnit, e.to)]
              .filter((x) => x != null)
              .map(money)
              .join(
                '–',
              )} ${e.currency?.toUpperCase() ?? ''} / ${unit(e.unit)} (${CONTRACTS[e.type ?? ''] ?? e.type})`.replace(
              /\s+/g,
              ' ',
            ),
          ),
      ).join('; ') || undefined,
    contract: unique(pay.map((e) => CONTRACTS[e.type ?? ''] ?? e.type)).join(', ') || undefined,
    location: j.city
      ? `${j.city}${workplace === 'hybrid' ? ' (hybrid)' : workplace === 'office' ? ' (office)' : ''}`
      : undefined,
    remote: workplace === 'remote' || undefined,
    posted: day(j.publishedAt),
    validUntil: day(j.expiredAt),
    company: j.companyName || undefined,
  };
  return { text, details };
}

function builtinBody(html: string) {
  const i = html.search(/id="job-post-body-\d+"/);
  if (i < 0) return '';
  const start = html.indexOf('>', i) + 1;
  // the body is one block; the next section starts with another id="job-..." or a <section>
  const rest = html.slice(start);
  const end = rest.search(/<section|id="job-(?!post-body)/);
  return htmlToText(end > 0 ? rest.slice(0, end) : rest.slice(0, 60_000));
}

// criteria come in the page's language (Accept-Language: pl first)
const LI_CONTRACT = ['Employment type', 'Forma zatrudnienia', 'Rodzaj zatrudnienia'];

async function linkedin(id: string) {
  const html = await (
    await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(id)}`, 'text/html')
  ).text();
  const root = parseHtml(html);
  const one = (sel: string) => root.querySelector(sel)?.text.replace(/\s+/g, ' ').trim() || undefined;
  const criteria = root
    .querySelectorAll('.description__job-criteria-item')
    .map((li) => [
      li.querySelector('.description__job-criteria-subheader')?.text.trim() ?? '',
      li.querySelector('.description__job-criteria-text')?.text.replace(/\s+/g, ' ').trim() ?? '',
    ]);
  const description = htmlToText(root.querySelector('.show-more-less-html__markup')?.innerHTML ?? '');
  const details: JobDetails = {
    company: one('.topcard__org-name-link'),
    location: one('.topcard__flavor--bullet'),
    salary: one('.compensation__salary'),
    contract: criteria.find(([k]) => LI_CONTRACT.includes(k))?.[1],
  };
  const lines = criteria.filter(([k, v]) => k && v).map(([k, v]) => `${k}: ${v}`);
  return { text: [lines.join('\n'), description].filter(Boolean).join('\n\n'), details };
}

// your own scrapers' boards: no known layout, so the page's <main> (or <article>) as text
const BOARDS = new Set(['justjoin', 'nofluff', 'solidjobs', 'bulldog', 'eldorado', 'builtin', 'linkedin']);
function mainText(html: string) {
  const m = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  return m ? htmlToText(m[1]) : '';
}

async function fromPage(copy: { src: string; url: string }) {
  const html = await (await get(copy.url, 'text/html')).text();
  const jp = findJobPosting(html);
  if (jp) return fromJobPosting(jp);
  return { text: copy.src === 'builtin' ? builtinBody(html) : BOARDS.has(copy.src) ? '' : mainText(html), details: {} };
}

async function scrape(copy: { src: string; id: string; url: string }): Promise<{ text: string; details: JobDetails }> {
  if (copy.src === 'nofluff') return nofluff(copy.id);
  if (copy.src === 'linkedin') {
    try {
      return await linkedin(copy.id);
    } catch {
      return fromPage(copy); // the job page has a JobPosting too, when LinkedIn shows it
    }
  }
  if (copy.src === 'justjoin') {
    try {
      return await justjoin(copy.id);
    } catch {
      return fromPage(copy); // API changed or down: the page's JobPosting still has the text
    }
  }
  return fromPage(copy);
}

const result = (r: { text: string; details: JobDetails }, max: number): Scraped => {
  const text = r.text.trim();
  return text.length >= 80
    ? { status: 'ok', text: text.slice(0, max), details: r.details }
    : { status: 'empty', text: '', details: r.details };
};

/** For the AI: the ad text, capped. Only network / HTTP errors throw, so they can be retried later. */
export async function scrapeOffer(copy: { src: string; id: string; url: string }): Promise<Scraped> {
  return result(await scrape(copy), AI_CHARS);
}

/**
 * For "Add application": what a link's page says, for the AI to fill in the form. The boards with
 * an API give their text; any page gives its <title>, its JobPosting or its main text.
 */
export async function readJobPage(copy: { src: string; id: string; url: string }) {
  let r: { text: string; details: JobDetails } = { text: '', details: {} };
  try {
    if (copy.id) r = await scrape(copy);
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

/** For applications: the complete ad text plus its details. */
export async function scrapeOfferFull(copy: { src: string; id: string; url: string }): Promise<Scraped> {
  return result(await scrape(copy), FULL_CHARS);
}
