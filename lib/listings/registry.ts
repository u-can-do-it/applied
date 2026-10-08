import 'server-only';
import type { KindId } from './kinds';
import { parseAdzuna } from './parsers/adzuna';
import { parseAts } from './parsers/ats';
import { parseBuiltin } from './parsers/builtin';
import { parseBulldog } from './parsers/bulldog';
import { parseEldorado } from './parsers/eldorado';
import { parseHtmlListing, parseJson } from './parsers/generic';
import { parseHimalayas } from './parsers/himalayas';
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
  adzuna: parseAdzuna,
  himalayas: parseHimalayas,
  json: parseJson,
  html: parseHtmlListing,
  rss: parseRss,
  ats: parseAts,
} satisfies Record<KindId, ListingParser>;
