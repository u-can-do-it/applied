import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import * as linksRepo from '@/lib/db/repos/job-links';
import * as jobNotesRepo from '@/lib/db/repos/job-notes';
import * as offersRepo from '@/lib/db/repos/offers';
import { archive, restore } from '@/lib/db/repos/archived-jobs';
import { markSeen } from '@/lib/db/repos/seen-jobs';
import { getJobs, getTotalCount, PAGE_SIZE } from '@/lib/jobs';
import { describeDb, exec, ISO } from './database';

const offer = (src: string, id: string, title: string, company: string | null, remote = false) => ({
  src,
  id,
  title,
  company,
  seniority: null,
  remote,
  url: `https://${src}.example/${id}`,
});

/** first_seen as given, so the order is known */
const seenAt = (src: string, id: string, at: string) =>
  exec(sql`update public.offers set first_seen = ${at}::timestamptz where src = ${src} and id = ${id}`);

const page = (
  query = '',
  src = '',
  extra: { days?: string; from?: string; to?: string; page?: number; archived?: boolean; byDate?: boolean } = {},
) =>
  getJobs({
    q: query,
    src,
    page: extra.page ?? 0,
    days: extra.days,
    from: extra.from,
    to: extra.to,
    archived: extra.archived,
    byDate: extra.byDate,
  });

