// What a scraper can be and what the scraping settings hold. Shared by the server and the
// Settings page (no secrets here).

import { DEFAULT_TZ } from '../dates';

export const KIND_IDS = [
  'justjoin',
  'nofluff',
  'solidjobs',
  'bulldog',
  'eldorado',
  'builtin',
  'linkedin',
  'json',
  'html',
  'rss',
] as const;
export type KindId = (typeof KIND_IDS)[number];

type Kind = {
  label: string;
  /** the built-in boards: a fixed parser and a fixed src, so their offers keep matching the database */
  src?: string;
  hint: string;
  /** a new scraper of this kind starts with this search (the same as the seeds in drizzle/0003_seed.sql) */
  defaults?: Pick<ScraperConfig, 'url' | 'pages' | 'headers' | 'checkKeyword' | 'checkLocation'>;
};

export const KINDS: Record<KindId, Kind> = {
  justjoin: {
    label: 'JustJoin API',
    src: 'justjoin',
    hint: 'justjoin.it candidate API, answers JSON.',
    defaults: {
      url: 'https://justjoin.it/api/candidate-api/offers?keywords={keyword}&keywordType=any&sortBy=publishedAt&orderBy=descending&itemsCount=100',
      checkKeyword: true,
      checkLocation: true,
    },
  },
  nofluff: {
    label: 'NoFluff listing',
    src: 'nofluff',
    hint: 'A nofluffjobs.com listing page; the offers come from the data embedded in it. The path is a category: /pl/react.',
    defaults: { url: 'https://nofluffjobs.com/pl/{keyword_slug}?sort=newest', checkKeyword: true, checkLocation: true },
  },
  solidjobs: {
    label: 'Solid.jobs API',
    src: 'solidjobs',
    hint: 'solid.jobs public API; needs the X-Api-Version and campaign headers.',
    defaults: {
      url: 'https://solid.jobs/public-api/offers/IT?campaign=jobwatch&search.searchTerm={keyword}&sortActive=validFrom&sortDirection=desc&pageSize=100',
      headers: { 'X-Api-Version': '1.0', campaign: '44' },
      checkKeyword: true,
      checkLocation: true,
    },
  },
  bulldog: {
    label: 'Bulldog listing',
    src: 'bulldog',
    hint: 'A bulldogjob.pl listing page (its __NEXT_DATA__).',
    defaults: {
      url: 'https://bulldogjob.pl/companies/jobs/s/skills,{keyword}/order,published,desc',
      checkKeyword: false,
      checkLocation: true,
    },
  },
  eldorado: {
    label: 'Eldorado search',
    src: 'eldorado',
    hint: 'A czyjesteldorado.pl search page (its Next.js data). The tag is case-sensitive: React.',
    defaults: {
      url: 'https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest',
      checkKeyword: false,
      checkLocation: true,
    },
  },
  builtin: {
    label: 'Built In search',
    src: 'builtin',
    hint: 'A builtin.com search page (its job cards). The link already asks for remote + Poland.',
    defaults: {
      url: 'https://builtin.com/jobs/remote?search={keyword}&daysSinceUpdated=1&city=&state=&country=POL&allLocations=true',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.12.45 Mobile Safari/537.36',
      },
      checkKeyword: true,
      checkLocation: false,
    },
  },
  linkedin: {
    label: 'LinkedIn search (public, no login)',
    src: 'linkedin',
    hint:
      'LinkedIn’s logged-out job search, 10 offers per page, sorted by relevance (it ignores sortBy), so the newest come from a short ' +
      'window: f_TPR=r3600 = posted in the last hour (r86400 = 24 h), over 2 pages. location= a city or a country; f_WT=2 remote only ' +
      '(1 office, 3 hybrid). Its cards have no skills, so the keyword check looks at the title only.',
    defaults: {
      url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r3600&start={start}',
      pages: 2,
      checkKeyword: true,
      checkLocation: true,
    },
  },
  json: {
    label: 'JSON – any API, or JSON inside a page',
    hint: 'Give the path to the list of offers and, for each field, its path inside one offer.',
  },
  html: {
    label: 'HTML – CSS selectors',
    hint: 'Give a CSS selector for one offer card and, for each field, a selector inside the card.',
  },
  rss: { label: 'RSS / Atom feed', hint: 'Title, link, date, author and categories of each item.' },
};

