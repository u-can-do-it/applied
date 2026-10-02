import 'server-only';

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
  title: string; company: string | null; seniority: string | null; remote: boolean | null;
  board: string; first_seen: string; excerpt: string | null;
};
export type PairForAi = { p: number; a: JobForAi; b: JobForAi };
export type DupDecision = { p: number; same: boolean; reason: string };

const DEFAULT_MODEL = 'gpt-6-luna';
export const aiConfig = () => ({
  assess: {
    model: process.env.OPENAI_ASSESS_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    effort: process.env.OPENAI_ASSESS_EFFORT || 'high',
  },
  dedup: {
    model: process.env.OPENAI_DEDUP_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    effort: process.env.OPENAI_DEDUP_EFFORT || 'low',
  },
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
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

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
      signal: AbortSignal.timeout(120_000),
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

  const json = await res.json();
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

function describeOffer(o: OfferForAi) {
  const head = JSON.stringify({ n: o.n, title: o.title, company: o.company, seniority: o.seniority, remote: o.remote });
  return `### OFFER ${o.n}\n${head}\n${o.description ? `AD TEXT:\n${o.description}` : 'AD TEXT: (not available - judge from the title)'}`;
}

export async function assessOffers(criteria: string, file: { name: string; text: string } | null, offers: OfferForAi[]) {
  const { model, effort } = aiConfig().assess;
  // criteria + file first: identical across batches, so OpenAI's prompt cache can reuse them
  const context =
    `CRITERIA:\n${criteria.trim() || '(none - use the file)'}\n` +
    (file ? `\nCANDIDATE FILE "${file.name}":\n${file.text.slice(0, FILE_CHARS)}\n` : '');
  const parsed = await chat<{ results?: Assessment[] }>({
    model, effort,
    system: ASSESS_SYSTEM,
    user: `${context}\nOFFERS:\n\n${offers.map(describeOffer).join('\n\n')}`,
    schemaName: 'assessments',
    schema: ASSESS_SCHEMA,
  });
  const asked = new Set(offers.map((o) => o.n));
  return (parsed.results ?? [])
    .filter((r) => asked.has(r.n))
    .map((r) => ({
      ...r,
      score: Math.max(0, Math.min(100, Math.round(r.score))),
      summary: String(r.summary ?? '').slice(0, 240),
      checks: (r.checks ?? []).slice(0, 12).map((c) => ({ item: String(c.item).slice(0, 80), met: Boolean(c.met) })),
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

const describeJob = (j: JobForAi) =>
  JSON.stringify({
    title: j.title, company: j.company, seniority: j.seniority, remote: j.remote, board: j.board,
    first_seen: j.first_seen.slice(0, 10), ...(j.excerpt ? { ad_start: j.excerpt } : {}),
  });

export async function decideDuplicates(pairs: PairForAi[]) {
  const { model, effort } = aiConfig().dedup;
  const parsed = await chat<{ results?: DupDecision[] }>({
    model, effort,
    system: DEDUP_SYSTEM,
    user: pairs.map((x) => `### PAIR ${x.p}\nA: ${describeJob(x.a)}\nB: ${describeJob(x.b)}`).join('\n\n'),
    schemaName: 'duplicates',
    schema: DEDUP_SCHEMA,
  });
  const asked = new Set(pairs.map((x) => x.p));
  return (parsed.results ?? [])
    .filter((r) => asked.has(r.p))
    .map((r) => ({ p: r.p, same: Boolean(r.same), reason: String(r.reason ?? '').slice(0, 160) }));
}
