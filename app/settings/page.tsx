import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { env } from '@/lib/env';
import { isUsable, listProfiles } from '@/lib/profiles';
import { effectiveTimeZone } from '@/lib/scraping/kinds';
import { requestOrigin } from '@/lib/scraping/schedule';
import * as store from '@/lib/scraping/store';
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
      store.getSettings(),
      store.listScrapers(),
      store.getState(),
      store.listRuns(12),
      store.queueSize(),
      store.sourceCounts(),
    ]);
    data = { settings, scrapers, state, runs, queued, counts };
  } catch (e) {
    return (
      <div className="notice">
        <strong>Can’t load the scraping settings.</strong> Did you run <code>npm run db:migrate</code>?
        <code>{message(e)}</code>
      </div>
    );
  }
  const [cron, bot, origin, profiles] = await Promise.all([
    store
      .cronStatus()
      .catch((e: unknown): store.CronStatus & { error: string } => ({ available: false, error: message(e) })),
    telegramReady() ? botInfo().catch((e: unknown) => ({ error: message(e) })) : Promise.resolve(null),
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
        running={Boolean(state.locked_until && Date.parse(state.locked_until) > Date.now())}
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
      {[180, 260, 140, 320].map((h, i) => (
        <div key={i} className="panel" style={{ height: h }} />
      ))}
    </div>
  );
}
