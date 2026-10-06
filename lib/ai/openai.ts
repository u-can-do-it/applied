import 'server-only';
import { OPENAI_TIMEOUT_MS } from '../budgets';
import { env } from '../env';

// Chat Completions with a strict JSON schema, so every answer parses. Plain fetch, no SDK.
// Two jobs, each with its own model / reasoning effort:
//   assessment - offer vs CV + criteria, the careful one      (default gpt-6-luna, high)
//   duplicates - "are these two postings the same job?"       (default gpt-6-luna, low)

export type OfferForAi = {
  n: number;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean | null;
  description: string | null; // full ad text, null when the board couldn't be scraped
};
export type Check = { item: string; met: boolean };
export type Assessment = { n: number; match: boolean; score: number; summary: string; checks: Check[] };

export type JobForAi = {
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean | null;
  board: string;
  first_seen: string;
  excerpt: string | null;
};
export type PairForAi = { p: number; a: JobForAi; b: JobForAi };
export type DupDecision = { p: number; same: boolean; reason: string };

export const aiConfig = () => ({
  assess: { model: env.OPENAI_ASSESS_MODEL ?? env.OPENAI_MODEL, effort: env.OPENAI_ASSESS_EFFORT },
  dedup: { model: env.OPENAI_DEDUP_MODEL ?? env.OPENAI_MODEL, effort: env.OPENAI_DEDUP_EFFORT },
  // "Add application": reading an offer's page into the form
  extract: { model: env.OPENAI_EXTRACT_MODEL ?? env.OPENAI_MODEL, effort: env.OPENAI_EXTRACT_EFFORT },
});
const FILE_CHARS = 15_000; // keep a long CV from dominating every request

const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

async function chat<T>(opts: {
  model: string;
  effort: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const base = env.OPENAI_BASE_URL;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: opts.schemaName, strict: true, schema: opts.schema } },
  };
  if (opts.effort && opts.effort !== 'none') body.reasoning_effort = opts.effort;

  const send = () =>
    fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

  let res = await send();
  // a model without reasoning settings rejects the parameter: retry once without it
  if (res.status === 400 && body.reasoning_effort) {
    const text = await res.text();
    if (!/reasoning/i.test(text)) throw new Error(`OpenAI 400: ${text.slice(0, 300)}`);
    delete body.reasoning_effort;
    res = await send();
  }
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  } | null;
  const msg = json?.choices?.[0]?.message;
  if (msg?.refusal) throw new Error(`OpenAI refused: ${msg.refusal}`);
  return JSON.parse(msg?.content ?? '{}') as T;
}

// ---- assessment --------------------------------------------------------------------------

const ASSESS_SCHEMA = strictObject({
  results: {
    type: 'array',
    items: strictObject({
      n: { type: 'integer' },
      match: { type: 'boolean' },
      score: { type: 'integer' },
      summary: { type: 'string' },
      checks: { type: 'array', items: strictObject({ item: { type: 'string' }, met: { type: 'boolean' } }) },
    }),
  },
});

const ASSESS_SYSTEM = `You assess job offers for one candidate. Each offer has a title, company, seniority, "remote" (false = hybrid or office in Warsaw) and, when available, the full ad text.
For every offer, by its "n":
- match: true if the offer satisfies the candidate's CRITERIA. Reject only on a clear conflict; when the information isn't enough to decide, accept.
- score: 0-100, how well the candidate's skills and experience (from the CRITERIA and the CANDIDATE FILE) cover the offer's key requirements. Must-haves weigh more than nice-to-haves. Without an ad text, judge from the title and keep the score cautious.
- checks: the offer's 3-10 most important requirements, each { item, met }. met = true only if the candidate clearly has it. Short labels such as "React 4+ yrs", "English B2", "AWS".
- summary: one sentence, max 20 words, on the main reason for the score.
Write summary and check labels in the language the CRITERIA are written in.`;

function describeOffer(offer: OfferForAi) {
  const head = JSON.stringify({
    n: offer.n,
    title: offer.title,
    company: offer.company,
    seniority: offer.seniority,
    remote: offer.remote,
  });
  return `### OFFER ${offer.n}\n${head}\n${offer.description ? `AD TEXT:\n${offer.description}` : 'AD TEXT: (not available - judge from the title)'}`;
}

export async function assessOffers(
  criteria: string,
  file: { name: string; text: string } | null,
  offers: OfferForAi[],
) {
  const { model, effort } = aiConfig().assess;
  // criteria + file first: identical across batches, so OpenAI's prompt cache can reuse them
  const context =
    `CRITERIA:\n${criteria.trim() || '(none - use the file)'}\n` +
    (file ? `\nCANDIDATE FILE "${file.name}":\n${file.text.slice(0, FILE_CHARS)}\n` : '');
  const parsed = await chat<{ results?: Assessment[] }>({
    model,
    effort,
    system: ASSESS_SYSTEM,
    user: `${context}\nOFFERS:\n\n${offers.map(describeOffer).join('\n\n')}`,
    schemaName: 'assessments',
    schema: ASSESS_SCHEMA,
  });
  const asked = new Set(offers.map((offer) => offer.n));
  return (parsed.results ?? [])
    .filter((result) => asked.has(result.n))
    .map((result) => ({
      ...result,
      score: Math.max(0, Math.min(100, Math.round(result.score))),
      /* eslint-disable @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unnecessary-condition --
         the model's JSON is only typed, not checked: these guard against a field it left out */
      summary: String(result.summary ?? '').slice(0, 240),
      checks: (result.checks ?? [])
        .slice(0, 12)
        .map((check) => ({ item: String(check.item).slice(0, 80), met: Boolean(check.met) })),
      /* eslint-enable @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unnecessary-condition */
    }));
}

