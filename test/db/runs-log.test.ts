import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import { describeDb, exec } from './database';

// The Activity tab's run log, a page at a time (lib/db/repos/scrape-runs.ts page, counts): the newest
// first, by what started a run or only the ones where something failed, counted over the whole log.

type Failure = { scraper: string; error: string; warning?: true };

async function run(minute: number, trigger: string, errors: Failure[] = []) {
  const at = new Date(Date.parse('2026-10-06T05:00:00Z') + minute * 60_000).toISOString();
  await exec(sql`insert into public.scrape_runs (trigger, started_at, finished_at, errors)
    values (${trigger}, ${at}::timestamptz, ${at}::timestamptz, ${JSON.stringify(errors)}::jsonb)`);
}
const minutes = (runs: { startedAt: string }[]) =>
  runs.map((one) => (Date.parse(one.startedAt) - Date.parse('2026-10-06T05:00:00Z')) / 60_000);

describeDb('the runs log', () => {
  it('a page of the newest runs, by trigger or with errors, and how many each filter has', async () => {
    const adzuna = { scraper: 'Adzuna', error: 'HTTP 503, message: Service Temporarily Unavailable' };
    const warning = { scraper: 'Notify', error: 'Sent 1; Telegram sendMessage: HTTP 500', warning: true as const };
    for (let minute = 0; minute < 70; minute += 10) await run(minute, 'cron', minute % 60 ? [] : [adzuna]);
    await run(15, 'manual', [warning]); // went through all the same: not "with errors"
    await run(25, 'manual', [warning, adzuna]);
    await run(35, 'telegram');

    expect(minutes(await runsRepo.page({}, 0, 4))).toEqual([60, 50, 40, 35]);
    expect(minutes(await runsRepo.page({}, 1, 4))).toEqual([30, 25, 20, 15]);
    expect(minutes(await runsRepo.page({}, 2, 4))).toEqual([10, 0]);
    expect(await runsRepo.page({}, 3, 4)).toEqual([]);
    expect(minutes(await runsRepo.page({ trigger: 'manual' }, 0, 4))).toEqual([25, 15]);
    expect(minutes(await runsRepo.page({ failed: true }, 0, 4))).toEqual([60, 25, 0]);
    expect(minutes(await runsRepo.page({ failed: true }, 1, 2))).toEqual([0]);

    expect(await runsRepo.counts()).toEqual({ all: 10, failed: 3, byTrigger: { cron: 7, manual: 2, telegram: 1 } });
    await exec(sql`delete from public.scrape_runs`);
    expect(await runsRepo.counts()).toEqual({ all: 0, failed: 0, byTrigger: {} });
  });
});
