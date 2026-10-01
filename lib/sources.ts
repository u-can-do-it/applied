// Shared by server and client components (no secrets here).

// keys must match the `src` values the Node-RED parsers emit
export const SOURCES: Record<string, string> = {
  justjoin: 'JustJoin',
  nofluff: 'NoFluff',
  solidjobs: 'Solid.jobs',
  bulldog: 'Bulldog',
  eldorado: 'Eldorado',
  builtin: 'Built In',
};

export type Filters = { q?: string; src?: string; page?: string | number };

export function href({ q, src, page }: Filters) {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (src) sp.set('src', src);
  if (page && String(page) !== '0') sp.set('page', String(page));
  const s = sp.toString();
  return s ? `/?${s}` : '/';
}
