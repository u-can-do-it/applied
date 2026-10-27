import { sql } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { BY_HAND, mergeByHand } from '@/lib/ai/merge-duplicates';
import { countPending, latestRun, needsWorker, rangeStats, startRun } from '@/lib/ai/runs';
import * as pairsRepo from '@/lib/db/repos/ai-dup-pairs';
import { archive, restore } from '@/lib/db/repos/archived-jobs';
import * as runsRepo from '@/lib/db/repos/ai-runs';
import * as linksRepo from '@/lib/db/repos/job-links';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as detailsRepo from '@/lib/db/repos/offer-details';
import * as verdictsRepo from '@/lib/db/repos/ai-verdicts';
import * as offersRepo from '@/lib/db/repos/offers';
import * as scrapeRunsRepo from '@/lib/db/repos/scrape-runs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { getJobs } from '@/lib/jobs';
import { activateProfile, fitOf, getProfile, listProfiles, saveProfile } from '@/lib/ai/profiles';
import { SCRAPE_LOCK_SECONDS } from '@/lib/budgets';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { GOOD_FIT } from '@/lib/shared/fit';
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
  return added.map((row) => row.jobKey).sort();
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
  bodyLeasing: !match,
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

  it('saves new criteria keeping the verdicts so far, when asked to', async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React, remote', file: 'keep' });
    const [key] = await threeJobs();
    await verdictsRepo.save([verdict({ id, version: 1 }, key, true)]);

    await saveProfile({ id, name: 'P', prompt: 'React, remote or Warsaw', file: 'keep', recheck: 'none' });
    expect(await getProfile(id)).toMatchObject({ prompt: 'React, remote or Warsaw', version: 1 });
    expect((await verdictsRepo.forJobs({ id, version: 1 }, [key])).size).toBe(1);
  });

  it('saves new criteria re-checking only the jobs first seen in a range (today), the others kept', async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const [first, second, third] = await threeJobs();
    await exec(sql`update public.offers set first_seen = now() - interval '3 days' where id = '1'`);
    await verdictsRepo.save([first, second, third].map((key) => verdict({ id, version: 1 }, key, true)));
    const today = { gte: new Date(Date.now() - 86_400_000).toISOString() };

    await saveProfile({ id, name: 'P', prompt: 'React, junior Node', file: 'keep', recheck: today });
    expect(await getProfile(id)).toMatchObject({ prompt: 'React, junior Node', version: 1 });
    const kept = await verdictsRepo.forJobs({ id, version: 1 }, [first, second, third]);
    const older = (await offersRepo.findOffer({ src: 'justjoin', id: '1', urls: [] }))?.jobKey;
    expect([...kept.keys()]).toEqual([older]);
    expect(await countPending({ id, version: 1 }, today)).toBe(2);

    // nothing changed: nothing re-checked
    await verdictsRepo.save([second, third].map((key) => verdict({ id, version: 1 }, key, true)));
    await saveProfile({ id, name: 'P', prompt: 'React, junior Node', file: 'keep', recheck: today });
    expect((await verdictsRepo.forJobs({ id, version: 1 }, [first, second, third])).size).toBe(3);
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

  it("gives a job's fit as the active profile's current version judged it", async () => {
    const [key, unjudged] = await threeJobs();
    expect(await fitOf(key)).toBeNull(); // no profile yet
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    await verdictsRepo.save([verdict({ id, version: 1 }, key, true)]);
    expect(await fitOf(key)).toEqual({
      match: true,
      score: 90,
      summary: 'fits',
      checks: [{ item: 'React', met: true }],
      hadDescription: false,
      bodyLeasing: false,
    });
    expect(await fitOf(unjudged)).toBeNull();
    await saveProfile({ name: 'Other', prompt: 'Vue', file: 'keep' }); // another profile is the active one now
    expect(await fitOf(key)).toBeNull();
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
    // the day's count is the list's: the one match, not the day's three jobs
    expect(matches.jobs[0]).toMatchObject({
      jobId: first,
      dayCount: 1,
      ai: { match: true, score: 90, summary: 'fits' },
    });
    const rejected = await getJobs({ q: '', src: '', page: 0, ai: { ...ai, rejected: true } });
    expect(rejected.jobs.map((row) => [row.jobId, row.ai?.score])).toEqual([[second, 20]]);
    const [json] = await exec(sql`select distinct jsonb_typeof(checks) as checks from public.ai_verdicts`);
    expect(json).toEqual({ checks: 'array' });
    // another version's verdicts don't count
    expect((await getJobs({ q: '', src: '', page: 0, ai: { profileId: id, version: 2, rejected: false } })).total).toBe(
      0,
    );

    // all offers: every job, the judged ones with their verdict (the fit badge), the others without
    const all = await getJobs({ q: '', src: '', page: 0, verdictsOf: { ...ai, usable: true } });
    expect(all.total).toBe(3);
    expect(all.jobs.map((job) => job.dayCount)).toEqual([3, 3, 3]);
    const verdicts = Object.fromEntries(all.jobs.map((job) => [job.jobId, job.ai && [job.ai.match, job.ai.score]]));
    expect(verdicts).toEqual({ [first]: [true, 90], [second]: [false, 20], [third]: undefined });
    expect(all.jobs.find((job) => job.jobId === third)).not.toHaveProperty('ai');
    expect(all.hiddenCount).toBe(0);
    expect((await getJobs({ q: '', src: '', page: 0 })).jobs.every((job) => !job.ai)).toBe(true);

    // a minimum fit leaves out the rejected ones and those scored under it, never the ones not judged
    const atLeast = (minFit: number) =>
      getJobs({ q: '', src: '', page: 0, verdictsOf: { ...ai, usable: true, minFit } });
    const fitting = await atLeast(90);
    expect(fitting.jobs.map((job) => job.jobId).sort()).toEqual([first, third].sort());
    expect([fitting.total, fitting.hiddenCount]).toEqual([2, 1]);
    expect(fitting.jobs.map((job) => job.dayCount)).toEqual([2, 2]);
    const strict = await atLeast(91);
    expect(strict.jobs.map((job) => job.jobId)).toEqual([third]);
    expect([strict.total, strict.hiddenCount]).toEqual([1, 2]);
    // archived, a hidden one counts in neither
    await archive(second);
    expect((await atLeast(90)).archivedCount).toBe(0);
    expect((await atLeast(0)).archivedCount).toBe(1);
    await restore(second);
  });

  it("counts each day's good and fair fits, the ones your criteria allow, as the list shows them", async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const profile = { id, version: 1 };
    const [first, second, third] = await threeJobs();
    await verdictsRepo.save([
      { ...verdict(profile, first, true), score: GOOD_FIT },
      { ...verdict(profile, second, true), score: GOOD_FIT - 1 },
      { ...verdict(profile, third, false), score: 95 }, // ruled out: neither, whatever its score
    ]);
    const fits = (jobs: { dayGood: number; dayFair: number }[]) => jobs.map((job) => [job.dayGood, job.dayFair]);

    const ai = { profileId: id, version: 1 };
    const all = await getJobs({ q: '', src: '', page: 0, verdictsOf: { ...ai, usable: true } });
    expect(fits(all.jobs)).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    const matches = await getJobs({ q: '', src: '', page: 0, ai: { ...ai, rejected: false } });
    expect(fits(matches.jobs)).toEqual([
      [1, 1],
      [1, 1],
    ]);
    // a tier's own list, as a count's link opens it
    const good = await getJobs({ q: '', src: '', page: 0, ai: { ...ai, rejected: false, tier: 'good' } });
    expect([good.total, good.jobs.map((row) => row.jobId), fits(good.jobs)]).toEqual([1, [first], [[1, 0]]]);
    const fair = await getJobs({ q: '', src: '', page: 0, ai: { ...ai, rejected: false, tier: 'fair' } });
    expect([fair.total, fair.jobs.map((row) => row.jobId), fits(fair.jobs)]).toEqual([1, [second], [[0, 1]]]);
    // the filters count too
    const found = await getJobs({ q: 'Vue', src: '', page: 0, verdictsOf: { ...ai, usable: true } });
    expect(fits(found.jobs)).toEqual([[0, 1]]);
    // no verdicts asked for: none
    expect(fits((await getJobs({ q: '', src: '', page: 0 })).jobs)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('marks the jobs a scrape run is still checking as matching, until judged or the run lets go', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const profile = { id, version: 1 };
    const [before] = await offersRepo.ingest([job('nofluff', '9', 'Go Developer', 'Delta')]);
    await stateRepo.lock(SCRAPE_LOCK_SECONDS);
    await scrapeRunsRepo.start('cron');
    const [first, second, third] = await threeJobs();
    await verdictsRepo.save([verdict(profile, first, true)]);

    const matching = async (usable = true) =>
      (await getJobs({ q: '', src: '', page: 0, verdictsOf: { profileId: id, version: 1, usable } })).jobs
        .filter((row) => row.matching)
        .map((row) => row.jobId)
        .sort();
    // the run's new jobs without a verdict; not the judged one, nor one from before the run (its check is over)
    expect(await matching()).toEqual([second, third]);
    expect(await matching()).not.toContain(before.jobKey);
    // a profile that can't judge, or the AI filter off: nothing is being checked
    expect(await matching(false)).toEqual([]);
    await settingsRepo.save({ ...DEFAULT_SETTINGS, aiFilter: false });
    expect(await matching()).toEqual([]);
    await settingsRepo.save(DEFAULT_SETTINGS);
    // the run's AI check is over: the ones left without a verdict aren't coming
    await stateRepo.unlock();
    expect(await matching()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it('a job whose ads all have no text is never pending; one judged on its title alone waits for its ad', async () => {
    const id = await saveProfile({ name: 'P', prompt: 'React', file: 'keep' });
    const profile = { id, version: 1 };
    const [first, second, third] = await threeJobs();
    const [noAd] = await offersRepo.ingest([job('nofluff', '9', 'Go Developer', 'Delta')]);
    await detailsRepo.save([{ src: 'nofluff', id: '9', status: 'empty', description: null }]);
    expect(await countPending(profile, {})).toBe(3);
    expect((await verdictsRepo.unjudgedJobs(profile, {}, 10)).map((row) => row.jobId)).not.toContain(noAd.jobKey);

    // first: judged from its ad; second: on its title alone (before every judgment needed the ad); third: not yet
    await verdictsRepo.save([
      { ...verdict(profile, first, true), hadDescription: true },
      verdict(profile, second, false),
    ]);
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const waiting = await verdictsRepo.waitingForAd(profile, since, 10);
    expect(waiting.map((row) => row.jobId).sort()).toEqual([second, third]);
    expect(waiting[0].offers).toEqual([expect.objectContaining({ src: 'justjoin' })]);
    expect(await verdictsRepo.waitingForAd(profile, '2999-01-01T00:00:00Z', 10)).toEqual([]);
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
    expect(found.find((row) => row.id === 'o1')).toMatchObject({
      src: 'justjoin',
      id: 'o1',
      status: 'empty',
      description: null,
      details: null,
      complete: false,
    });
    expect(await detailsRepo.forOffers([])).toEqual([]);
  });

  it('pairs look-alike jobs first seen under 30 days apart only: a reworded repost after that is a job of its own', async () => {
    await offersRepo.ingest([
      job('justjoin', '1', 'Senior React Developer', 'EPAM'),
      job('nofluff', '2', 'Senior React.js Developer!', 'EPAM Systems'),
    ]);
    await exec(sql`update public.offers set first_seen = now() - interval '31 days' where src = 'nofluff'`);
    expect(await pairsRepo.candidates({ gte: null, lt: null }, 60)).toEqual([]);
    await exec(sql`update public.offers set first_seen = now() - interval '29 days' where src = 'nofluff'`);
    expect(await pairsRepo.candidates({ gte: null, lt: null }, 60)).toHaveLength(1);
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
      .map((row) => row.jobKey)
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

  it('merges two jobs you say are one: the earlier stays, the pair is decided, the later one is not sent', async () => {
    const offers = [
      job('nofluff', '1', 'Frontend Developer (React / TypeScript / AWS)', '1dea'),
      job('adzuna', '2', 'Frontend Dev, React + TS + AWS', '1dea'),
      job('justjoin', '3', 'Vue Developer', 'Beta'),
    ];
    const added = await offersRepo.ingest(offers); // not in this order
    const [older, newer, other] = offers.map((offer) => ({
      jobKey: added.find((row) => row.src === offer.src)?.jobKey ?? '',
    }));
    await exec(sql`update public.offers set first_seen = now() - interval '1 day' where src = 'nofluff'`);
    await queueRepo.enqueue(
      offers.slice(1).map((offer, i) => ({ ...offer, location: null, jobId: [newer, other][i].jobKey })),
    );

    // picked in either order, the earlier one stays
    expect(await mergeByHand(newer.jobKey, older.jobKey)).toEqual({
      kept: offers[0].title,
      merged: offers[1].title,
    });
    expect(await linksRepo.jobIdOf(newer.jobKey)).toBe(older.jobKey);
    const [pair] = await exec(sql`select key_a, key_b, same, model from public.ai_dup_pairs`);
    expect(pair).toMatchObject({ same: true, model: BY_HAND });
    expect([pair.key_a, pair.key_b].sort()).toEqual([older.jobKey, newer.jobKey].sort());
    expect((await queueRepo.list()).map((row) => row.id)).toEqual(['3']);

    // the list's ids, after the merge: one job already; a job that's gone
    await expect(mergeByHand(older.jobKey, newer.jobKey)).rejects.toThrow('one job already');
    await expect(mergeByHand(other.jobKey, '1dea|nosuchjob')).rejects.toThrow('gone');
  });

  it('leaves an archived job out of the look-alike pairs, until it is restored', async () => {
    const [archived] = await offersRepo.ingest([
      job('justjoin', '1', 'Senior React Developer', 'EPAM'),
      job('nofluff', '2', 'Senior React.js Developer!', 'EPAM Systems'),
    ]);
    await archive(archived.jobKey);
    expect(await pairsRepo.candidates({ gte: null, lt: null }, 60)).toEqual([]);

    await restore(archived.jobKey);
    expect(await pairsRepo.candidates({ gte: null, lt: null }, 60)).toHaveLength(1);
  });
});
