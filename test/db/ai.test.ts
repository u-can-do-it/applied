import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { countPending, latestRun, needsWorker, rangeStats, startRun } from '@/lib/ai/runs';
import * as pairsRepo from '@/lib/db/repos/ai-dup-pairs';
import * as runsRepo from '@/lib/db/repos/ai-runs';
import * as detailsRepo from '@/lib/db/repos/offer-details';
import * as verdictsRepo from '@/lib/db/repos/ai-verdicts';
import * as offersRepo from '@/lib/db/repos/offers';
import { getJobs } from '@/lib/jobs';
import { activateProfile, getProfile, listProfiles, saveProfile } from '@/lib/ai/profiles';
import { describeDb, exec, ISO } from './database';

const job = (src: string, id: string, title: string, company: string) => ({
  src,
  id,
  title,
  company,
  seniority: null,
  remote: false,
  url: `https://${src}.example/${id}`,
});

async function threeJobs() {
  const added = await offersRepo.ingest([
    job('justjoin', '1', 'React Developer', 'Acme'),
    job('justjoin', '2', 'Vue Developer', 'Beta'),
    job('justjoin', '3', 'Angular Developer', 'Gamma'),
  ]);
  return added.map((row) => row.titleKey).sort();
}

const verdict = (profile: { id: string; version: number }, jobId: string, match: boolean) => ({
  profileId: profile.id,
  version: profile.version,
  jobId,
  match,
  score: match ? 90 : 10,
  summary: match ? 'fits' : 'does not',
  checks: [{ item: 'React', met: match }],
  hadDescription: false,
});

describeDb('AI profiles', () => {
  it('versions a profile when its criteria change, and drops the old verdicts', async () => {
    const id = await saveProfile({ name: ' ', prompt: 'React, remote', file: { name: 'cv.md', text: 'my cv' } });
    let profile = await getProfile(id);
    expect(profile).toMatchObject({ name: 'Profile', version: 1, fileName: 'cv.md', fileText: 'my cv' });
    const [key] = await threeJobs();
    await verdictsRepo.save([verdict({ id, version: 1 }, key, true)]);

    await saveProfile({ id, name: 'Renamed', prompt: 'React, remote', file: 'keep' }); // a new name only
    profile = await getProfile(id);
    expect(profile).toMatchObject({ name: 'Renamed', version: 1, fileText: 'my cv' });
    expect((await verdictsRepo.forJobs({ id, version: 1 }, [key])).size).toBe(1);

    await saveProfile({ id, name: 'Renamed', prompt: 'React, remote', file: 'remove' }); // the file goes: new criteria
    profile = await getProfile(id);
    expect(profile).toMatchObject({ version: 2, fileName: null, fileText: null });
    expect((await verdictsRepo.forJobs({ id, version: 1 }, [key])).size).toBe(0);
  });

  it('lists the most recently used first, without the file text', async () => {
    const older = await saveProfile({ name: 'Older', prompt: 'a', file: 'keep' });
    await saveProfile({ name: 'Newer', prompt: 'b', file: 'keep' });
    expect((await listProfiles()).map((profile) => profile.name)).toEqual(['Newer', 'Older']);
    await activateProfile(older);
    const listed = await listProfiles();
    expect(listed.map((profile) => profile.name)).toEqual(['Older', 'Newer']);
    expect('fileText' in listed[0]).toBe(false);
    expect(listed[0].lastUsedAt).toMatch(ISO);
  });
});

