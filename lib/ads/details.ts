// What a board says about a job besides the ad's text, and the helpers that read it into words.
// Shared: the application forms use the type (no secrets here).

/** What the board says about the job besides the text (any of it may be missing). */
export type JobDetails = {
  salary?: string; // "20 200–23 500 PLN / month; 140–160 PLN / hour (B2B)"
  contract?: string; // "B2B", "Full-time"
  location?: string; // "Warszawa, Gdańsk"
  remote?: boolean;
  posted?: string; // YYYY-MM-DD
  validUntil?: string; // YYYY-MM-DD
  company?: string;
};

/** One offer's ad as read from its board. */
export type Ad = { text: string; details: JobDetails };

// untyped JSON from a board (a string, a number, an array of them…) printed the way String() prints it
// eslint-disable-next-line @typescript-eslint/no-base-to-string -- the value is untyped JSON; String() is the conversion we want
export const asString = (v: unknown) => String(v ?? '');

export const day = (v: unknown) => {
  const s = typeof v === 'number' ? new Date(v).toISOString() : asString(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
};
export const money = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('pl-PL') : asString(n));
export const unit = (u: unknown) => {
  const x = asString(u).toLowerCase();
  return (
    ({ hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' } as Partial<Record<string, string>>)[x] ??
    x
  );
};
export const CONTRACTS: Partial<Record<string, string>> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'B2B / contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
  PER_DIEM: 'Per diem',
  OTHER: 'Other',
  b2b: 'B2B',
  permanent: 'Permanent (UoP)',
  zlecenie: 'Mandate (zlecenie)',
  uop: 'Permanent (UoP)',
  mandate_contract: 'Mandate (zlecenie)',
  specific_task_contract: 'Specific-task (o dzieło)',
  internship: 'Internship',
  any: 'Any',
};
export const unique = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

export type Language = { code?: string; level?: string };
export const languages = (xs: Language[]) => xs.map((l) => [l.code, l.level].filter(Boolean).join(' ')).join(', ');

/** One copy of an offer: its board, its id there, its link. */
export type Copy = { src: string; id: string; url: string };
/** How a board's ad is read (lib/ads/<board>.ts). */
export type AdReader = (copy: Copy) => Promise<Ad>;
