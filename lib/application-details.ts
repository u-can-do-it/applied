import 'server-only';
import { asString, isSkillLevel, workModeOf, type JobDetails, type Skill } from './ads/details';
import { extractJob } from './ai/openai';
import * as applicationsRepo from './db/repos/applications';
import { env } from './env';
import { log } from './log';

// An application's details (salary, contract, where, how): which of them are yours, what a scrape
// or an edit makes of them, and what its saved ad text fills in where the board said nothing.

/** Added by hand or imported (not marked on a scraped offer): its id is ours, not a board's. */
export const ownId = (id: string) => /^(manual|import)-/.test(id);

/** The details "Add application" and "Edit" let you type; only these can be yours. */
export const TYPED_FIELDS = ['salary', 'contract', 'location', 'remote', 'workMode', 'officeDays'] as const;
export type TypedField = (typeof TYPED_FIELDS)[number];
/**
 * What an application keeps: the ad's details, plus which of them you typed (they stay over a new
 * scrape) and when its ad text was read for the ones the board didn't give (readDetailsFromText).
 */
export type SavedDetails = JobDetails & { typed?: TypedField[]; textRead?: string };

const isTypedField = (field: unknown): field is TypedField => TYPED_FIELDS.includes(field as TypedField);
const filled = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== false;
export const hasAny = (details: JobDetails | null | undefined) =>
  Boolean(details && Object.values(details).some(filled));
const withoutList = ({ typed: _, ...details }: SavedDetails) => details;
/** A row from before the work mode: "remote" is its work mode. */
const withWorkMode = (details: SavedDetails | null): SavedDetails | null =>
  details && { ...details, workMode: workModeOf(details) };

/** The form's details as saved: the editable fields you filled in, and their names. */
export function typedDetails(form: JobDetails | null | undefined): SavedDetails {
  const details: SavedDetails = {};
  for (const field of TYPED_FIELDS) {
    const value = form?.[field];
    if (filled(value)) Object.assign(details, { [field]: value });
  }
  const typed = TYPED_FIELDS.filter((field) => field in details);
  return typed.length ? { ...details, typed } : details;
}

/**
 * The details after "Edit", over the rest of what the board said (posted, valid until…). The form
 * shows the saved values, so a field is yours only if it already was or you changed it. A new link
 * is another ad: only what you filled in, without the old one's dates and company.
 */
export function editedDetails(
  saved: SavedDetails | null,
  form: JobDetails | null | undefined,
  id: string,
  sameLink: boolean,
): SavedDetails | null {
  if (!sameLink) {
    const details = typedDetails(form);
    return hasAny(details) ? details : null;
  }
  const was = typedFields(saved, id);
  const before = withWorkMode(saved); // the form shows a remote one as such: unchanged, it isn't yours
  const details: SavedDetails = withoutList(before ?? {});
  const typed: TypedField[] = [];
  for (const field of TYPED_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- field is one of the TYPED_FIELDS, not a dynamic key
    delete details[field];
    const value = form?.[field];
    if (!filled(value)) continue;
    Object.assign(details, { [field]: value });
    if (was.includes(field) || value !== before?.[field]) typed.push(field);
  }
  return hasAny(details) ? { ...details, typed } : null;
}

/** Which saved fields are yours: the list; a row from before it, added by hand or imported: all it has. */
export function typedFields(saved: SavedDetails | null, id: string): TypedField[] {
  const typed = Array.isArray(saved?.typed)
    ? saved.typed.filter(isTypedField)
    : ownId(id)
      ? TYPED_FIELDS.filter((field) => filled(saved?.[field]))
      : [];
  // "remote" typed before there was a work mode: that's the work mode you typed
  return typed.includes('remote') && !typed.includes('workMode') ? [...typed, 'workMode'] : typed;
}

/**
 * The details to save after a scrape: the fields you typed stay, the rest is what the board says.
 * A scrape that says nothing keeps the details saved before, so a failed fetch never wipes them.
 */