// ---- duplicates --------------------------------------------------------------------------

const DEDUP_SCHEMA = strictObject({
  results: {
    type: 'array',
    items: strictObject({ p: { type: 'integer' }, same: { type: 'boolean' }, reason: { type: 'string' } }),
  },
});

const DEDUP_SYSTEM = `You decide whether two job postings are the same job: the same position at the same company, posted on another job board or re-posted later.
Company names may differ in legal form, spelling or brand ("ACME Group" / "Acme Sp. z o.o.", "EPAM" / "EPAM Systems"). Titles may be worded differently for the same role.
Different seniority, a different tech stack, a different team, project or client, or a different location requirement means different jobs.
When unsure, answer same = false: wrongly merging two jobs hides one of them.
For every pair, by its "p": same, and a reason of at most 12 words.`;

const describeJob = (job: JobForAi) =>
  JSON.stringify({
    title: job.title,
    company: job.company,
    seniority: job.seniority,
    remote: job.remote,
    board: job.board,
    first_seen: job.first_seen.slice(0, 10),
    ...(job.excerpt ? { ad_start: job.excerpt } : {}),
  });

export async function decideDuplicates(pairs: PairForAi[]) {
  const { model, effort } = aiConfig().dedup;
  const parsed = await chat<{ results?: DupDecision[] }>({
    model,
    effort,
    system: DEDUP_SYSTEM,
    user: pairs.map((pair) => `### PAIR ${pair.p}\nA: ${describeJob(pair.a)}\nB: ${describeJob(pair.b)}`).join('\n\n'),
    schemaName: 'duplicates',
    schema: DEDUP_SCHEMA,
  });
  const asked = new Set(pairs.map((pair) => pair.p));
  return (parsed.results ?? [])
    .filter((decision) => asked.has(decision.p))
    .map((decision) => ({
      p: decision.p,
      /* eslint-disable @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unnecessary-condition --
         the model's JSON is only typed, not checked */
      same: Boolean(decision.same),
      reason: String(decision.reason ?? '').slice(0, 160),
      /* eslint-enable @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unnecessary-condition */
    }));
}

// ---- one offer's page -> the "Add application" form ---------------------------------------

export type ExtractedJob = {
  title: string;
  company: string;
  location: string;
  workMode: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  officeDays: string;
  salary: string;
  contract: string;
  seniority: string;
  skills: { name: string; level: number; note: string }[]; // level 0: not given
};

const EXTRACT_SCHEMA = strictObject({
  title: { type: 'string' },
  company: { type: 'string' },
  location: { type: 'string' },
  workMode: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
  officeDays: { type: 'string' },
  salary: { type: 'string' },
  contract: { type: 'string' },
  seniority: { type: 'string' },
  skills: {
    type: 'array',
    items: strictObject({
      name: { type: 'string' },
      level: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      note: { type: 'string' },
    }),
  },
});

const EXTRACT_SYSTEM = `You read the web page of one job offer and fill in a form about it. Use only what the page says; leave a field empty ("") when it doesn't say.
title: the job title as written in the ad, without the company or the city.
company: the employer; if only a recruitment agency is named, the agency.
location: the city or cities ("Warszawa, Kraków"), or the country when that's all there is.
workMode: "remote" for fully remote work, "hybrid" for part office / part home, "onsite" for the office only, "unknown" when it doesn't say.
officeDays: for hybrid work, the days a week in the office and at home when the ad says them, e.g. "2 office / 3 home" (a 5-day week when only one is given; a range as "1–2 office"); else "".
salary: as written, with the currency, the period and the contract when given, e.g. "20 000–25 000 PLN / month (B2B)"; several on separate parts joined with "; ".
contract: e.g. "B2B", "Permanent (UoP)", "B2B, Permanent".
seniority: junior, mid, senior or lead, or "".
skills: the tech stack the ad asks for, at most 20: technologies, programming languages, frameworks, tools, platforms and methods (e.g. "React", "Node.js", "REST APIs", "Unit testing", "Git", "Docker", "GCP BigQuery", "Figma", "Scrum"), not soft skills or years of experience. Short canonical names. Spoken languages first, then the required skills, then the nice-to-haves, each in the ad's order.
  level (JustJoin's scale): 1 nice to have (every nice-to-have / plus / bonus skill), 2 junior (basic knowledge, familiarity), 3 regular (experience, good knowledge, hands-on), 4 advanced (strong, excellent, extensive, in-depth), 5 master (expert); 3 when a required skill's level isn't worded. A spoken language: level 0, with note its level as written ("C1", "B2", "Fluent", "Native"); note is "" for the others.`;

export async function extractJob(page: { url: string; pageTitle: string; text: string }): Promise<ExtractedJob> {
  const { model, effort } = aiConfig().extract;
  return chat<ExtractedJob>({
    model,
    effort,
    system: EXTRACT_SYSTEM,
    user: `URL: ${page.url}\nPAGE TITLE: ${page.pageTitle || '(none)'}\n\nPAGE TEXT:\n${page.text.slice(0, 14_000) || '(empty)'}`,
    schemaName: 'job',
    schema: EXTRACT_SCHEMA,
  });
}