describeDb('AI verdicts and runs', () => {
  it('lists the matches or the rejected ones, and counts what is left to judge', async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const profile = { id, version: 1 };
    const [first, second, third] = await threeJobs();
    expect(await countPending(profile, {})).toBe(3);

    await verdictsRepo.save([verdict(profile, first, true), verdict(profile, second, false)]);
    await verdictsRepo.save([{ ...verdict(profile, second, false), score: 20 }]); // judged again: the new one counts
    expect(await countPending(profile, {})).toBe(1);
    expect((await verdictsRepo.unjudgedJobs(profile, {}, 10)).map((row) => row.jobId)).toEqual([third]);
    expect(await rangeStats(profile, {})).toEqual({ total: 3, checked: 2, matched: 1 });
    expect(await rangeStats(profile, { gte: '2999-01-01T00:00:00Z' })).toEqual({ total: 0, checked: 0, matched: 0 });

    const ai = { profileId: id, version: 1 };
    const matches = await getJobs({ q: '', src: '', page: 0, ai: { ...ai, rejected: false } });
    expect(matches.total).toBe(1);
    expect(matches.jobs[0]).toMatchObject({ jobId: first, ai: { match: true, score: 90, summary: 'fits' } });
    const rejected = await getJobs({ q: '', src: '', page: 0, ai: { ...ai, rejected: true } });
    expect(rejected.jobs.map((row) => [row.jobId, row.ai?.score])).toEqual([[second, 20]]);
    const [json] = await exec(sql`select distinct jsonb_typeof(checks) as checks from public.ai_verdicts`);
    expect(json).toEqual({ checks: 'array' });
    // another version's verdicts don't count
    expect((await getJobs({ q: '', src: '', page: 0, ai: { profileId: id, version: 2, rejected: false } })).total).toBe(
      0,
    );
  });

  it('starts one run per profile version, and gives its lock to one worker at a time', async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const profile = await getProfile(id);
    if (!profile) throw new Error('no profile');
    await threeJobs();

    const run = await startRun(profile, { label: 'all offers' });
    expect(run).toMatchObject({ status: 'running', phase: 'dedup', total: 3, done: 0, lockUntil: null });
    expect(run.createdAt).toMatch(ISO);
    expect((await startRun(profile, { label: 'again' })).id).toBe(run.id); // the open one
    expect((await latestRun(id))?.id).toBe(run.id);
    expect(needsWorker(run)).toBe(true);
    // Activity's list: every profile's runs, with the profile's name and the version it is at now
    expect(await runsRepo.recent()).toEqual([
      expect.objectContaining({ id: run.id, profileName: 'P', profileVersion: 1 }),
    ]);

    const until = new Date(Date.now() + 60_000).toISOString();
    const now = new Date().toISOString();
    const workers = await Promise.all([runsRepo.takeLock(run.id, until, now), runsRepo.takeLock(run.id, until, now)]);
    expect(workers.filter(Boolean)).toHaveLength(1);
    expect(needsWorker(workers.find(Boolean) ?? null)).toBe(false);
    // the lock ran out (as the worker sees the time)
    expect(await runsRepo.takeLock(run.id, until, new Date(Date.now() + 120_000).toISOString())).not.toBeNull();

    await runsRepo.patch(run.id, { status: 'done', lockUntil: null });
    expect(await runsRepo.takeLock(run.id, until, now)).toBeNull(); // not running any more
  });

  it('starts nothing when there is nothing to judge', async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const profile = await getProfile(id);
    if (!profile) throw new Error('no profile');
    const run = await startRun(profile, { label: 'today', gte: '2999-01-01T00:00:00.000Z' });
    expect(run).toMatchObject({ status: 'done', phase: 'assess', total: 0, rangeGte: '2999-01-01T00:00:00+00:00' });
    expect(run.finishedAt).toMatch(ISO);
  });

  it('keeps the ad text per offer, and finds it for many offers at once', async () => {
    const offers = Array.from({ length: 700 }, (_, index) => ({
      src: 'justjoin',
      id: `o${index}`,
      title: `Job ${index}`,
      company: 'X',
    }));
    await offersRepo.ingest(offers.map((offer) => job(offer.src, offer.id, offer.title, offer.company)));
    await detailsRepo.save(
      offers.map((offer) => ({ src: offer.src, id: offer.id, status: 'ok', description: `ad ${offer.id}` })),
    );
    await detailsRepo.save([{ src: 'justjoin', id: 'o1', status: 'empty', description: null }]); // scraped again
    const found = await detailsRepo.forOffers([...offers, { src: 'nofluff', id: 'o1', title: '', company: '' }]);
    expect(found).toHaveLength(700);
    expect(found.find((row) => row.id === 'o1')).toEqual({
      src: 'justjoin',
      id: 'o1',
      status: 'empty',
      description: null,
    });
    expect(await detailsRepo.forOffers([])).toEqual([]);
  });

  it('proposes look-alike jobs once, until the pair is decided', async () => {
    const added = await offersRepo.ingest([
      job('justjoin', '1', 'Senior React Developer', 'EPAM'),
      job('nofluff', '2', 'Senior React.js Developer!', 'EPAM Systems'),
      job('bulldog', '3', 'Accountant', 'EPAM'),
    ]);
    await exec(sql`update public.offers set first_seen = now() - interval '1 day' where src = 'nofluff'`);
    const pairs = await pairsRepo.candidates({ gte: null, lt: null }, 60);
    expect(pairs).toHaveLength(1);
    const [pair] = pairs;
    const keys = added
      .filter((row) => row.src !== 'bulldog')
      .map((row) => row.titleKey)
      .sort();
    expect([pair.jobIdA, pair.jobIdB].sort()).toEqual(keys); // jobIdA < jobIdB in the database's collation, not JS's
    expect(pair.similarity).toBeGreaterThan(0.45);
    expect(pair.a.firstSeen).toMatch(ISO);

    await pairsRepo.record([
      { jobIdA: pair.jobIdA, jobIdB: pair.jobIdB, same: true, reason: 'same ad', model: 'test' },
    ]);
    await pairsRepo.record([
      { jobIdA: pair.jobIdA, jobIdB: pair.jobIdB, same: false, reason: 'changed', model: 'test' },
    ]);
    expect(await pairsRepo.candidates({ gte: null, lt: null }, 60)).toEqual([]);
    const [decided] = await exec(sql`select same, reason from public.ai_dup_pairs`);
    expect(decided).toEqual({ same: false, reason: 'changed' });
  });
});
