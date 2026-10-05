import { sql } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import { assessOffers, extractJob } from '@/lib/ai/openai';
import { fitOf, saveProfile } from '@/lib/ai/profiles';
import {
  addApplication,
  assessFit,
  getApplication,
  ghostStale,
  listApplications,
  markApplied,
  readDetailsFromText,
  removeStatusStep,
  saveContent,
  setNote,
  setStatus,
  unmarkApplied,
  updateApplication,
} from '@/lib/applications';
import { zoneOf } from '@/lib/dates';
import * as offersRepo from '@/lib/db/repos/offers';
import { getJobs } from '@/lib/jobs';
import { NO_LINK, NO_TEXT } from '@/lib/ad-content-state';
import { NOTE_CONFLICT } from '@/lib/shared/schemas/applications';
import { describeDb, exec, ISO } from './database';

const utc = zoneOf('UTC');

// the details read from an ad text, and the fit: never the real AI
vi.mock('@/lib/ai/openai', () => ({ extractJob: vi.fn(), assessOffers: vi.fn() }));
const extract = vi.mocked(extractJob);
const assess = vi.mocked(assessOffers);
afterEach(() => vi.unstubAllEnvs());

async function scrapedJob() {
  const [added] = await offersRepo.ingest([
    {
      src: 'justjoin',
      id: 'j1',
      title: 'React Developer',
      company: 'Acme',
      seniority: null,
      remote: true,
      url: 'https://justjoin.it/job-offer/j1',
    },
  ]);
  await offersRepo.ingest([
    {
      src: 'nofluff',
      id: 'n1',
      title: 'React Developer',
      company: 'Acme',
      seniority: null,
      remote: true,
      url: 'https://nofluffjobs.com/pl/job/n1',
    },
  ]);
  return added.titleKey;
}

const typed = (title: string, extra: Partial<Parameters<typeof addApplication>[0]> = {}) => ({
  url: '',
  title,
  company: 'Hand Made',
  src: 'unknown',
  appliedAt: '2026-09-30T12:00:00.000Z',
  stage: 'submitted' as const,
  outcome: 'pending' as const,
  details: null,
  content: null,
  note: null,
  ...extra,
});

