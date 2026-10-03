// Shared by server and client components (no secrets here).

// the built-in boards (keys = offers.src); your own scrapers add theirs, see lib/source-list.ts
export const SOURCES: Record<string, string> = {
  justjoin: 'JustJoin',
  nofluff: 'NoFluff',
  solidjobs: 'Solid.jobs',
  bulldog: 'Bulldog',
  eldorado: 'Eldorado',
  builtin: 'Built In',
};

// relative presets live in the URL as ?days=N, so a bookmarked "7 days" stays relative
export const DAY_PRESETS = [
  { days: '', label: 'Any time' },
  { days: '1', label: 'Today' },
  { days: 'yesterday', label: 'Yesterday' }, // a single closed day, not "up to now"
  { days: '3', label: '3 days' },
  { days: '7', label: '7 days' },
  { days: '30', label: '30 days' },
] as const;

export type FilterKey = 'q' | 'src' | 'days' | 'from' | 'to' | 'page' | 'rejected';
type Changes = Partial<Record<FilterKey, string | number | null | undefined>>;

// Builds a link from the current query, changing only the given keys
// (empty value = remove). Any filter change goes back to the first page.
// `path` keeps you on the tab you're on ("/" or "/ai").
export function withParams(current: URLSearchParams | string, changes: Changes, path = '/') {
  const sp = new URLSearchParams(current);
  if (!('page' in changes)) sp.delete('page');
  for (const [key, value] of Object.entries(changes)) {
    const v = value == null ? '' : String(value);
    if (!v || (key === 'page' && v === '0')) sp.delete(key);
    else sp.set(key, v);
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}
