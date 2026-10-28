import { readFileSync } from 'node:fs';
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
  setRentADev,
  setStatus,
  setTalentPool,
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
  return added.jobKey;
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

  it("counts your applications at each listed job's company, its legal form and case aside", async () => {
    const jobId = await scrapedJob();
    await offersRepo.ingest([
      {
        src: 'justjoin',
        id: 'j2',
        title: 'Vue Developer',
        company: 'ACME Sp. z o.o.',
        seniority: null,
        remote: true,
        url: 'https://justjoin.it/job-offer/j2',
      },
      {
        src: 'justjoin',
        id: 'j3',
        title: 'Go Developer',
        company: 'Beta',
        seniority: null,
        remote: true,
        url: 'https://justjoin.it/job-offer/j3',
      },
    ]);
    await markApplied(jobId, { src: 'justjoin', id: 'j1' });
    await addApplication(typed('Angular Developer', { company: 'Acme' }), utc);
    const atCompany = async () =>
      Object.fromEntries(
        (await getJobs({ q: '', src: '', page: 0 })).jobs.map((job) => [
          job.title,
          [job.companyApplied, job.companyLastApplied !== null],
        ]),
      );
    expect(await atCompany()).toEqual({
      'React Developer': [2, true],
      'Vue Developer': [2, true],
      'Go Developer': [0, false],
    });
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
    expect((await listApplications())[0].fit).toBeNull(); // no profile
    await saveProfile({ name: 'P', prompt: 'Design roles', file: 'keep' });
    expect((await listApplications())[0].fit).toBeNull(); // not judged yet
    assess.mockResolvedValueOnce([
      { n: 1, match: true, score: 77, summary: 'fits', checks: [{ item: 'Figma', met: true }], bodyLeasing: true },
    ]);
    expect((await listApplications())[0].bodyLeasing).toBeNull(); // no call on it yet
    const fit = await assessFit(jobId);
    expect(fit).toEqual({
      match: true,
      score: 77,
      summary: 'fits',
      checks: [{ item: 'Figma', met: true }],
      hadDescription: true,
      bodyLeasing: true,
    });
    expect((await listApplications())[0].bodyLeasing).toBe(true); // the application's own call follows the check
    await setRentADev(jobId, false); // yours, by hand: until the next check
    expect((await listApplications())[0]).toMatchObject({ bodyLeasing: false, fit: { bodyLeasing: true } });
    expect(assess).toHaveBeenLastCalledWith('Design roles', null, [
      { n: 1, title: 'Designer', company: 'Hand Made', seniority: null, remote: true, description: ad.trim() },
    ]);
    expect(await fitOf(jobId)).toEqual(fit); // kept: the window and the AI tab have it from now on
    expect((await listApplications())[0].fit).toEqual(fit); // the list's badge
    assess.mockResolvedValueOnce([]);
    await expect(assessFit(jobId)).rejects.toThrow('The AI gave no answer: try again.');
  });

  it('appends status changes to the history, after the stages they pass, and takes them back', async () => {
    const { jobId = '' } = await addApplication(typed('Tester'), utc);
    await setStatus(jobId, 'technical', 'pending');
    await setStatus(jobId, 'technical', 'passed');
    let app = await getApplication(jobId);
    expect(app).toMatchObject({ stage: 'technical', outcome: 'passed' });
    expect(app?.history.map((step) => `${step.stage}/${step.state}${step.auto ? ' (auto)' : ''}`)).toEqual([
      'submitted/pending',
      'submitted/passed (auto)',
      'invited/passed (auto)',
      'technical/pending',
      'technical/passed',
    ]);
    expect(app?.history[1].at).toBe(app?.history[3].at); // the same statement
    expect(app?.history[4].at).toMatch(ISO);
    expect(app?.stageUpdatedAt).toMatch(ISO);

    // the step clicked a moment ago carries the browser's time: found by stage and state; the passed ones stay
    expect(await removeStatusStep(jobId, { stage: 'technical', state: 'pending', at: 'not the same' })).toEqual({});
    app = await getApplication(jobId);
    expect(app).toMatchObject({ stage: 'invited', outcome: 'passed' });
    expect(app?.history).toHaveLength(3);
    expect(
      (await removeStatusStep(jobId, app?.history[0] ?? { stage: 'submitted', state: 'pending', at: '' })).error,
    ).toMatch(/first step/);
  });

  it('passes the stages before one set by hand when adding it', async () => {
    const { jobId = '' } = await addApplication(typed('Late', { stage: 'invited', outcome: 'failed' }), utc);
    const app = await getApplication(jobId);
    expect(app?.history.map((step) => `${step.stage}/${step.state}`)).toEqual([
      'submitted/pending',
      'submitted/passed',
      'invited/failed',
    ]);
    expect(Date.parse(app?.stageUpdatedAt ?? '')).toBe(Date.parse(app?.history[2].at ?? ''));
  });

  it('0028_passed_before gives the applications saved before the passed stages, once', async () => {
    const old = async (title: string, history: object[]) => {
      const { jobId = '' } = await addApplication(typed(title), utc);
      const last = history.at(-1) as { stage: string; state: string };
      await exec(
        sql`update public.applications set history = ${JSON.stringify(history)}::jsonb, stage = ${last.stage},
              stage_state = ${last.state} where dup_key = ${jobId}`,
      );
      return jobId;
    };
    const at = (day: number) => `2026-10-${day}T10:00:00.000Z`;
    const rejected = await old('Rejected', [
      { stage: 'submitted', state: 'pending', at: at(1) },
      { stage: 'screening', state: 'pending', at: at(5) },
      { stage: 'hr', state: 'ghosted', at: at(8), auto: true },
      { stage: 'technical', state: 'failed', at: at(9) },
    ]);
    const waiting = await old('Waiting', [{ stage: 'submitted', state: 'ghosted', at: at(1) }]);
    const migrate = sql.raw(readFileSync('drizzle/0028_passed_before.sql', 'utf8'));
    await exec(migrate);
    await exec(migrate);

    const app = await getApplication(rejected);
    expect(app).toMatchObject({ stage: 'technical', outcome: 'failed' });
    expect(app?.history.map((step) => `${step.stage}/${step.state}`)).toEqual([
      'submitted/pending',
      'screening/pending',
      'hr/ghosted',
      'submitted/passed',
      'invited/passed',
      'screening/passed',
      'hr/passed',
      'technical/failed',
    ]);
    expect(app?.history.slice(3, 7).every((step) => step.auto && step.at === at(9))).toBe(true);
    expect((await getApplication(waiting))?.history).toHaveLength(1);
  });

  it('0031: the talent pool outcome becomes the mark, In progress at the same stage', async () => {
    // as before it: "pool" a status
    await exec(sql`alter table public.applications drop constraint applications_stage_state_check`);
    const old = async (title: string, history: object[], stageUpdatedAt: string) => {
      const { jobId = '' } = await addApplication(typed(title), utc);
      const last = history.at(-1) as { stage: string; state: string };
      await exec(
        sql`update public.applications set history = ${JSON.stringify(history)}::jsonb, stage = ${last.stage},
              stage_state = ${last.state}, stage_updated_at = ${stageUpdatedAt} where dup_key = ${jobId}`,
      );
      return jobId;
    };
    const at = (day: number) => `2026-09-0${day}T10:00:00.000Z`;
    const pool = await old(
      'Pool',
      [
        { stage: 'submitted', state: 'pending', at: at(1) },
        { stage: 'screening', state: 'pool', at: at(2) },
      ],
      at(2),
    );
    const movedOn = await old(
      'Moved on',
      [
        { stage: 'submitted', state: 'pool', at: at(1) },
        { stage: 'technical', state: 'failed', at: at(3) },
      ],
      at(3),
    );
    const migrate = sql.raw(readFileSync('drizzle/0031_talent_pool_mark.sql', 'utf8'));
    await exec(migrate);
    await exec(migrate);

    const app = await getApplication(pool);
    expect(app).toMatchObject({ stage: 'screening', outcome: 'pending', talentPool: true });
    expect(app?.history.map((step) => `${step.stage}/${step.state}`)).toEqual([
      'submitted/pending',
      'screening/pending',
    ]);
    // the code before it would ghost it after a month: its year counts from now
    expect(Date.now() - Date.parse(app?.stageUpdatedAt ?? '')).toBeLessThan(60_000);
    const other = await getApplication(movedOn);
    expect(other).toMatchObject({ stage: 'technical', outcome: 'failed', talentPool: false });
    expect(Date.parse(other?.stageUpdatedAt ?? '')).toBe(Date.parse(at(3)));
    expect(other?.history[0].state).toBe('pending');
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

  it('ghosts one in the talent pool after a year, not a month', async () => {
    const month = (await addApplication(typed('A month in the pool'), utc)).jobId ?? '';
    const year = (await addApplication(typed('A year in the pool'), utc)).jobId ?? '';
    await setTalentPool(month, true);
    await setTalentPool(year, true);
    await exec(
      sql`update public.applications set stage_updated_at = now() - interval '31 days' where dup_key = ${month}`,
    );
    await exec(
      sql`update public.applications set stage_updated_at = now() - interval '366 days' where dup_key = ${year}`,
    );

    expect(await ghostStale()).toBe(1);
    expect(await getApplication(year)).toMatchObject({ outcome: 'ghosted', talentPool: true });
    expect(await getApplication(month)).toMatchObject({ outcome: 'pending', talentPool: true });
    // out of the pool: a month again
    await setTalentPool(month, false);
    expect(await ghostStale()).toBe(1);
    expect((await getApplication(month))?.outcome).toBe('ghosted');
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
      skills: [{ name: 'React', level: 4, note: '' }],
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
      skills: [{ name: 'React', level: 4 }],
      typed: ['salary'],
    });
    expect(read?.details?.textRead).toBeTruthy();
    expect(await readDetailsFromText()).toBe(0); // read already
    expect(extract).toHaveBeenCalledTimes(1);

    // a text read before there were skills is read once more, for them
    const { skills: _, ...before } = read?.details ?? {};
    await exec(
      sql`update public.applications set details = ${JSON.stringify(before)}::jsonb where dup_key = ${one.jobId}`,
    );
    expect(await readDetailsFromText()).toBe(1);
    expect((await getApplication(one.jobId ?? ''))?.details).toMatchObject({
      salary: '20k',
      location: 'Warszawa',
      skills: [{ name: 'React', level: 4 }],
    });
  });
});
