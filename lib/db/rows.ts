import { sql, type Column } from 'drizzle-orm';

/** The first row a query returned, or null if none: a destructured `[row]` would claim there always is one. */
export const first = <T>(rows: readonly T[]): T | null => rows.at(0) ?? null;

/**
 * `(src, id) in (these pairs)` for an offer's board and id, with all the pairs as one jsonb
 * parameter: an `or` per pair would grow the statement with every offer.
 */
export const isOneOf = (src: Column, id: Column, pairs: readonly { src: string; id: string }[]) =>
  sql`(${src}, ${id}) in (select x.src, x.id from jsonb_to_recordset(${JSON.stringify(
    pairs.map((pair) => ({ src: pair.src, id: pair.id })),
  )}::jsonb) as x(src text, id text))`;