export function mergeDetails(
  scraped: JobDetails | null | undefined,
  saved: SavedDetails | null,
  typed: TypedField[],
): SavedDetails | null {
  const old = withoutList(saved ?? {});
  const mine = Object.fromEntries(typed.filter((field) => filled(old[field])).map((field) => [field, old[field]]));
  const merged: SavedDetails = { ...(hasAny(scraped) ? scraped : old), ...mine };
  if (!hasAny(merged)) return null;
  return saved?.typed ? { ...merged, typed: saved.typed } : merged;
}

// ---- details from the ad text --------------------------------------------------------------

/** The details an ad's text can give where the board said nothing. */
const TEXT_FIELDS = ['salary', 'contract', 'location', 'workMode', 'officeDays'] as const;

/**
 * The AI's skills as saved: named ones, a level only on the 1–5 scale, a note only when there's one.
 * Its JSON is only typed, not checked: asString guards against a field it left out.
 */
const skillsOf = (ai: Awaited<ReturnType<typeof extractJob>>['skills'] | undefined): Skill[] =>
  (ai ?? [])
    .map((skill) => ({
      name: asString(skill.name).trim().slice(0, 40),
      level: isSkillLevel(skill.level) ? skill.level : undefined,
      note: asString(skill.note).trim().slice(0, 20) || undefined,
    }))
    .filter((skill) => skill.name)
    .slice(0, 20);

/**
 * Fills the details nobody gave (not the board, not you) from the ad text, by the AI, and marks the
 * text read (`textRead`), so it isn't read again; the skills ([] if it names none) mark it read for
 * them, so a text read before there were skills is read once more. What's there stays. Without
 * OPENAI_API_KEY, or when the AI fails, the details stay as they are (unmarked: read next time).
 */
export async function withTextDetails(
  saved: SavedDetails | null,
  app: { url: string; title: string; content: string | null },
): Promise<SavedDetails | null> {
  const text = app.content?.trim();
  if (!text || !env.OPENAI_API_KEY) return saved;
  let ai: Awaited<ReturnType<typeof extractJob>>;
  try {
    ai = await extractJob({ url: app.url, pageTitle: app.title, text });
  } catch (error) {
    log.warn('Reading the details from the ad text failed', { url: app.url, error });
    return saved;
  }
  const found: JobDetails = {
    salary: ai.salary || undefined,
    contract: ai.contract || undefined,
    location: ai.location || undefined,
    workMode: ai.workMode === 'unknown' ? undefined : ai.workMode,
    officeDays: ai.officeDays || undefined,
  };
  const details: SavedDetails = withWorkMode(saved) ?? {};
  for (const field of TEXT_FIELDS)
    if (!filled(details[field]) && filled(found[field])) Object.assign(details, { [field]: found[field] });
  if (details.workMode === 'remote') details.remote = true;
  // the days in the office are a hybrid job's
  if (details.workMode !== 'hybrid') delete details.officeDays;
  details.skills ??= skillsOf(ai.skills);
  details.textRead = new Date().toISOString();
  return details;
}

const READ_AT_ONCE = 4;
let reading: Promise<number> | null = null; // one pass at a time in this server

/**
 * The applications whose saved ad text wasn't read for its details yet (saved before this was done,
 * or before there were skills, or the AI failed then): read now, `max` at most per call. Returns how many got read.
 */
export function readDetailsFromText(max = 40): Promise<number> {
  if (!env.OPENAI_API_KEY) return Promise.resolve(0);
  reading ??= (async () => {
    let read = 0;
    const due = await applicationsRepo.withUnreadText(max);
    for (let i = 0; i < due.length; i += READ_AT_ONCE) {
      await Promise.all(
        due.slice(i, i + READ_AT_ONCE).map(async (app) => {
          const details = await withTextDetails(app.details, app);
          if (!details?.textRead) return;
          // what was saved meanwhile (an edit, a scrape) wins: only if the details are still the ones read
          if (await applicationsRepo.setDetailsIfUnchanged(app.jobId, app.details, details)) read++;
        }),
      );
    }
    return read;
  })().finally(() => {
    reading = null;
  });
  return reading;
}
