// What a scraper can be: a board's own listing (lib/boards/, a fixed parser and src), or a generic
// JSON / HTML / RSS one you set up. Shared by the server and the Settings page (no parsers here: those
// are in lib/listings/registry.ts, server-only). The `.ts` in the imports: lib/db/seed.ts runs in plain Node.
import { SCRAPED_BOARDS, type ScrapedBoardId } from '../boards/index.ts';
import type { ScraperConfig, SearchDefaults } from './config.ts';

const GENERIC_KINDS = [
  {
    id: 'json',
    label: 'JSON – any API, or JSON inside a page',
    hint: 'Give the path to the list of offers and, for each field, its path inside one offer.',
  },
  {
    id: 'html',
    label: 'HTML – CSS selectors',
    hint: 'Give a CSS selector for one offer card and, for each field, a selector inside the card.',
  },
  { id: 'rss', label: 'RSS / Atom feed', hint: 'Title, link, date, author and categories of each item.' },
] as const;

export type KindId = ScrapedBoardId | (typeof GENERIC_KINDS)[number]['id'];

export type Kind = {
  id: KindId;
  label: string;
  hint: string;
  /** a board's own listing: its offers' src (fixed, so they keep matching the database) */
  src?: string;
  /** a new scraper of this kind starts with this search */
  defaults?: SearchDefaults;
  /** its API's quota: one call per this many minutes (the board's listing.minutesPerCall) */
  minutesPerCall?: number;
};

const KINDS: Kind[] = [
  ...SCRAPED_BOARDS.map(({ id, listing }) => ({
    id,
    src: id,
    label: listing.label,
    hint: listing.hint,
    defaults: listing.defaults,
    minutesPerCall: listing.minutesPerCall,
  })),
  ...GENERIC_KINDS,
];
const BY_ID = new Map(KINDS.map((kind) => [kind.id, kind]));

/** In the order Settings lists them: the boards, then the generic kinds. */
export const KIND_IDS = KINDS.map((kind) => kind.id) as [KindId, ...KindId[]];

export const isKind = (value: unknown): value is KindId => BY_ID.has(value as KindId);
/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- KindId only names kinds in KINDS */
export const kindOf = (id: KindId): Kind => BY_ID.get(id)!;
export const isGeneric = (id: KindId) => !kindOf(id).src;

export type SeedScraper = { name: string; src: string; kind: KindId; config: ScraperConfig };

/** The scrapers each scraped board comes with (lib/db/seed.ts adds them, once per database). */
export const SEED_SCRAPERS: SeedScraper[] = SCRAPED_BOARDS.flatMap(({ id, listing }) =>
  listing.seeds.map(({ name, url }) => ({
    name,
    src: id,
    kind: id,
    config: { ...listing.defaults, ...(url ? { url } : {}) },
  })),
);