describeDb('offers', () => {
  it('saves new offers once, and says which jobs were known before', async () => {
    const first = await offersRepo.ingest([
      offer('justjoin', '1', 'React Developer (k/m)', 'Acme Sp. z o.o.'),
      offer('justjoin', '1', 'React Developer (k/m)', 'Acme Sp. z o.o.'), // twice in one run
      offer('nofluff', 'a', 'Java Developer', 'Other'),
    ]);
    expect(first.map((row) => [row.src, row.id, row.seenBefore]).sort()).toEqual([
      ['justjoin', '1', false],
      ['nofluff', 'a', false],
    ]);
    // the same job on another board: new row, known job; an offer saved before: not returned
    const second = await offersRepo.ingest([
      offer('nofluff', 'b', 'React Developer', 'ACME'),
      offer('justjoin', '1', 'React Developer (k/m)', 'Acme Sp. z o.o.'),
    ]);
    const acme = first.find((row) => row.src === 'justjoin')?.jobKey;
    expect(second).toEqual([{ src: 'nofluff', id: 'b', jobKey: acme, seenBefore: true }]);
    expect(await offersRepo.knownIds('justjoin', ['1', '2'])).toEqual(new Set(['1']));
  });

  it('makes a repost a job of its own when its job was first seen 30+ days before', async () => {
    const daysAgo = (days: number, id: string) =>
      exec(sql`update public.offers set first_seen = now() - make_interval(days => ${days}) where id = ${id}`);
    const [original] = await offersRepo.ingest([offer('justjoin', '1', 'React Developer', 'Acme')]);
    expect(original.jobKey).toBe('acme|reactdeveloper');
    await daysAgo(29, '1');
    // under 30 days: the same job
    expect(await offersRepo.ingest([offer('nofluff', '2', 'React Developer', 'Acme')])).toEqual([
      { src: 'nofluff', id: '2', jobKey: original.jobKey, seenBefore: true },
    ]);
    await daysAgo(31, '1');
    await archive(original.jobKey);
    await markSeen(original.jobKey);

    // 30+ days since the job began, though its latest offer is younger: a new job, both boards' offers in it
    const repost = `${original.jobKey}~${new Date().toISOString().slice(0, 10)}`;
    const reposted = await offersRepo.ingest([
      offer('bulldog', '3', 'React Developer (k/m)', 'Acme Sp. z o.o.'),
      offer('theprotocol', '4', 'React Developer', 'Acme'),
    ]);
    expect(reposted.sort((a, b) => a.src.localeCompare(b.src))).toEqual([
      { src: 'bulldog', id: '3', jobKey: repost, seenBefore: false },
      { src: 'theprotocol', id: '4', jobKey: repost, seenBefore: false },
    ]);
    // none of the old job's marks; the old one stays archived
    const { jobs } = await page();
    expect(jobs.map((job) => [job.jobId, job.archived, job.seen, job.offers.length])).toEqual([
      [repost, false, false, 2],
    ]);
    expect((await page('', '', { archived: true })).jobs.map((job) => job.jobId)).toEqual([original.jobKey]);
    // the next offer joins the repost, the title key's latest job
    expect(await offersRepo.ingest([offer('pracuj', '5', 'React Developer', 'Acme')])).toEqual([
      { src: 'pracuj', id: '5', jobKey: repost, seenBefore: true },
    ]);
    expect(await offersRepo.jobKeyOf('ACME', 'React Developer')).toBe(repost);
    expect(await offersRepo.jobKeyOf('Acme', 'Vue Developer')).toBe('acme|vuedeveloper');
  });

  it("counts a merged job's earliest offer: a repost of a younger title key merged into an old job", async () => {
    const [old, merged] = await offersRepo.ingest([
      offer('justjoin', '1', 'Frontend Engineer', 'Acme'),
      offer('nofluff', '2', 'Front-end Engineer (React)', 'Acme'),
    ]);
    await exec(sql`update public.offers set first_seen = now() - interval '40 days' where id = '1'`);
    await exec(sql`update public.offers set first_seen = now() - interval '10 days' where id = '2'`);
    await linksRepo.mergeJobs(old.jobKey, merged.jobKey);
    const [again] = await offersRepo.ingest([offer('bulldog', '3', 'Front-end Engineer (React)', 'Acme')]);
    expect(again.jobKey).toBe(`${merged.jobKey}~${new Date().toISOString().slice(0, 10)}`);
    expect(again.seenBefore).toBe(false);
  });

  it('lists each job once, newest first, with every board it is on', async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'React Developer', 'Acme'),
      offer('nofluff', 'b', 'React Developer', 'Acme'),
      offer('bulldog', 'x', 'Go Developer', 'Gopher'),
    ]);
    await seenAt('justjoin', '1', '2026-10-01T08:00:00Z');
    await seenAt('nofluff', 'b', '2026-10-02T08:00:00Z');
    await seenAt('bulldog', 'x', '2026-10-01T09:00:00.123456Z');

    const { jobs, total } = await page();
    expect(total).toBe(2);
    expect(await getTotalCount()).toBe(2);
    expect(jobs.map((job) => [job.src, job.id])).toEqual([
      ['bulldog', 'x'],
      ['justjoin', '1'], // the earliest offer stands for the job
    ]);
    expect(jobs[1].offers.map((link) => link.src)).toEqual(['justjoin', 'nofluff']);
    expect(jobs[0].firstSeen).toBe('2026-10-01T09:00:00.123456+00:00');
    expect(jobs[0].appliedAt).toBeNull();
  });

  it('takes a job’s details from a board of its own over an aggregator, from the cutoff on', async () => {
    await offersRepo.ingest([
      offer('eldorado', '1', 'Fullstack Engineer', 'Asana'),
      offer('justjoin', 'asana', 'Fullstack Engineer', 'Asana'),
      offer('eldorado', '2', 'Go Developer', 'Gopher'),
      offer('nofluff', 'go', 'Go Developer', 'Gopher'),
    ]);
    await seenAt('eldorado', '1', '2026-10-09T08:00:00Z');
    await seenAt('justjoin', 'asana', '2026-10-09T09:00:00Z');
    // first seen before the migration: shown as it was
    await seenAt('eldorado', '2', '2026-10-01T08:00:00Z');
    await seenAt('nofluff', 'go', '2026-10-09T08:00:00Z');

    const { jobs } = await page();
    expect(jobs.map((job) => [job.src, job.id, job.url, job.firstSeen])).toEqual([
      ['justjoin', 'asana', 'https://justjoin.example/asana', '2026-10-09T08:00:00+00:00'], // dated by Eldorado's
      ['eldorado', '2', 'https://eldorado.example/2', '2026-10-01T08:00:00+00:00'],
    ]);
    expect(jobs.map((job) => job.offers.map((link) => link.src))).toEqual([
      ['justjoin', 'eldorado'],
      ['eldorado', 'nofluff'],
    ]);
  });

  it('filters by words (title or company), board and days', async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'Senior Frontend Developer (React)', 'Acme'),
      offer('nofluff', '2', 'Backend Developer', 'React Labs'),
      offer('bulldog', '3', 'Senior Java Developer', 'Beans'),
    ]);
    await seenAt('justjoin', '1', '2026-09-20T10:00:00Z');
    await seenAt('nofluff', '2', '2026-09-25T10:00:00Z');
    await seenAt('bulldog', '3', '2026-09-28T10:00:00Z');

    expect((await page('senior react')).jobs.map((job) => job.id)).toEqual(['1']);
    expect((await page('REACT')).jobs.map((job) => job.id).sort()).toEqual(['1', '2']);
    expect((await page('react', 'nofluff')).jobs.map((job) => job.id)).toEqual(['2']);
    expect((await page('"senior java"')).jobs.map((job) => job.id)).toEqual(['3']);
    expect((await page('', '', { from: '2026-09-24', to: '2026-09-25' })).jobs.map((job) => job.id)).toEqual(['2']);
    expect((await page('', '', { from: '2026-09-26' })).jobs.map((job) => job.id)).toEqual(['3']);
    expect((await page('react', '', { from: '2026-09-24' })).jobs.map((job) => job.id)).toEqual(['2']);
  });

  it('forgives a typo, ranks the best match first, and says where it matched', async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'Java Developer', 'Acme'),
      offer('justjoin', '2', 'Developer Advocate', 'Devtools'),
      offer('justjoin', '3', 'Python Engineer', 'Łódź Soft'),
      offer('justjoin', '4', 'C# .NET Developer', 'Micro'),
    ]);
    await seenAt('justjoin', '1', '2026-09-28T10:00:00Z');
    await seenAt('justjoin', '2', '2026-09-20T10:00:00Z');

    const typo = await page('devloper');
    expect(typo.byMatch).toBe(true);
    expect(typo.jobs.map((job) => job.id).sort()).toEqual(['1', '2', '4']);
    expect((await page('pyhton lodz')).jobs.map((job) => [job.id, job.marks])).toEqual([
      ['3', { title: [0, 6], company: [0, 4] }],
    ]);
    // a whole word at the start of the title before one inside a word, though older
    expect((await page('dev')).jobs.map((job) => job.id)).toEqual(['2', '1', '4']);
    // C#, .NET: as they are, not "c" anywhere
    expect((await page('c#')).jobs.map((job) => job.id)).toEqual(['4']);
    expect((await page('.net')).jobs.map((job) => job.id)).toEqual(['4']);
    // no search: newest first, by day
    expect((await page('')).byMatch).toBe(false);
    // nothing to look for: not filtered
    expect((await page('%%')).jobs).toHaveLength(4);
  });

  it("lists a search's jobs newest first when asked (a company's link), the same ones", async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'Java Developer', 'Acme'),
      offer('justjoin', '2', 'Developer Advocate', 'Devtools'),
      offer('justjoin', '3', 'Python Engineer', 'Soft'),
    ]);
    await seenAt('justjoin', '1', '2026-09-28T10:00:00Z');
    await seenAt('justjoin', '2', '2026-09-20T10:00:00Z');

    expect((await page('dev')).jobs.map((job) => job.id)).toEqual(['2', '1']);
    const newest = await page('dev', '', { byDate: true });
    expect([newest.byMatch, newest.total, newest.jobs.map((job) => job.id)]).toEqual([false, 2, ['1', '2']]);
  });

  it('pages through in a stable order, with the total of all pages', async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, index) =>
      offer('justjoin', `o${index}`, `Job ${index}`, `Company ${index}`),
    );
    await offersRepo.ingest(many);
    await exec(sql`update public.offers set first_seen = '2026-10-01T00:00:00Z'`); // all at once: src, id decide
    const one = await page('', '', { page: 0 });
    const two = await page('', '', { page: 1 });
    expect(one.total).toBe(PAGE_SIZE + 5);
    expect(two.total).toBe(PAGE_SIZE + 5);
    expect(one.jobs).toHaveLength(PAGE_SIZE);
    expect(two.jobs).toHaveLength(5);
    const ids = [...one.jobs, ...two.jobs].map((job) => job.id);
    expect(new Set(ids).size).toBe(PAGE_SIZE + 5);
    expect(ids).toEqual([...ids].sort());
  });

  it("counts each day's jobs on every page, the days in the app's time zone", async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, index) =>
      offer('justjoin', `o${index}`, `Job ${index}`, `Company ${index}`),
    );
    await offersRepo.ingest([
      ...many,
      offer('nofluff', 'late', 'Late Job', 'Owl'),
      offer('nofluff', 'early', 'Job', 'Lark'),
    ]);
    await exec(sql`update public.offers set first_seen = '2026-10-05T10:00:00Z' where src = 'justjoin'`);
    await seenAt('nofluff', 'late', '2026-10-04T22:30:00Z'); // already the 5th in Warsaw (no setting: the default)
    await seenAt('nofluff', 'early', '2026-10-04T21:30:00Z'); // still the 4th there

    const one = await page('', '', { page: 0 });
    const two = await page('', '', { page: 1 });
    expect(one.jobs.every((job) => job.dayCount === PAGE_SIZE + 6)).toBe(true);
    // the 5th goes on over the next page, with the same count
    expect(two.jobs.map((job) => [job.id, job.dayCount])).toEqual([
      ...two.jobs.slice(0, 5).map((job) => [job.id, PAGE_SIZE + 6]),
      ['late', PAGE_SIZE + 6],
      ['early', 1],
    ]);
    // the filters count too
    expect((await page('Owl')).jobs.map((job) => job.dayCount)).toEqual([1]);
  });

  it('shows merged jobs as one, and counts them once', async () => {
    const added = await offersRepo.ingest([
      offer('justjoin', '1', 'Frontend Engineer', 'Acme'),
      offer('nofluff', '2', 'Front-end Engineer (React)', 'Acme'),
    ]);
    expect(await getTotalCount()).toBe(2);
    await linksRepo.mergeJobs(added[0].jobKey, added[1].jobKey);
    expect(await linksRepo.jobIdOf(added[1].jobKey)).toBe(added[0].jobKey);
    const { jobs, total } = await page();
    expect(total).toBe(1);
    expect(await getTotalCount()).toBe(1);
    expect(jobs[0].jobId).toBe(added[0].jobKey);
    expect(jobs[0].offers).toHaveLength(2);
  });

  it('keeps a merged job archived and seen when only the merged-away one was', async () => {
    const [kept, alias] = await offersRepo.ingest([
      offer('justjoin', '1', 'Frontend Engineer', 'Acme'),
      offer('nofluff', '2', 'Front-end Engineer (React)', 'Acme'),
    ]);
    await archive(alias.jobKey);
    await markSeen(alias.jobKey);
    await linksRepo.mergeJobs(kept.jobKey, alias.jobKey);

    expect((await page()).total).toBe(0);
    const { jobs } = await page('', '', { archived: true });
    expect(jobs.map((job) => [job.jobId, job.archived, job.seen])).toEqual([[kept.jobKey, true, true]]);
    // nothing left under the merged-away id
    expect(
      await exec(sql`select dup_key from public.seen_jobs union all select dup_key from public.archived_jobs`),
    ).toEqual([{ dup_key: kept.jobKey }, { dup_key: kept.jobKey }]);
  });

  it("moves the merged-away job's note to the kept one: added to its own, or alone", async () => {
    const [kept, alias, other] = await offersRepo.ingest([
      offer('justjoin', '1', 'Frontend Engineer', 'Acme'),
      offer('nofluff', '2', 'Front-end Engineer (React)', 'Acme'),
      offer('bulldog', '3', 'Frontend Developer', 'Acme'),
    ]);
    await jobNotesRepo.setIfUnchanged(kept.jobKey, 'Recruiter: Ola', null);
    await jobNotesRepo.setIfUnchanged(alias.jobKey, 'Asked 20k', null);
    await linksRepo.mergeJobs(kept.jobKey, alias.jobKey);
    expect((await jobNotesRepo.get(kept.jobKey))?.note).toBe('Recruiter: Ola\n\nAsked 20k');
    expect(await jobNotesRepo.get(alias.jobKey)).toBeNull();

    // the kept job had none
    await jobNotesRepo.setIfUnchanged(other.jobKey, 'Remote only', null);
    await jobNotesRepo.take(kept.jobKey);
    await linksRepo.mergeJobs(kept.jobKey, other.jobKey);
    expect((await jobNotesRepo.get(kept.jobKey))?.note).toBe('Remote only');
  });

  it('finds an offer by the board id or by its link, and gives the title key the scrapers would', async () => {
    await offersRepo.ingest([offer('justjoin', 'acme-react', 'React Developer (k/m)', 'Acme Sp. z o.o.')]);
    const byId = await offersRepo.findOffer({ src: 'justjoin', id: 'acme-react', urls: [] });
    const byLink = await offersRepo.findOffer({
      urls: ['https://nowhere.example', 'https://justjoin.example/acme-react'],
    });
    expect(byId?.id).toBe('acme-react');
    expect(byLink?.id).toBe('acme-react');
    expect(await offersRepo.findOffer({ urls: ['https://nowhere.example'] })).toBeNull();
    expect(await offersRepo.findOffer({ urls: [] })).toBeNull(); // nothing asked for: not just any offer
    expect(await offersRepo.jobKeyOf('ACME', 'React Developer')).toBe(byId?.jobKey);
  });

  it("leaves every board's gender tags out of the title key", async () => {
    const plain = await offersRepo.jobKeyOf('Shimi Sp. z o.o.', 'Software Developer');
    for (const title of [
      'Software Developer (m/f/n)',
      'Software Developer (K/M/N)',
      'Software Developer (m/w/d)',
      'Software Developer (h/f)',
      'Software Developer (M/F/NB)',
      'Software Developer (k /m)',
      'Software Developer m/f/d',
    ])
      expect(await offersRepo.jobKeyOf('SHIMI sp. z o.o.', title), title).toBe(plain);
    // single letters inside a title stay
    expect(await offersRepo.jobKeyOf('Shimi', 'Software Developer n')).not.toBe(plain);
  });

  it('leaves a work mode at the end of the title out of the title key', async () => {
    const plain = await offersRepo.jobKeyOf('1dea', 'Frontend Developer (React / TypeScript / AWS)');
    for (const title of [
      'Frontend Developer (React / TypeScript / AWS) (Remote)',
      'Frontend Developer (React / TypeScript / AWS) - 100% zdalnie',
      'Frontend Developer (React / TypeScript / AWS) [Remote]',
      'Frontend Developer (React / TypeScript / AWS) – Fully Remote',
      'Frontend Developer (React / TypeScript / AWS) | Remote',
      'Frontend Developer (React / TypeScript / AWS) (Remote / Hybrid)',
      'Frontend Developer (React / TypeScript / AWS) - Praca zdalna K/M',
      'Frontend Developer (React / TypeScript / AWS) - On-site',
    ])
      expect(await offersRepo.jobKeyOf('1dea', title), title).toBe(plain);
    // a work mode that is part of the title, or all of it, stays
    expect(await offersRepo.jobKeyOf('1dea', 'Remote Sensing Engineer')).toBe('1dea|remotesensingengineer');
    expect(await offersRepo.jobKeyOf('1dea', 'Head of Remote Work')).toBe('1dea|headofremotework');
    expect(await offersRepo.jobKeyOf('1dea', '(Remote)')).toBe('1dea|remote');
  });

  it('counts offers per board, and gives timestamps as ISO 8601', async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'A', 'X'),
      offer('justjoin', '2', 'B', 'Y'),
      offer('rss', '3', 'C', 'Z'),
    ]);
    const counts = await offersRepo.countPerBoard();
    expect(counts.justjoin.offers).toBe(2);
    expect(counts.rss.offers).toBe(1);
    expect(counts.rss.newest).toMatch(ISO);
    expect(await offersRepo.newestFirstSeen()).toMatch(ISO);
  });

  it('marks the jobs you opened as seen, keeping the first time', async () => {
    const [react, java] = await offersRepo.ingest([
      offer('justjoin', '1', 'React Developer', 'Acme'),
      offer('nofluff', 'a', 'Java Developer', 'Other'),
    ]);
    expect((await page()).jobs.map((job) => job.seen)).toEqual([false, false]);
    await markSeen(react.jobKey);
    const [first] = await exec(sql`select seen_at from public.seen_jobs`);
    await markSeen(react.jobKey); // opened again
    expect(await exec(sql`select seen_at from public.seen_jobs`)).toEqual([first]);
    const seen = Object.fromEntries((await page()).jobs.map((job) => [job.jobId, job.seen]));
    expect(seen).toEqual({ [react.jobKey]: true, [java.jobKey]: false });
  });

  it('leaves archived jobs out of the lists and the counts, and lists them on their own', async () => {
    const added = await offersRepo.ingest([
      offer('justjoin', '1', 'React Developer', 'Acme'),
      offer('nofluff', 'a', 'Java Developer', 'Other'),
      offer('bulldog', 'x', 'Go Developer', 'Gopher'),
    ]);
    const jobOf = (src: string) => added.find((row) => row.src === src)?.jobKey ?? '';
    const [react, java, go] = [jobOf('justjoin'), jobOf('nofluff'), jobOf('bulldog')];
    await archive(react);
    await archive(react); // twice: still one
    await archive(java);

    const listed = await page();
    expect(listed.jobs.map((job) => [job.jobId, job.archived])).toEqual([[go, false]]);
    expect([listed.total, listed.archivedCount]).toEqual([1, 2]);
    expect(await getTotalCount()).toBe(1);
    // a filter narrows the archived count too
    expect((await page('java')).archivedCount).toBe(1);

    const archived = await page('', '', { archived: true });
    expect(archived.jobs.map((job) => job.archived)).toEqual([true, true]);
    expect(archived.jobs.map((job) => job.jobId).sort()).toEqual([java, react].sort());
    expect(archived.total).toBe(2);

    // the job's next offer (another board's) stays archived with it
    await offersRepo.ingest([offer('nofluff', 'b', 'React Developer', 'ACME')]);
    expect((await page()).total).toBe(1);

    await restore(react);
    expect((await page()).jobs.map((job) => job.jobId).sort()).toEqual([go, react].sort());
    expect(await getTotalCount()).toBe(2);
  });
});

describeDb('the connection', () => {
  it('asks for statement and lock timeouts', async () => {
    const [timeouts] = await exec(
      sql`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock`,
    );
    expect(timeouts).toEqual({ statement: '30s', lock: '10s' });
  });
});
