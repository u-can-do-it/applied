import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { continueRun, latestRun, startRun } from '@/lib/ai-runs';
import { PROFILE_CHANGED } from '@/lib/ai-run-state';
import { SLICE_MS } from '@/lib/budgets';
import * as offersRepo from '@/lib/db/repos/offers';
import * as verdictsRepo from '@/lib/db/repos/ai-verdicts';
import { getProfile, saveProfile } from '@/lib/profiles';
import { describeDb, exec, ISO } from './database';

// One slice of an AI run (continueRun) against the database, with `fetch` stubbed: OpenAI is
// answered here, every other request (the ads' pages) fails as if the network were down.

const OPENAI = 'https://openai.test/v1';

type ChatBody = { response_format: { json_schema: { name: string } }; messages: { content: string }[] };

/** Called while OpenAI "thinks" (e.g. to move the clock past the slice's deadline). */
let duringCall: () => void = () => {};
const asked: string[] = [];

const fakeFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== `${OPENAI}/chat/completions`) return Promise.reject(new Error(`no network in tests: ${url}`));
  const body = JSON.parse(init?.body as string) as ChatBody;
  const kind = body.response_format.json_schema.name;
  asked.push(kind);
  duringCall();
  const user = body.messages[1].content;
  const numbers = (label: string) =>
    [...user.matchAll(new RegExp(`### ${label} (\\d+)`, 'g'))].map((match) => Number(match[1]));
  const results =
    kind === 'assessments'
      ? numbers('OFFER').map((offer) => ({ n: offer, match: offer === 1, score: 70, summary: 'ok', checks: [] }))
      : numbers('PAIR').map((pair) => ({ p: pair, same: false, reason: 'different roles' }));
  return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify({ results }) } }] }));
});

const job = (src: string, id: string, title: string, company: string) => ({
  src,
  id,
  title,
  company,
  seniority: null,
  remote: false,
  url: `https://${src}.example/${id}`,
});

async function profileAndRun(jobs: ReturnType<typeof job>[]) {
  const added = await offersRepo.ingest(jobs);
  const id = await saveProfile({ name: 'P', prompt: 'React, remote', file: 'keep' });
  const profile = await getProfile(id);
  if (!profile) throw new Error('no profile');
  const run = await startRun(profile, { label: 'all offers' });
  return { profile, run, keys: added.map((row) => row.dupKey) };
}

describeDb('an AI run slice (continueRun)', () => {
  beforeEach(() => {
    asked.length = 0;
    duringCall = () => {};
    fakeFetch.mockClear();
    vi.stubGlobal('fetch', fakeFetch);
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_BASE_URL', OPENAI);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('checks for duplicates, recounts, assesses every job and finishes', async () => {
    const { profile, run, keys } = await profileAndRun([
      job('justjoin', '1', 'React Developer', 'Acme'),
      job('justjoin', '2', 'Vue Developer', 'Beta'),
      job('justjoin', '3', 'Angular Developer', 'Gamma'),
    ]);
    expect(run).toMatchObject({ status: 'running', phase: 'dedup', total: 3 });

    await continueRun(run.id);
    const after = await latestRun(profile.id);
    expect(after).toMatchObject({ status: 'done', phase: 'assess', total: 3, done: 3, error: null, lockUntil: null });
    expect(after?.finishedAt).toMatch(ISO);
    expect(asked).toEqual(['assessments']); // no look-alike pairs: no duplicate check
    expect((await verdictsRepo.forJobs(profile, keys)).size).toBe(3);

    await continueRun(run.id); // finished: nobody gets its lock
    expect(asked).toEqual(['assessments']);
    expect((await latestRun(profile.id))?.finishedAt).toBe(after?.finishedAt);
  });

  it('cancels a run whose profile changed since it started', async () => {
    const { profile, run } = await profileAndRun([job('justjoin', '1', 'React Developer', 'Acme')]);
    await saveProfile({ id: profile.id, name: 'P', prompt: 'Vue, remote', file: 'keep' }); // new criteria: version 2

    await continueRun(run.id);
    const after = await latestRun(profile.id);
    expect(after).toMatchObject({ status: 'cancelled', error: PROFILE_CHANGED, lockUntil: null });
    expect(after?.finishedAt).toMatch(ISO);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('pauses at the deadline, with the lock freed and the progress kept', async () => {
    const { profile, run } = await profileAndRun([
      job('justjoin', '1', 'Senior React Developer', 'EPAM'),
      job('nofluff', '2', 'Senior React.js Developer!', 'EPAM Systems'),
    ]);
    await exec(sql`update public.offers set first_seen = now() - interval '1 day' where src = 'nofluff'`);
    vi.useFakeTimers({ toFake: ['Date'] });
    // the duplicate check takes longer than the whole slice
    duringCall = () => vi.setSystemTime(Date.now() + SLICE_MS + 1);

    await continueRun(run.id);
    const after = await latestRun(profile.id);
    expect(asked).toEqual(['duplicates']);
    expect(after).toMatchObject({ status: 'running', phase: 'dedup', pairsChecked: 1, merged: 0, lockUntil: null });
    expect(after?.finishedAt).toBeNull();
  });

  it('a crash pauses the run with the error, and frees the lock for the next slice', async () => {
    const { profile, run } = await profileAndRun([job('justjoin', '1', 'React Developer', 'Acme')]);
    await exec(sql`alter function public.ai_dup_candidates rename to ai_dup_candidates_away`);
    try {
      await continueRun(run.id);
    } finally {
      await exec(sql`alter function public.ai_dup_candidates_away rename to ai_dup_candidates`);
    }
    const after = await latestRun(profile.id);
    expect(after).toMatchObject({ status: 'running', phase: 'dedup', lockUntil: null });
    expect(after?.error).toMatch(/ai_dup_candidates/);
    expect(after?.finishedAt).toBeNull();
  });
});
