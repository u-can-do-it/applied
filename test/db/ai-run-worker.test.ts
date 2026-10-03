import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronCall } from '@/app/api/cron/scrape/route';
import { continueRun, latestRun, startRun } from '@/lib/ai/runs';
import { PROFILE_CHANGED } from '@/lib/ai/run-state';
import { AI_RUN_LOCK_MS, SLICE_MS } from '@/lib/budgets';
import * as offersRepo from '@/lib/db/repos/offers';
import * as verdictsRepo from '@/lib/db/repos/ai-verdicts';
import { getProfile, saveProfile } from '@/lib/ai/profiles';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { describeDb, exec, ISO } from './database';

// after(): kept here and run by the test, as the platform would once the answer is sent
const afterAnswer: (() => unknown)[] = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterAnswer.push(task);
  },
}));
const runAfterAnswer = async () => {
  for (const task of afterAnswer.splice(0)) await task();
};

// One slice of an AI run (continueRun) against the database, with `fetch` stubbed: OpenAI is
// answered here, every other request (the ads' pages) fails as if the network were down.

const OPENAI = 'https://openai.test/v1';

type ChatBody = { response_format: { json_schema: { name: string } }; messages: { content: string }[] };

/** Called while OpenAI "thinks" (e.g. to move the clock past the slice's deadline). */
let duringCall: () => void = () => {};
/** Called for every other request (an ad's page), before it fails. */
let onOtherRequest: () => void = () => {};
/** The run's lock as it stood when OpenAI was asked. */
const locksWhenAsked: (number | null)[] = [];
const asked: string[] = [];

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== `${OPENAI}/chat/completions`) {
    onOtherRequest();
    throw new Error(`no network in tests: ${url}`);
  }
  const [row] = await exec(
    sql`select (extract(epoch from lock_until) * 1000)::float8 as lock from public.ai_runs where status = 'running'`,
  );
  locksWhenAsked.push((row as { lock: number | null } | undefined)?.lock ?? null);
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
  return Response.json({ choices: [{ message: { content: JSON.stringify({ results }) } }] });
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
  return { profile, run, jobIds: added.map((row) => row.titleKey) };
}

describeDb('an AI run slice (continueRun)', () => {
  beforeEach(() => {
    asked.length = 0;
    duringCall = () => {};
    onOtherRequest = () => {};
    locksWhenAsked.length = 0;
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
    const { profile, run, jobIds } = await profileAndRun([
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
    expect((await verdictsRepo.forJobs(profile, jobIds)).size).toBe(3);

    await continueRun(run.id); // finished: nobody gets its lock
    expect(asked).toEqual(['assessments']);
    expect((await latestRun(profile.id))?.finishedAt).toBe(after?.finishedAt);
  });

  it('renews its lock right before asking OpenAI, however long the ads took', async () => {
    const { profile, run } = await profileAndRun([job('justjoin', '1', 'React Developer', 'Acme')]);
    await exec(sql`update public.ai_runs set phase = 'assess' where id = ${run.id}`);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    onOtherRequest = () => vi.setSystemTime(Date.now() + 50_000); // each ad request: slow, then failing
    await continueRun(run.id);
    expect(locksWhenAsked).toHaveLength(1);
    const lock = locksWhenAsked[0] ?? 0;
    // taken at the start (start + AI_RUN_LOCK_MS), then renewed after the ads' 100 s or more
    expect(lock).toBeGreaterThanOrEqual(start + 100_000 + AI_RUN_LOCK_MS);
    expect(await latestRun(profile.id)).toMatchObject({ status: 'done', lockUntil: null });
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

describeDb('Supabase Cron continues a paused AI run (no tab open)', () => {
  beforeEach(async () => {
    asked.length = 0;
    duringCall = () => {};
    onOtherRequest = () => {};
    locksWhenAsked.length = 0;
    afterAnswer.length = 0;
    fakeFetch.mockClear();
    vi.stubGlobal('fetch', fakeFetch);
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_BASE_URL', OPENAI);
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    // scraping paused: the call has no scrape to do, only the AI run
    await settingsRepo.save({ ...DEFAULT_SETTINGS, enabled: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const knock = () =>
    cronCall(
      new NextRequest('http://localhost:3000/api/cron/scrape', {
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    );

  it('after its answer, the call runs the paused run to the end', async () => {
    const { profile, run, jobIds } = await profileAndRun([
      job('justjoin', '1', 'React Developer', 'Acme'),
      job('justjoin', '2', 'Vue Developer', 'Beta'),
    ]);
    expect(run).toMatchObject({ status: 'running', lockUntil: null }); // nothing works on it: paused

    const response = await knock();
    expect(await response.json()).toEqual({ jobwatch: 'skipped', reason: 'scraping is paused in Settings' });
    expect(asked).toEqual([]); // not before the answer

    await runAfterAnswer();
    expect(await latestRun(profile.id)).toMatchObject({ status: 'done', total: 2, done: 2, lockUntil: null });
    expect(asked).toEqual(['assessments']);
    expect((await verdictsRepo.forJobs(profile, jobIds)).size).toBe(2);
  });

  it('leaves a run alone while another worker (the AI tab) holds its lock', async () => {
    const { profile, run } = await profileAndRun([job('justjoin', '1', 'React Developer', 'Acme')]);
    await exec(sql`update public.ai_runs set lock_until = now() + interval '2 minutes' where id = ${run.id}`);

    await knock();
    await runAfterAnswer();
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(await latestRun(profile.id)).toMatchObject({ status: 'running', done: 0 });
  });

  it('refuses a call without the secret, and continues nothing', async () => {
    await profileAndRun([job('justjoin', '1', 'React Developer', 'Acme')]);
    const response = await cronCall(new NextRequest('http://localhost:3000/api/cron/scrape'));
    expect(response.status).toBe(401);
    expect(afterAnswer).toEqual([]);
  });
});
