import 'server-only';
import type { KindId } from './kinds';
import { parseBuiltin } from './parsers/builtin';
import { parseBulldog } from './parsers/bulldog';
import { parseEldorado } from './parsers/eldorado';
import { parseHtmlListing, parseJson } from './parsers/generic';
import { parseJustjoin } from './parsers/justjoin';
import { parseLinkedin } from './parsers/linkedin';
import { parseNofluff } from './parsers/nofluff';
import { parseRss } from './parsers/rss';
import { parseSolidjobs } from './parsers/solidjobs';
import type { ListingParser } from './types';

/** Each scraper kind's parser: a scraped board's own (lib/boards/ has the board), or a generic one. */
export const PARSERS = {
  justjoin: parseJustjoin,
  nofluff: parseNofluff,
  solidjobs: parseSolidjobs,
  bulldog: parseBulldog,
  eldorado: parseEldorado,
  builtin: parseBuiltin,
  linkedin: parseLinkedin,
  json: parseJson,
  html: parseHtmlListing,
  rss: parseRss,
} satisfies Record<KindId, ListingParser>;
