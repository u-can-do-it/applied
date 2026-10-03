import 'server-only';
import { SOURCES } from './sources';
import { rest, restUrl } from './supabase';

export type SourceOption = { id: string; label: string };

// boards added after the first six: shown only once a scraper uses them
const BOARD_NAMES: Record<string, string> = { linkedin: 'LinkedIn' };

/** The boards to filter by and their names: the six built-in ones, then your own scrapers' sources. */
export async function sourceOptions(): Promise<SourceOption[]> {
  const builtIn = Object.entries(SOURCES).map(([id, label]) => ({ id, label }));
  try {
    const url = restUrl('scrapers');
    url.searchParams.set('select', 'src,name');
    url.searchParams.set('order', 'position.asc,created_at.asc');
    const rows = (await (await rest(url)).json()) as { src: string; name: string }[];
    const own = new Map<string, string>();
    // a board with a built-in parser keeps its own name (LinkedIn), whatever its searches are called
    for (const r of rows) if (!(r.src in SOURCES) && !own.has(r.src)) own.set(r.src, BOARD_NAMES[r.src] ?? r.name);
    return [...builtIn, ...[...own].map(([id, label]) => ({ id, label }))];
  } catch {
    return builtIn; // the migrations haven't run yet (npm run db:migrate)
  }
}

export const labelsOf = (sources: SourceOption[]) => Object.fromEntries(sources.map((s) => [s.id, s.label]));
