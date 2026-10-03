// What a listing parser reads from a page and gives back.
import type { ScraperConfig } from './config';

/** One offer as a parser reads it from a board. */
export type Found = {
  src: string;
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean;
  url: string;
  /** cities etc., for the city filter and the Telegram message */
  locations: string[];
  /** searched for the keywords, together with the title */
  skills: string[];
  /** publish time or the board's id counter: higher = newer (see scrapers.mark) */
  sort?: number;
};

export type Parsed = {
  items: Found[];
  /** offers on the page, before anything was skipped */
  total: number;
  /** the first raw offer, for the Settings test (JSON or HTML) */
  sample?: string;
};

export type ParseContext = {
  /** offers.src for what is found: the board's id (a built-in board's, or the one you gave your own scraper) */
  src: string;
  /** the page's link: for relative links, and what the search asked for */
  url: string;
  config: ScraperConfig;
};

/** Page / API body -> offers. Throws, saying what is wrong, when the page can't be read. */
export type ListingParser = (body: string, ctx: ParseContext) => Parsed;
