import 'server-only';
import { BOARDS, byId } from '../boards';
import * as scrapersRepo from '../db/repos/scrapers';

// The boards ("sources", offers.src) the offer list filters by.

export type SourceOption = { id: string; label: string };

/** The boards the filters show from the start, without the database. */
export const filterSources = (): SourceOption[] =>
  BOARDS.filter((board) => board.alwaysInFilters).map(({ id, label }) => ({ id, label }));

/** The boards to filter by and their names: those, then your own scrapers' sources. */
export async function sourceOptions(): Promise<SourceOption[]> {
  const own = new Map<string, string>();
  for (const scraper of await scrapersRepo.boards()) {
    const board = byId(scraper.src);
    if (board?.alwaysInFilters || own.has(scraper.src)) continue;
    // a board with a built-in parser keeps its own name (LinkedIn), whatever its searches are called
    own.set(scraper.src, board?.listing ? board.label : scraper.name);
  }
  return [...filterSources(), ...[...own].map(([id, label]) => ({ id, label }))];
}

export const labelsOf = (sources: SourceOption[]) => Object.fromEntries(sources.map((s) => [s.id, s.label]));
