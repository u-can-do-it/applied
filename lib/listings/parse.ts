import 'server-only';
import type { KindId } from './kinds';
import { PARSERS } from './registry';
import type { ParseContext, Parsed } from './types';

// Page / API body -> offers, with the scraper kind's parser. Filtering (keywords, cities) is not
// done here, see match.ts.

/** Offers without an id, title or link are dropped (the database needs all three). */
export function parseBody(kind: KindId, body: string, ctx: ParseContext): Parsed {
  const parsed = PARSERS[kind](body, ctx);
  return { ...parsed, items: parsed.items.filter((o) => o.id && o.title && o.url) };
}
