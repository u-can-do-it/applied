import 'server-only';
import { SOURCES } from './sources';
import * as scrapersRepo from './db/repos/scrapers';

export type SourceOption = { id: string; label: string };

// boards added after the first six: shown only once a scraper uses them
const BOARD_NAMES: Record<string, string> = { linkedin: 'LinkedIn' };

/** The six built-in boards: the filters can show these without the database. */
export const builtInSources = (): SourceOption[] => Object.entries(SOURCES).map(([id, label]) => ({ id, label }));

/** The boards to filter by and their names: the six built-in ones, then your own scrapers' sources. */
export async function sourceOptions(): Promise<SourceOption[]> {
  const builtIn = builtInSources();
  const own = new Map<string, string>();
  // a board with a built-in parser keeps its own name (LinkedIn), whatever its searches are called
  for (const r of await scrapersRepo.boards())
    if (!(r.src in SOURCES) && !own.has(r.src)) own.set(r.src, BOARD_NAMES[r.src] ?? r.name);
  return [...builtIn, ...[...own].map(([id, label]) => ({ id, label }))];
}

export const labelsOf = (sources: SourceOption[]) => Object.fromEntries(sources.map((s) => [s.id, s.label]));