describeDb('applications', () => {
  it('marks a scraped job applied with the clicked offer, once', async () => {
    const jobId = await scrapedJob();
    await markApplied(jobId, { src: 'nofluff', id: 'n1' });
    await markApplied(jobId, { src: 'justjoin', id: 'j1' }); // already applied: stays as it was
    const app = await getApplication(jobId);
    expect(app).toMatchObject({
      src: 'nofluff',
      id: 'n1',
      title: 'React Developer',
      stage: 'submitted',
      outcome: 'pending',
    });
    expect(app?.appliedAt).toMatch(ISO);
    expect(app?.history).toHaveLength(1);
    // the offers list knows it's applied
    const { jobs } = await getJobs({ q: '', src: '', page: 0 });
    expect(jobs[0].appliedAt).toBe(app?.appliedAt);
    expect((await listApplications()).map((row) => row.jobId)).toEqual([jobId]);
    expect('content' in (await listApplications())[0]).toBe(false);
  });

  it('adds one by hand, and refuses the same job twice', async () => {
    const added = await addApplication(typed('Designer', { note: 'met at a meetup' }), utc);
    expect(added.jobId).toBeTruthy();
    const again = await addApplication(typed('Designer'), utc);
    expect(again.error).toMatch(/^Already in your applications: “Designer”, applied 30\.09\.2026\./);
    const app = await getApplication(added.jobId ?? '');
    expect(app).toMatchObject({
      contentStatus: 'empty',
      note: 'met at a meetup',
      appliedAt: '2026-09-30T12:00:00+00:00',
    });
    expect(app?.noteUpdatedAt).toMatch(ISO);
  });

  it('saves the ad text as its state machine says, and asks for a fetch when one is due', async () => {
    const ad = 'The whole ad, as copied from the board. '.repeat(3);
    const full = await addApplication(typed('Full', { url: 'https://example.test/job/1', content: ad }), utc);
    expect(full.fetch).toBe(false);
    expect(await getApplication(full.jobId ?? '')).toMatchObject({ contentStatus: 'ok', content: ad.trim() });

    // a few words and a link: the ad is fetched too (it used to stay "pending" with nothing fetching it)
    const short = await addApplication(
      typed('Short', { url: 'https://example.test/job/2', content: 'Salary 20k' }),
      utc,
    );
    expect(short.fetch).toBe(true);
    expect(await getApplication(short.jobId ?? '')).toMatchObject({ contentStatus: 'pending', content: 'Salary 20k' });

    const bare = await addApplication(typed('Bare'), utc);
    expect(bare.fetch).toBe(false);
    let app = await getApplication(bare.jobId ?? '');
    expect(app).toMatchObject({ contentStatus: 'empty', content: null, contentError: NO_TEXT, scrapedAt: null });
    // "Fetch again" without a link: nothing to fetch from
    await saveContent(bare.jobId ?? '');
    app = await getApplication(bare.jobId ?? '');
    expect(app).toMatchObject({ contentStatus: 'failed', content: null, contentError: NO_LINK });
    expect(app?.scrapedAt).toMatch(ISO);
  });

  it('asks the AI how well an application fits the active profile, and keeps the verdict', async () => {
    const ad = 'Product designer, Figma, design systems, remote across Europe. '.repeat(2);
    const added = await addApplication(typed('Designer', { content: ad, details: { workMode: 'remote' } }), utc);
    const jobId = added.jobId ?? '';
    await expect(assessFit(jobId)).rejects.toThrow(/^No AI profile/);
    await saveProfile({ name: 'P', prompt: 'Design roles', file: 'keep' });
    assess.mockResolvedValueOnce([
      { n: 1, match: true, score: 77, summary: 'fits', checks: [{ item: 'Figma', met: true }] },
    ]);
    const fit = await assessFit(jobId);
    expect(fit).toEqual({
      match: true,
      score: 77,
      summary: 'fits',
      checks: [{ item: 'Figma', met: true }],
      hadDescription: true,
    });
    expect(assess).toHaveBeenLastCalledWith('Design roles', null, [
      { n: 1, title: 'Designer', company: 'Hand Made', seniority: null, remote: true, description: ad.trim() },
    ]);
    expect(await fitOf(jobId)).toEqual(fit); // kept: the window and the AI tab have it from now on
    assess.mockResolvedValueOnce([]);
    await expect(assessFit(jobId)).rejects.toThrow('The AI gave no answer: try again.');
  });

  it('appends status changes to the history and takes them back', async () => {
    const { jobId = '' } = await addApplication(typed('Tester'), utc);
    await setStatus(jobId, 'technical', 'pending');
    await setStatus(jobId, 'technical', 'passed');
    let app = await getApplication(jobId);
    expect(app).toMatchObject({ stage: 'technical', outcome: 'passed' });
    expect(app?.history.map((step) => `${step.stage}/${step.state}`)).toEqual([
      'submitted/pending',
      'technical/pending',
      'technical/passed',
    ]);
    expect(app?.history[2].at).toMatch(ISO);
    expect(app?.stageUpdatedAt).toMatch(ISO);

    // the step clicked a moment ago carries the browser's time: found by stage and state
    expect(await removeStatusStep(jobId, { stage: 'technical', state: 'pending', at: 'not the same' })).toEqual({});
    app = await getApplication(jobId);
    expect(app).toMatchObject({ stage: 'submitted', outcome: 'pending' });
    expect(app?.history).toHaveLength(1);
    expect(
      (await removeStatusStep(jobId, app?.history[0] ?? { stage: 'submitted', state: 'pending', at: '' })).error,
    ).toMatch(/first step/);
  });

  it('ghosts what waited a month for an answer, and nothing else', async () => {
    const waiting = (await addApplication(typed('Waiting'), utc)).jobId ?? '';
    const recent = (await addApplication(typed('Recent'), utc)).jobId ?? '';
    const offer = (await addApplication(typed('Offer', { stage: 'offer', outcome: 'pending' }), utc)).jobId ?? '';
    const rejected = (await addApplication(typed('Rejected', { stage: 'hr', outcome: 'failed' }), utc)).jobId ?? '';
    const old = sql`now() - interval '31 days'`;
    await exec(
      sql`update public.applications set stage_updated_at = ${old} where dup_key in (${waiting}, ${offer}, ${rejected})`,
    );
    await exec(sql`update public.applications set stage_updated_at = now() where dup_key = ${recent}`);

    expect(await ghostStale()).toBe(1);
    expect(await ghostStale()).toBe(0);
    const app = await getApplication(waiting);
    expect(app).toMatchObject({ stage: 'submitted', outcome: 'ghosted' });
    expect(app?.history.at(-1)).toMatchObject({ stage: 'submitted', state: 'ghosted', auto: true });
    expect((await getApplication(offer))?.outcome).toBe('pending');
    expect((await getApplication(rejected))?.outcome).toBe('failed');
  });

  it('saves a note only over the version it was written on', async () => {
    const { jobId = '' } = await addApplication(typed('Notes'), utc);
    const first = await setNote(jobId, 'first', null);
    expect(first.noteUpdatedAt).toMatch(ISO);
    // another tab, still with the note as it was before "first"
    await expect(setNote(jobId, 'from the other tab', null)).rejects.toThrow(NOTE_CONFLICT);
    expect((await getApplication(jobId))?.note).toBe('first');
    // this tab goes on with the time it got back, to the microsecond
    const second = await setNote(jobId, 'second', first.noteUpdatedAt);
    expect(second.noteUpdatedAt > first.noteUpdatedAt).toBe(true);
    await expect(setNote(jobId, 'stale', first.noteUpdatedAt)).rejects.toThrow(NOTE_CONFLICT);
    // '' clears it
    await setNote(jobId, '   ', second.noteUpdatedAt);
    expect((await getApplication(jobId))?.note).toBeNull();

    await unmarkApplied(jobId);
    await expect(setNote(jobId, 'gone', null)).rejects.toThrow('This application no longer exists.');
  });

  it('lets one of several first saves win', async () => {
    const { jobId = '' } = await addApplication(typed('Race'), utc);
    const saves = await Promise.allSettled(['a', 'b', 'c'].map((note) => setNote(jobId, note, null)));
    expect(saves.filter((save) => save.status === 'fulfilled')).toHaveLength(1);
    expect(saves.filter((save) => save.status === 'rejected').map((save) => String(save.reason))).toEqual([
      `Error: ${NOTE_CONFLICT}`,
      `Error: ${NOTE_CONFLICT}`,
    ]);
  });

  it('keeps jsonb as JSON, not as a string of it', async () => {
    const { jobId = '' } = await addApplication(typed('Json', { details: { salary: '1 PLN' } }), utc);
    await setStatus(jobId, 'hr', 'pending');
    const [types] = await exec(
      sql`select jsonb_typeof(history) as history, jsonb_typeof(details) as details from public.applications where dup_key = ${jobId}`,
    );
    expect(types).toEqual({ history: 'array', details: 'object' });
  });

  it('moves an edited application to the job its new link belongs to', async () => {
    const jobId = await scrapedJob();
    const { jobId: own = '' } = await addApplication(typed('Something'), utc);
    const edited = await updateApplication(
      own,
      {
        url: 'https://justjoin.it/job-offer/j1',
        title: 'React Developer',
        company: 'Acme',
        src: 'justjoin',
        day: '2026-09-30',
        details: { salary: '1 PLN' },
        content: '',
      },
      utc,
    );
    expect(edited.error).toBeUndefined();
    expect(edited.fetch).toBe(true); // no ad text: fetched from the link afterwards
    expect(edited.app).toMatchObject({ jobId, src: 'justjoin', id: 'j1', contentStatus: 'pending' });
    expect(await getApplication(own)).toBeNull();

    // another day moves the applied date and the first step with it
    const moved = await updateApplication(
      jobId,
      {
        url: edited.app?.url ?? '',
        title: 'React Developer',
        company: 'Acme',
        src: 'justjoin',
        day: '2026-09-28',
        details: null,
        content: '',
      },
      utc,
    );
    expect(moved.app?.appliedAt).toBe('2026-09-28T12:00:00+00:00');
    expect(moved.app?.history[0].at).toBe('2026-09-28T12:00:00.000Z');
  });

  it('reads the details of the saved ad texts not read yet, once, without overwriting a newer save', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    extract.mockResolvedValue({
      title: 'x',
      company: 'x',
      location: 'Warszawa',
      workMode: 'hybrid',
      officeDays: '2 office / 3 home',
      salary: '',
      contract: 'Permanent (UoP)',
      seniority: '',
    });
    const ad = 'A complete ad text: what you would do, what they ask for, the hybrid work in Warszawa.';
    const one = await addApplication(typed('One', { content: ad, details: { salary: '20k' } }), utc);
    await addApplication(typed('No text'), utc);
    expect(await readDetailsFromText()).toBe(1);
    const read = await getApplication(one.jobId ?? '');
    expect(read?.details).toMatchObject({
      salary: '20k',
      contract: 'Permanent (UoP)',
      location: 'Warszawa',
      workMode: 'hybrid',
      officeDays: '2 office / 3 home',
      typed: ['salary'],
    });
    expect(read?.details?.textRead).toBeTruthy();
    expect(await readDetailsFromText()).toBe(0); // read already
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
