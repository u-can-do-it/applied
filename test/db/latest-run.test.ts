import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import * as offersRepo from '@/lib/db/repos/offers';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import { getJobs } from '@/lib/jobs';
import { saveProfile } from '@/lib/ai/profiles';
import { describeDb, exec } from './database';

// "New": the jobs first seen in the latest finished scrape run that brought new jobs
// (lib/db/repos/scrape-runs.ts latestWithNewJobs, lib/jobs.ts getJobs), as the lists mark them and
// ?new=1 shows them.

const offer = (id: string, title: string, src = 'justjoin', company = 'Acme') => ({
  src,
  id,
  title,
  company,
  seniority: null,
  remote: false,
  url: `https://${src}.example/${id}`,
});

/** a run from `start` to `end` (null: didn't finish) that says it added `added` offers */
async function run(start: string, end: string | null, added: number) {
  await exec(sql`insert into public.scrape_runs (trigger, started_at, finished_at, added)
    values ('cron', ${start}::timestamptz, ${end}::timestamptz, ${added})`);
}
const seenAt = (id: string, at: string) =>
  exec(sql`update public.offers set first_seen = ${at}::timestamptz where id = ${id}`);

const list = (extra: { latest?: boolean; q?: string } = {}) =>
  getJobs({ q: extra.q ?? '', src: '', page: 0, ...extra });

describeDb('new in the latest run', () => {
  it('is the newest finished run with a job first seen in it, to the microsecond', async () => {
    expect(await runsRepo.latestWithNewJobs()).toBeNull();
    await offersRepo.ingest([offer('a', 'React Developer'), offer('b', 'Vue Developer'), offer('c', 'Go Developer')]);
    await seenAt('a', '2026-10-01T10:00:00.000001Z');
    await seenAt('b', '2026-10-01T12:00:10Z');
    await seenAt('c', '2026-10-01T13:00:00Z');
    await run('2026-10-01T10:00:00.000001Z', '2026-10-01T10:00:30Z', 1);
    await run('2026-10-01T11:00:00Z', '2026-10-01T11:00:20Z', 0); // brought nothing
    await run('2026-10-01T12:00:00Z', null, 1); // didn't finish (still going, or died): b isn't "new" yet
    expect(await runsRepo.latestWithNewJobs()).toEqual({
      startedAt: '2026-10-01T10:00:00.000001+00:00',
      finishedAt: '2026-10-01T10:00:30+00:00',
    });
    // c was saved outside any run: it doesn't make one
    await run('2026-10-01T13:00:01Z', '2026-10-01T13:00:30Z', 0);
    expect((await runsRepo.latestWithNewJobs())?.startedAt).toBe('2026-10-01T10:00:00.000001+00:00');
  });

  it('a run that only added another board’s offer of a known job brought no new job: it isn’t the one', async () => {
    await offersRepo.ingest([offer('jj-1', 'React Developer'), offer('old', 'Java Developer')]);
    await seenAt('old', '2026-10-01T09:00:00Z');
    await seenAt('jj-1', '2026-10-01T10:00:10Z');
    await run('2026-10-01T10:00:00Z', '2026-10-01T10:00:30Z', 1);
    // the same job cross-posted on another board, saved by the next run
    await offersRepo.ingest([offer('nf-1', 'React Developer', 'nofluff')]);
    await exec(sql`update public.offers set first_seen = '2026-10-01T11:00:10Z' where id = 'nf-1'`);
    await run('2026-10-01T11:00:00Z', '2026-10-01T11:00:30Z', 1);

    expect(await runsRepo.latestWithNewJobs()).toEqual({
      startedAt: '2026-10-01T10:00:00+00:00',
      finishedAt: '2026-10-01T10:00:30+00:00',
    });
    const all = await list();
    expect(all.jobs.map((job) => [job.id, job.isNew])).toEqual([
      ['jj-1', true],
      ['old', false],
    ]);
    expect(all.newCount).toBe(1);
    expect((await list({ latest: true })).jobs.map((job) => job.id)).toEqual(['jj-1']);
  });

  it('marks the jobs first seen in it, counts them, and lists only them with ?new=1', async () => {
    await offersRepo.ingest([
      offer('old', 'Older Developer'),
      offer('edge', 'Edge Developer'),
      offer('a', 'React Developer'),
      offer('b', 'Vue Developer'),
      offer('after', 'Later Developer'),
    ]);
    await seenAt('old', '2026-10-01T09:00:00Z');
    await seenAt('edge', '2026-10-01T10:00:00Z'); // a microsecond before the run started
    await seenAt('a', '2026-10-01T10:00:00.000001Z'); // as it started
    await seenAt('b', '2026-10-01T10:00:30Z'); // as it finished
    await seenAt('after', '2026-10-01T10:05:00Z'); // saved later, outside any run
    await run('2026-10-01T08:00:00Z', '2026-10-01T09:30:00Z', 1);
    await run('2026-10-01T10:00:00.000001Z', '2026-10-01T10:00:30Z', 2);

    const all = await list();
    expect(all.total).toBe(5);
    expect(all.newCount).toBe(2);
    expect(all.latest).toEqual({
      startedAt: '2026-10-01T10:00:00.000001+00:00',
      finishedAt: '2026-10-01T10:00:30+00:00',
    });
    expect(Object.fromEntries(all.jobs.map((job) => [job.id, job.isNew]))).toEqual({
      after: false,
      b: true,
      a: true,
      edge: false,
      old: false,
    });

    const latest = await list({ latest: true });
    expect(latest.jobs.map((job) => job.id)).toEqual(['b', 'a']);
    expect(latest).toMatchObject({ total: 2, newCount: 2 });
    // with the other filters too
    expect((await list({ latest: true, q: 'vue' })).jobs.map((job) => job.id)).toEqual(['b']);
    expect(await list({ latest: true, q: 'older' })).toMatchObject({ total: 0, newCount: 0, jobs: [] });

    // the AI tab: the same marks on the judged jobs
    const profileId = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    await exec(sql`insert into public.ai_verdicts (profile_id, version, dup_key, match, score)
      select ${profileId}::uuid, 1, dup_key, true, 80 from public.offers where id in ('a', 'old')`);
    const judged = await getJobs({ q: '', src: '', page: 0, ai: { profileId, version: 1, rejected: false } });
    expect(judged.jobs.map((job) => [job.id, job.isNew])).toEqual([
      ['a', true],
      ['old', false],
    ]);
    expect(judged.newCount).toBe(1);
  });

  it('no run brought a job: nothing is new, and ?new=1 lists nothing', async () => {
    await offersRepo.ingest([offer('a', 'React Developer')]);
    await seenAt('a', '2026-10-01T09:00:00Z');
    await run('2026-10-01T10:00:00Z', '2026-10-01T10:00:30Z', 0);
    const all = await list();
    expect(all).toMatchObject({ total: 1, newCount: 0, latest: null });
    expect(all.jobs[0].isNew).toBe(false);
    expect(await list({ latest: true })).toEqual({
      byMatch: false,
      jobs: [],
      total: 0,
      newCount: 0,
      archivedCount: 0,
      latest: null,
    });
  });
});
