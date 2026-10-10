import type { SearchDefaults } from '../listings/config.ts';

/**
 * A job board: what it is and how its links read. Its listing parser is in lib/listings/parsers/ and
 * its ad reader, if it has its own, in lib/ads/ (both server-only; this is in the browser too).
 */
export type Board<Id extends string = string> = {
  /** offers.src, and the scraper kind of its own listing */
  id: Id;
  /** its name in the filters */
  label: string;
  /** its hosts, lowercase and without "www." */
  hosts: RegExp[];
  /** a page elsewhere counts as this board's when its query has this (the board tags the links it sends you on with it) */
  tagsLinks?: RegExp;
  /**
   * Its offers are other boards' (it links on to them): a job also on a board of its own takes its details
   * from that one. The offers_unique view lists these boards (drizzle/0014_offers_unique_own_board_first.sql).
   */
  aggregator?: true;
  /**
   * Its site turns this server away (Eldorado's Cloudflare answers a datacenter with a challenge): a page it
   * refuses is fetched again through ScrapingAnt (lib/scraping-ant.ts) when SCRAPINGANT_API_KEY is set
   */
  blocksServer?: true;
  /** in the board filter from the start; the others once one of your scrapers uses them */
  alwaysInFilters?: boolean;
  /** the offer's id on the board, when its link shows it: what the board's ad reader and pages take */
  idFromLink?(url: URL): string | null;
  /** false: the scraper saves the offer under another id than the link's (offers.id), so its link alone finds it */
  linkIdIsOfferId?: false;
  /** the link without tracking; without this, a board's link loses its whole query and hash */
  cleanLink?(url: URL): string;
  /** how to search it, for a board Jobwatch scrapes */
  listing?: Listing;
};

/** A board's own listing: a scraper kind with a fixed parser (lib/listings/registry.ts) and a fixed src. */
export type Listing = {
  /** the scraper kind's name in Settings */
  label: string;
  hint: string;
  /** a new scraper of this kind starts with this search */
  defaults: SearchDefaults;
  /**
   * Its API's quota of calls, as one call per this many minutes on average: its scrapers run as often as
   * their calls allow, whatever the schedule (lib/listings/quota.ts)
   */
  minutesPerCall?: number;
  /**
   * The first this many minutes of every hour (UTC), when its API turns calls away: the schedule leaves its
   * scrapers out then, so a quota's calls fall between the full hours (lib/listings/quota.ts)
   */
  skipHourStart?: number;
  /**
   * The scrapers the board comes with: the defaults, under this name, with another link if given.
   * `npm run db:migrate` adds them once per database (lib/db/seed.ts), so deleting them is for good.
   */
  seeds: { name: string; url?: string }[];
};

/** A board Jobwatch scrapes. */
export type ScrapedBoard<Id extends string = string> = Board<Id> & { listing: Listing };
