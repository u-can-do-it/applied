// The scrapers each board comes with (lib/boards/, `listing.seeds`), added once per database: after
// the migrations, `npm run db:migrate` adds those of every board without its `board:<id>` marker in
// scrape_seeds, and the marker. So a new board's searches appear by themselves, and the ones you
// deleted don't come back (the boards seeded before this existed got their marker in 0004_board_seeds).
//
// No `server-only`, and `.ts` in the imports: scripts/db-migrate.ts runs this in plain Node.

import type { Sql } from 'postgres';
import { SEED_SCRAPERS } from '../listings/kinds.ts';

const marker = (board: string) => `board:${board}`;

/** Adds the seeds of the boards not seeded yet, in one transaction; returns those boards. */
export async function seedBoards(client: Sql): Promise<string[]> {
  const boards = [...new Set(SEED_SCRAPERS.map((seed) => seed.src))];
  return client.begin(async (tx) => {
    const seeded: string[] = [];
    for (const board of boards) {
      // the marker first: of two migrations at once, only one gets to add the scrapers
      const claimed = await tx`
        insert into public.scrape_seeds (name) values (${marker(board)}) on conflict (name) do nothing returning name`;
      if (!claimed.length) continue;
      const [{ last }] = await tx<{ last: number }[]>`
        select coalesce(max(position), 0)::int as last from public.scrapers`;
      const seeds = SEED_SCRAPERS.filter((seed) => seed.src === board);
      for (const [index, seed] of seeds.entries())
        await tx`
          insert into public.scrapers (position, name, src, kind, config)
          values (${last + index + 1}, ${seed.name}, ${seed.src}, ${seed.kind}, ${JSON.stringify(seed.config)}::jsonb)`;
      seeded.push(board);
    }
    return seeded;
  });
}
