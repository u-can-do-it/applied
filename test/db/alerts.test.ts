import { sql } from 'drizzle-orm';
import { beforeEach, expect, it, vi } from 'vitest';
import { readPosting } from '@/lib/ads/linkedin';
import * as alertsRepo from '@/lib/db/repos/alert-jobs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { runAll } from '@/lib/listings/run';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { describeDb, exec, ISO } from './database';

// LinkedIn's alert emails against the database: the jobs waiting in alert_jobs, and a run that reads them
// (lib/listings/pipeline/alerts.ts). LinkedIn's postings are mocked; no network.

vi.mock('@/lib/ads/linkedin', () => ({ readPosting: vi.fn(), readLinkedin: vi.fn() }));
const read = vi.mocked(readPosting);
const LONG = ' We build web apps for clients across Europe, in a team of twelve, with code review and CI.';

const outcomes = () => exec(sql`select id, outcome, done_at is not null as done from public.alert_jobs order by id`);

describeDb('alert jobs', () => {
  beforeEach(() => {
    read.mockReset();
  });

  it('adds each job once, and the waiting ones come oldest first', async () => {
    expect(await alertsRepo.add('linkedin', ['3', '1'])).toBe(2);
    await exec(sql`update public.alert_jobs set received_at = now() - interval '1 hour' where id = '3'`);
    expect(await alertsRepo.add('linkedin', ['1', '2'])).toBe(1); // 1 came in an email before
    expect(await alertsRepo.add('linkedin', [])).toBe(0);
    expect(await alertsRepo.waiting('linkedin', 10)).toEqual(['3', '1', '2']);
    expect(await alertsRepo.waiting('linkedin', 2)).toEqual(['3', '1']);
    expect(await alertsRepo.waiting('other', 10)).toEqual([]);
  });

  it('settles them, counts the week and the waiting, and keeps a month', async () => {
    await alertsRepo.add('linkedin', ['1', '2', '3', '4', 'old']);
    await alertsRepo.settle(
      'linkedin',
      new Map([
        ['1', 'kept'],
        ['2', 'skipped'],
        ['3', 'known'],
      ] as const),
    );
    expect(await alertsRepo.waiting('linkedin', 10)).toEqual(['4', 'old']);
    expect(await alertsRepo.counts('linkedin')).toEqual({ waiting: 2, kept: 1, skipped: 1, known: 1 });

    await exec(sql`update public.alert_jobs set received_at = now() - interval '8 days' where id in ('1', 'old')`);
    // out of the week, but one still waiting is counted
    expect(await alertsRepo.counts('linkedin')).toEqual({ waiting: 2, kept: 0, skipped: 1, known: 1 });

    await exec(sql`update public.alert_jobs set received_at = now() - interval '31 days' where id = 'old'`);
    await alertsRepo.add('linkedin', []);
    expect(await alertsRepo.waiting('linkedin', 10)).toEqual(['4']);
  });

  it('keeps the last email’s time and jobs', async () => {
    expect(await stateRepo.get()).toMatchObject({ alertEmailAt: null, alertEmailJobs: null });
    await stateRepo.markAlertEmail(6);
    const state = await stateRepo.get();
    expect(state.alertEmailAt).toMatch(ISO);
    expect(state.alertEmailJobs).toBe(6);
  });

  it('a run reads the waiting jobs, saves what passes the filters and announces it', async () => {
    await settingsRepo.save({ ...DEFAULT_SETTINGS, keywords: ['React'], cities: ['warszawa'], notify: false });
    await exec(sql`insert into public.offers (src, id, title, url) values
      ('linkedin', '3', 'React Developer', 'https://www.linkedin.com/jobs/view/3')`);
    await alertsRepo.add('linkedin', ['1', '2', '3']);
    read.mockImplementation((id) =>
      Promise.resolve(
        id === '1'
          ? {
              title: 'Front End Engineer',
              text: `React, TypeScript.${LONG}`,
              details: { company: 'WPP', location: 'Warszawa' },
            }
          : {
              title: 'Java Developer',
              text: `Java, Spring.${LONG}`,
              details: { company: 'Acme', location: 'Warszawa' },
            },
      ),
    );

    const summary = await runAll('manual');

    expect(summary).toMatchObject({ found: 3, kept: 1, added: 1, fresh: 1, errors: [] }); // 3 looked at, 1 kept
    expect(read.mock.calls.map(([id]) => id)).toEqual(['1', '2']); // 3 was saved before: not read
    expect(await exec(sql`select id, title, company from public.offers where id = '1'`)).toEqual([
      { id: '1', title: 'Front End Engineer', company: 'WPP' },
    ]);
    expect(await outcomes()).toEqual([
      { id: '1', outcome: 'kept', done: true },
      { id: '2', outcome: 'skipped', done: true },
      { id: '3', outcome: 'known', done: true },
    ]);

    // the next run: nothing waits, nothing is read
    read.mockClear();
    expect(await runAll('manual')).toMatchObject({ found: 0, added: 0 });
    expect(read).not.toHaveBeenCalled();
  });

  it('a job whose posting LinkedIn refused waits for the next run', async () => {
    await settingsRepo.save({ ...DEFAULT_SETTINGS, keywords: ['React'], cities: ['warszawa'], notify: false });
    await alertsRepo.add('linkedin', ['1']);
    read.mockRejectedValue(new Error('HTTP 429'));
    const summary = await runAll('manual');
    expect(summary.errors).toEqual([
      { scraper: 'LinkedIn alert emails', error: 'reading the jobs: job 1: HTTP 429; 1 wait for the next run' },
    ]);
    expect(await alertsRepo.waiting('linkedin', 10)).toEqual(['1']);
  });
});
