// What one scraper's search holds (scrapers.config). Shared by the server and the Settings page.

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
  /** {keyword} / {keyword_slug} = each keyword from the settings, so one search per keyword; {keywords} = all of them in one search */
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

/** The search a board's own scraper starts with. */
export type SearchDefaults = Pick<ScraperConfig, 'url' | 'pages' | 'headers' | 'checkKeyword' | 'checkLocation'>;