export const isKind = (v: unknown): v is KindId => KIND_IDS.includes(v as KindId);
export const isGeneric = (k: KindId) => !KINDS[k].src;

// Fields of one offer that a generic scraper maps. title and url are required.
export const FIELDS = [
  { id: 'title', label: 'Title', required: true },
  { id: 'url', label: 'Link', required: true },
  { id: 'id', label: 'Id', hint: 'unique per offer; the link if empty' },
  { id: 'company', label: 'Company' },
  { id: 'date', label: 'Published', hint: 'newer = later; used to skip bumped old offers' },
  { id: 'location', label: 'City / location', hint: 'can be a list' },
  { id: 'remote', label: 'Remote', hint: 'true / "remote" = remote' },
  { id: 'skills', label: 'Skills', hint: 'can be a list; searched for the keywords' },
  { id: 'seniority', label: 'Seniority' },
] as const;
export type FieldId = (typeof FIELDS)[number]['id'];

export const JSON_SOURCES = [
  { id: 'body', label: 'The response is JSON' },
  { id: 'next-data', label: 'A page with <script id="__NEXT_DATA__">' },
  { id: 'ld-json', label: 'A page with <script type="application/ld+json">' },
  { id: 'script', label: 'A page with <script id="…"> (give the id)' },
] as const;
export type JsonSource = (typeof JSON_SOURCES)[number]['id'];

export type ScraperConfig = {
  /** {keyword} / {keyword_slug} = each keyword from the settings, so one search per keyword */
  url: string;
  /** with {start} (0, 10, 20…) or {page} (1, 2, 3…) in the link: how many pages to fetch */
  pages?: number;
  headers?: Record<string, string>;
  /** the offer (title or skills) must mention one of the keywords */
  checkKeyword?: boolean;
  /** remote, or in one of the cities */
  checkLocation?: boolean;
  /** json: where the JSON is */
  from?: JsonSource;
  scriptId?: string;
  /** json: path to the list of offers; html: CSS selector of one offer */
  items?: string;
  /** json: a path per field ({path} placeholders allowed for the link); html: a CSS selector (@attr for an attribute) */
  fields?: Partial<Record<FieldId, string>>;
};

export type ScrapeSettings = {
  /** scheduled runs (the endpoint skips while off); "Scrape now" works either way */
  enabled: boolean;
  everyMinutes: number;
  /** in the app's time zone (timeZone): runs from fromHour:00 until toHour:00 */
  fromHour: number;
  toHour: number;
  keywords: string[];
  /** part of a city name ("warszaw" matches Warszawa and Warszawie); empty = anywhere */
  cities: string[];
  /** remote offers pass the city filter */
  remoteOk: boolean;
  /** titles with these words are not saved at all */
  ignore: string[];
  /** titles with these words are saved but not sent to Telegram */
  mute: string[];
  /** send new offers to Telegram */
  notify: boolean;
  /** check new offers against the active AI profile first; Telegram gets only the matches */
  aiFilter: boolean;
  /** the app's time zone (days, times, date filters, the hours above): '' = the browser's, else a fixed one */
  timeZone: string;
  /** the zone of the browser the app was last opened in (what '' follows) */
  browserTimeZone: string;
};

export const DEFAULT_SETTINGS: ScrapeSettings = {
  enabled: true,
  everyMinutes: 5,
  fromHour: 7,
  toHour: 22,
  keywords: ['React'],
  cities: ['warszaw', 'warsaw'],
  remoteOk: true,
  ignore: [],
  mute: ['.net', 'dotnet', 'go', 'golang', 'java'],
  notify: true,
  aiFilter: true,
  timeZone: '',
  browserTimeZone: '',
};

export const INTERVALS = [5, 10, 15, 30, 60, 120] as const;

/** The zone the app runs in: the one picked, else the browser's (as last reported), else DEFAULT_TZ. */
export const effectiveTimeZone = (s: Pick<ScrapeSettings, 'timeZone' | 'browserTimeZone'> | null | undefined) =>
  s?.timeZone || s?.browserTimeZone || DEFAULT_TZ;

/** "a, b ,c" -> ['a', 'b', 'c'] */
export const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
/** what a typed list is saved as: at most 50 words of 60 characters */
export const normalizeList = (s: string) =>
  splitList(s)
    .slice(0, 50)
    .map((w) => w.slice(0, 60));

export const SRC_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
