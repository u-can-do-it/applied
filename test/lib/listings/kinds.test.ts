import { execFileSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { SCRAPED_BOARDS } from '@/lib/boards';
import { scrapers } from '@/lib/db/schema';
import { KIND_IDS, SEED_SCRAPERS, isGeneric, kindOf } from '@/lib/listings/kinds';
import { PARSERS } from '@/lib/listings/registry';

describe('scraper kinds', () => {
  it('each scraped board is a kind with its own src, then the generic ones', () => {
    expect(KIND_IDS).toEqual([...SCRAPED_BOARDS.map((board) => board.id), 'json', 'html', 'rss']);
    for (const board of SCRAPED_BOARDS) expect(kindOf(board.id).src).toBe(board.id);
    expect(KIND_IDS.filter(isGeneric)).toEqual(['json', 'html', 'rss']);
  });

  it('a board with a quota of calls says how many minutes a call; the others have none', () => {
    expect(kindOf('adzuna').minutesPerCall).toBe(20);
    expect(kindOf('himalayas').minutesPerCall).toBe(20); // the same pace
    expect(kindOf('justjoin').minutesPerCall).toBeUndefined();
    expect(kindOf('json').minutesPerCall).toBeUndefined();
  });

  it('every kind has a parser, and every parser a kind', () => {
    expect(Object.keys(PARSERS).sort()).toEqual([...KIND_IDS].sort());
  });

  it('the database allows exactly these kinds, in this order', () => {
    const check = getTableConfig(scrapers).checks.find((one) => one.name === 'scrapers_kind_check');
    const allowed = new PgDialect().sqlToQuery(check?.value ?? sql``).sql;
    expect(allowed).toBe(`kind in (${KIND_IDS.map((kind) => `'${kind}'`).join(', ')})`);
  });

  it("seeds each board's default search, under the names its searches have", () => {
    expect(SEED_SCRAPERS.map(({ name, kind }) => [name, kind])).toEqual([
      ['JustJoin', 'justjoin'],
      ['NoFluff', 'nofluff'],
      ['Solid.jobs', 'solidjobs'],
      ['Bulldog', 'bulldog'],
      ['Eldorado', 'eldorado'],
      ['Built In', 'builtin'],
      ['LinkedIn – Warszawa', 'linkedin'],
      ['LinkedIn – remote', 'linkedin'],
      ['Adzuna', 'adzuna'],
      ['Himalayas', 'himalayas'],
    ]);
    for (const seed of SEED_SCRAPERS) expect(seed.src).toBe(seed.kind);
    expect(SEED_SCRAPERS[0].config).toEqual(kindOf('justjoin').defaults);
    // the remote LinkedIn search: the defaults with another link
    const remote = SEED_SCRAPERS[7].config;
    expect(remote.url).toContain('f_WT=2');
    expect({ ...remote, url: '' }).toEqual({ ...kindOf('linkedin').defaults, url: '' });
  });

  // scripts/db-migrate.ts seeds from the registry in plain Node: it needs the `.ts` in each import
  it('the seeds load in plain Node', () => {
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "const m = await import('./lib/db/seed.ts'); console.log(typeof m.seedBoards)"],
      { encoding: 'utf8' },
    );
    expect(out.trim()).toBe('function');
  });
});
