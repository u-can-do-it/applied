import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import * as linksRepo from '@/lib/db/repos/job-links';
import * as offersRepo from '@/lib/db/repos/offers';
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

const page = (query = '', src = '', extra: { days?: string; from?: string; to?: string; page?: number } = {}) =>
  getJobs({ q: query, src, page: extra.page ?? 0, days: extra.days, from: extra.from, to: extra.to });

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
    const acme = first.find((row) => row.src === 'justjoin')?.titleKey;
    expect(second).toEqual([{ src: 'nofluff', id: 'b', titleKey: acme, seenBefore: true }]);
    expect(await offersRepo.knownIds('justjoin', ['1', '2'])).toEqual(new Set(['1']));
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

  it('filters by words (title or company), board and days, like before', async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'Senior Frontend Developer (React)', 'Acme'),
      offer('nofluff', '2', 'Backend Developer', 'React Labs'),
      offer('bulldog', '3', 'Senior Java Developer', 'Beans'),
    ]);
    await seenAt('justjoin', '1', '2026-09-20T10:00:00Z');
    await seenAt('nofluff', '2', '2026-09-25T10:00:00Z');
    await seenAt('bulldog', '3', '2026-09-28T10:00:00Z');

    expect((await page('senior react')).jobs.map((job) => job.id)).toEqual(['1']);
    expect((await page('REACT')).jobs.map((job) => job.id)).toEqual(['2', '1']);
    expect((await page('react', 'nofluff')).jobs.map((job) => job.id)).toEqual(['2']);
    // quotes and * separate words, as they always did
    expect((await page('"react*senior"')).jobs.map((job) => job.id)).toEqual(['1']);
    expect((await page('', '', { from: '2026-09-24', to: '2026-09-25' })).jobs.map((job) => job.id)).toEqual(['2']);
    expect((await page('', '', { from: '2026-09-26' })).jobs.map((job) => job.id)).toEqual(['3']);
  });

  it('matches % and _ in the search as themselves, not as wildcards', async () => {
    await offersRepo.ingest([
      offer('justjoin', '1', 'Reactxdev', 'Acme'),
      offer('justjoin', '2', 'react_dev', 'Acme'),
      offer('justjoin', '3', 'Sales 100% remote', 'Beta'),
      offer('justjoin', '4', 'Sales 1000 remote', 'Beta'),
      offer('justjoin', '5', 'Back\\slash', 'Gamma'),
    ]);
    expect((await page('react_dev')).jobs.map((job) => job.id)).toEqual(['2']);
    expect((await page('100%')).jobs.map((job) => job.id)).toEqual(['3']);
    expect((await page('k\\s')).jobs.map((job) => job.id)).toEqual(['5']);
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

  it('shows merged jobs as one, and counts them once', async () => {
    const added = await offersRepo.ingest([
      offer('justjoin', '1', 'Frontend Engineer', 'Acme'),
      offer('nofluff', '2', 'Front-end Engineer (React)', 'Acme'),
    ]);
    expect(await getTotalCount()).toBe(2);
    await linksRepo.mergeJobs(added[0].titleKey, added[1].titleKey);
    expect(await linksRepo.jobIdOf(added[1].titleKey)).toBe(added[0].titleKey);
    const { jobs, total } = await page();
    expect(total).toBe(1);
    expect(await getTotalCount()).toBe(1);
    expect(jobs[0].jobId).toBe(added[0].titleKey);
    expect(jobs[0].offers).toHaveLength(2);
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
    expect(await offersRepo.titleKeyOf('ACME', 'React Developer')).toBe(byId?.titleKey);
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
    await markSeen(react.titleKey);
    const [first] = await exec(sql`select seen_at from public.seen_jobs`);
    await markSeen(react.titleKey); // opened again
    expect(await exec(sql`select seen_at from public.seen_jobs`)).toEqual([first]);
    const seen = Object.fromEntries((await page()).jobs.map((job) => [job.jobId, job.seen]));
    expect(seen).toEqual({ [react.titleKey]: true, [java.titleKey]: false });
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
