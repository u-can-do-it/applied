// What a board says about a job besides the ad's text, and the helpers that read it into words.
// Shared: the application forms use the type (no secrets here).

/** What the board says about the job besides the text (any of it may be missing). */
export type JobDetails = {
  salary?: string; // "20 200–23 500 PLN / month; 140–160 PLN / hour (B2B)"
  contract?: string; // "B2B", "Full-time"
  location?: string; // "Warszawa, Gdańsk"
  remote?: boolean; // fully remote (workMode 'remote'); what the rows from before workMode have
  workMode?: WorkMode;
  officeDays?: string; // hybrid: "2 office / 3 home"
  posted?: string; // YYYY-MM-DD
  validUntil?: string; // YYYY-MM-DD
  company?: string;
  skills?: Skill[]; // the tech stack, JustJoin's way; [] when the ad was read and names none
};

/** JustJoin's scale: 1 nice to have … 5 master. */
export const SKILL_LEVELS = ['Nice to have', 'Junior', 'Regular', 'Advanced', 'Master'] as const;
/** One skill the ad asks for: "React" at 4 (Advanced); a language with its level as a note ("C1"). */
export type Skill = { name: string; level?: number; note?: string };
export const isSkillLevel = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= SKILL_LEVELS.length;
/** "Advanced", "C1"; undefined when the ad gives no level. */
export const skillLevelText = (skill: Skill) =>
  skill.note || (isSkillLevel(skill.level) ? SKILL_LEVELS[skill.level - 1] : undefined);

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABELS: Record<WorkMode, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
export const isWorkMode = (value: unknown): value is WorkMode => WORK_MODES.includes(value as WorkMode);

/** Where the job is done: the work mode, or "remote" for a row from before there was one. */
export const workModeOf = (details: JobDetails | null | undefined): WorkMode | undefined =>
  details?.workMode ?? (details?.remote ? 'remote' : undefined);

/** "Remote", "Hybrid (2 office / 3 home)", "On-site"; undefined when the ad doesn't say. */
export function workModeText(details: JobDetails | null | undefined) {
  const mode = workModeOf(details);
  if (!mode) return undefined;
  const days = mode === 'hybrid' ? details?.officeDays : undefined;
  return days ? `${WORK_MODE_LABELS[mode]} (${days})` : WORK_MODE_LABELS[mode];
}

/** One offer's ad as read from its board. */
export type Ad = { text: string; details: JobDetails };

// untyped JSON from a board (a string, a number, an array of them…) printed the way String() prints it
// eslint-disable-next-line @typescript-eslint/no-base-to-string -- the value is untyped JSON; String() is the conversion we want
export const asString = (value: unknown) => String(value ?? '');

export const day = (value: unknown) => {
  const text = typeof value === 'number' ? new Date(value).toISOString() : asString(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : undefined;
};
export const money = (amount: unknown) =>
  typeof amount === 'number' ? amount.toLocaleString('pl-PL') : asString(amount);
export const unit = (raw: unknown) => {
  const name = asString(raw).toLowerCase();
  return (
    ({ hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' } as Partial<Record<string, string>>)[
      name
    ] ?? name
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
export const unique = (xs: (string | undefined)[]) => [
  ...new Set(xs.filter((value): value is string => Boolean(value))),
];

export type Language = { code?: string; level?: string };
export const languages = (xs: Language[]) =>
  xs.map((language) => [language.code, language.level].filter(Boolean).join(' ')).join(', ');
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
/** "en" → "English"; a code Intl doesn't know stays as it is. */
export function languageName(code: string) {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** An offer: its board, its id there, its link. A job has one per board it was posted on. */
export type OfferLink = { src: string; id: string; url: string };
/** How a board's ad is read (lib/ads/<board>.ts). */
export type AdReader = (offer: OfferLink) => Promise<Ad>;
