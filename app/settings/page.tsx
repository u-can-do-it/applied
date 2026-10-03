import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { env } from '@/lib/env';
import { isUsable, listProfiles } from '@/lib/ai/profiles';
import { effectiveTimeZone } from '@/lib/listings/settings';
import { requestOrigin } from '@/lib/listings/schedule';
import * as cronRepo from '@/lib/db/repos/cron';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as offersRepo from '@/lib/db/repos/offers';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { message } from '@/lib/shared/errors';
import { botInfo, telegramReady } from '@/lib/telegram';
import { Header } from '../header';
import { Tabs, TabsFallback } from '../tabs';
import { TimeZone } from '../time-zone';
import { FiltersPanel, SchedulePanel, TelegramPanel } from './panels';
import { ScrapersPanel } from './scrapers';

export const metadata: Metadata = { title: 'Jobwatch · Settings' };
// "Scrape now" and the scraper tests run in this page's server actions
export const maxDuration = 300;

export default function SettingsPage() {
  return (
    <main className="wrap">
      <Header />
      <Suspense fallback={<TabsFallback />}>
        <Tabs />
      </Suspense>
      <Suspense fallback={<SettingsSkeleton />}>
        <Settings />
      </Suspense>
    </main>
  );
}

async function Settings() {
  await connection(); // always fresh: runs and statuses change all the time
  let data;
  try {
    const [settings, scrapers, state, runs, queued, counts] = await Promise.all([
      settingsRepo.get(),
      scrapersRepo.list(),
      stateRepo.get(),
      runsRepo.list(12),
      queueRepo.size(),
      offersRepo.countPerBoard(),
    ]);
    data = { settings, scrapers, state, runs, queued, counts };
  } catch (error) {
    return (
      <div className="notice">
        <strong>Can’t load the scraping settings.</strong>
        <code>{message(error)}</code>
      </div>
    );
  }
  const [cron, bot, origin, profiles] = await Promise.all([
    cronRepo.status().catch((failure: unknown): cronRepo.CronStatus & { error: string } => ({
      available: false,
      error: message(failure),
    })),
    telegramReady() ? botInfo().catch((failure: unknown) => ({ error: message(failure) })) : Promise.resolve(null),
    requestOrigin(),
    listProfiles().catch(() => []),
  ]);
  // what the AI filter would check new offers against: the active profile, if it can work
  const active = profiles[0];
  const ai = {
    on: data.settings.aiFilter,
    profile: isUsable(active) ? active.name : null,
    keySet: Boolean(env.OPENAI_API_KEY),
  };
  const { settings, scrapers, state, runs, queued, counts } = data;

  return (
    // times in the app's time zone (a new pick shows once the page is refreshed with it)
    <TimeZone tz={effectiveTimeZone(settings)}>
      <SchedulePanel
        settings={settings}
        state={state}
        // eslint-disable-next-line react-hooks/purity -- a server component renders once per request: "now" is that request's time
        running={Boolean(state.lockedUntil && Date.parse(state.lockedUntil) > Date.now())}
        runs={runs}
        cron={cron}
        endpoint={`${origin}/api/cron/scrape`}
      />
      <FiltersPanel settings={settings} />
      <TelegramPanel
        ready={telegramReady()}
        bot={bot}
        notify={settings.notify}
        muted={state.muted}
        queued={queued}
        ai={ai}
        webhookUrl={`${origin}/api/telegram`}
      />
      <ScrapersPanel scrapers={scrapers} counts={counts} keywords={settings.keywords} />
    </TimeZone>
  );
}

function SettingsSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {[180, 260, 140, 320].map((height, i) => (
        <div key={i} className="panel" style={{ height }} />
      ))}
    </div>
  );
}
