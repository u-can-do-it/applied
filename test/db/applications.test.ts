import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  addApplication,
  getApplication,
  ghostStale,
  listApplications,
  markApplied,
  removeStatusStep,
  setNote,
  setStatus,
  unmarkApplied,
  updateApplication,
} from '@/lib/applications';
import { zone } from '@/lib/dates';
import * as offersRepo from '@/lib/db/repos/offers';
import { getOffers } from '@/lib/offers';
import { NOTE_CONFLICT } from '@/lib/shared/schemas/applications';
import { describeDb, exec, ISO } from './database';

const utc = zone('UTC');

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
  return added.dupKey;
}

const typed = (title: string, extra: Partial<Parameters<typeof addApplication>[0]> = {}) => ({
  url: '',
  title,
  company: 'Hand Made',
  src: 'unknown',
  appliedAt: '2026-09-30T12:00:00.000Z',
  stage: 'submitted' as const,
  state: 'pending' as const,
  details: null,
  content: null,
  note: null,
  ...extra,
});

describeDb('applications', () => {
  it('marks a scraped job applied with the clicked copy, once', async () => {
    const key = await scrapedJob();
    await markApplied(key, { src: 'nofluff', id: 'n1' });
    await markApplied(key, { src: 'justjoin', id: 'j1' }); // already applied: stays as it was
    const app = await getApplication(key);
    expect(app).toMatchObject({
      src: 'nofluff',
      id: 'n1',
      title: 'React Developer',
      stage: 'submitted',
      stageState: 'pending',
    });
    expect(app?.appliedAt).toMatch(ISO);
    expect(app?.history).toHaveLength(1);
    // the offers list knows it's applied
    const { offers } = await getOffers({ q: '', src: '', page: 0 });
    expect(offers[0].appliedAt).toBe(app?.appliedAt);
    expect((await listApplications()).map((row) => row.dupKey)).toEqual([key]);
    expect('content' in (await listApplications())[0]).toBe(false);
  });

  it('adds one by hand, and refuses the same job twice', async () => {
    const added = await addApplication(typed('Designer', { note: 'met at a meetup' }), utc);
    expect(added.key).toBeTruthy();
    const again = await addApplication(typed('Designer'), utc);
    expect(again.error).toMatch(/^Already in your applications: “Designer”, applied 30\.09\.2026\./);
    const app = await getApplication(added.key ?? '');
    expect(app).toMatchObject({
      contentStatus: 'empty',
      note: 'met at a meetup',
      appliedAt: '2026-09-30T12:00:00+00:00',
    });
    expect(app?.noteUpdatedAt).toMatch(ISO);
  });

  it('appends status changes to the history and takes them back', async () => {
    const { key = '' } = await addApplication(typed('Tester'), utc);
    await setStatus(key, 'technical', 'pending');
    await setStatus(key, 'technical', 'passed');
    let app = await getApplication(key);
    expect(app).toMatchObject({ stage: 'technical', stageState: 'passed' });
    expect(app?.history.map((step) => `${step.stage}/${step.state}`)).toEqual([
      'submitted/pending',
      'technical/pending',
      'technical/passed',
    ]);
    expect(app?.history[2].at).toMatch(ISO);
    expect(app?.stageUpdatedAt).toMatch(ISO);

    // the step clicked a moment ago carries the browser's time: found by stage and state
    expect(await removeStatusStep(key, { stage: 'technical', state: 'pending', at: 'not the same' })).toEqual({});
    app = await getApplication(key);
    expect(app).toMatchObject({ stage: 'submitted', stageState: 'pending' });
    expect(app?.history).toHaveLength(1);
    expect(
      (await removeStatusStep(key, app?.history[0] ?? { stage: 'submitted', state: 'pending', at: '' })).error,
    ).toMatch(/first step/);
  });

  it('ghosts what waited a month for an answer, and nothing else', async () => {
    const waiting = (await addApplication(typed('Waiting'), utc)).key ?? '';
    const recent = (await addApplication(typed('Recent'), utc)).key ?? '';
    const offer = (await addApplication(typed('Offer', { stage: 'offer', state: 'pending' }), utc)).key ?? '';
    const rejected = (await addApplication(typed('Rejected', { stage: 'hr', state: 'failed' }), utc)).key ?? '';
    const old = sql`now() - interval '31 days'`;
    await exec(
      sql`update public.applications set stage_updated_at = ${old} where dup_key in (${waiting}, ${offer}, ${rejected})`,
    );
    await exec(sql`update public.applications set stage_updated_at = now() where dup_key = ${recent}`);

    expect(await ghostStale()).toBe(1);
    expect(await ghostStale()).toBe(0);
    const app = await getApplication(waiting);
    expect(app).toMatchObject({ stage: 'submitted', stageState: 'ghosted' });
    expect(app?.history.at(-1)).toMatchObject({ stage: 'submitted', state: 'ghosted', auto: true });
    expect((await getApplication(offer))?.stageState).toBe('pending');
    expect((await getApplication(rejected))?.stageState).toBe('failed');
  });

  it('saves a note only over the version it was written on', async () => {
    const { key = '' } = await addApplication(typed('Notes'), utc);
    const first = await setNote(key, 'first', null);
    expect(first.noteUpdatedAt).toMatch(ISO);
    // another tab, still with the note as it was before "first"
    await expect(setNote(key, 'from the other tab', null)).rejects.toThrow(NOTE_CONFLICT);
    expect((await getApplication(key))?.note).toBe('first');
    // this tab goes on with the time it got back, to the microsecond
    const second = await setNote(key, 'second', first.noteUpdatedAt);
    expect(second.noteUpdatedAt > first.noteUpdatedAt).toBe(true);
    await expect(setNote(key, 'stale', first.noteUpdatedAt)).rejects.toThrow(NOTE_CONFLICT);
    // '' clears it
    await setNote(key, '   ', second.noteUpdatedAt);
    expect((await getApplication(key))?.note).toBeNull();

    await unmarkApplied(key);
    await expect(setNote(key, 'gone', null)).rejects.toThrow('This application no longer exists.');
  });

  it('lets one of several first saves win', async () => {
    const { key = '' } = await addApplication(typed('Race'), utc);
    const saves = await Promise.allSettled(['a', 'b', 'c'].map((note) => setNote(key, note, null)));
    expect(saves.filter((save) => save.status === 'fulfilled')).toHaveLength(1);
    expect(saves.filter((save) => save.status === 'rejected').map((save) => String(save.reason))).toEqual([
      `Error: ${NOTE_CONFLICT}`,
      `Error: ${NOTE_CONFLICT}`,
    ]);
  });

  it('keeps jsonb as JSON, not as a string of it', async () => {
    const { key = '' } = await addApplication(typed('Json', { details: { salary: '1 PLN' } }), utc);
    await setStatus(key, 'hr', 'pending');
    const [types] = await exec(
      sql`select jsonb_typeof(history) as history, jsonb_typeof(details) as details from public.applications where dup_key = ${key}`,
    );
    expect(types).toEqual({ history: 'array', details: 'object' });
  });

  it('moves an edited application to the job its new link belongs to', async () => {
    const key = await scrapedJob();
    const { key: own = '' } = await addApplication(typed('Something'), utc);
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
    expect(edited.app).toMatchObject({ dupKey: key, src: 'justjoin', id: 'j1', contentStatus: 'pending' });
    expect(await getApplication(own)).toBeNull();

    // another day moves the applied date and the first step with it
    const moved = await updateApplication(
      key,
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
});
