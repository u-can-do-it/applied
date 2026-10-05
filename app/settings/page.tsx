import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { env } from '@/lib/env';
import { isUsable } from '@/lib/ai/profiles';
import { effectiveTimeZone } from '@/lib/listings/settings';
import { requestOrigin } from '@/lib/listings/schedule';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as offersRepo from '@/lib/db/repos/offers';
import * as pushRepo from '@/lib/db/repos/push-subscriptions';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { message } from '@/lib/shared/errors';
import { botAnswer, cronInfo, profileList } from '@/lib/health/reads';
import { appSettings } from '@/lib/time-zone';
import { vapidPublicKey } from '@/lib/push';
import { telegramReady } from '@/lib/telegram';
import { Header } from '@/features/shell/header';
import { Tabs, TabsFallback } from '@/features/shell/tabs';
import { LoadError } from '@/components/load-error';
import { TimeZone } from '@/components/time-zone';
import { Skeleton } from '@/components/ui/skeleton';
import { HealthCard, HealthCardFallback } from '@/features/health/health-card';
import { NotificationsPanel } from '@/features/notifications/notifications-panel';
import { FiltersPanel } from '@/features/scraping/filters-panel';
import { SchedulePanel } from '@/features/scraping/schedule-panel';
import { ScrapersPanel } from '@/features/scraping/scrapers-panel';
import { TelegramPanel } from '@/features/telegram/telegram-panel';

export const metadata: Metadata = { title: 'Jobwatch · Settings' };
// Testing a scraper fetches its pages; unmuting and "Send the N now" run the AI check first.
// ("Scrape now" in the header is POST /api/scrape, with a limit of its own.)
export const maxDuration = 300;

export default function SettingsPage() {
  return (
    <main className="wrap">
      <Header />
      <Suspense fallback={<TabsFallback />}>
        <Tabs />
      </Suspense>
      <Suspense fallback={<HealthCardFallback />}>
        <HealthCard />
      </Suspense>
      <Suspense fallback={<SettingsSkeleton />}>
        <Settings />
      </Suspense>
    </main>
  );
}

async function Settings() {
  await connection(); // always fresh: statuses change all the time
  let data;
  try {
    const [settings, scrapers, state, queued, counts] = await Promise.all([
      appSettings(),
      scrapersRepo.list(),
      stateRepo.get(),
      queueRepo.size(),
      offersRepo.countPerBoard(),
    ]);
    data = { settings, scrapers, state, queued, counts };
  } catch (error) {
    return <LoadError title="Can’t load the settings." detail={message(error)} />;
  }
  // the same answers the Health card above got (read once per request)
  const [cron, origin, profiles, devices] = await Promise.all([
    cronInfo(),
    requestOrigin(),
    profileList().catch(() => []),
    // only with the VAPID keys (without them nothing is pushed); not yet migrated (the table is new):
    // none, the Health card says the database is behind
    vapidPublicKey() ? pushRepo.list().catch(() => []) : Promise.resolve([]),
  ]);
  // what the AI filter would check new offers against: the active profile, if it can work
  const active = profiles[0];
  const ai = {
    on: data.settings.aiFilter,
    profile: isUsable(active) ? active.name : null,
    keySet: Boolean(env.OPENAI_API_KEY),
  };
  const { settings, scrapers, state, queued, counts } = data;
  const timeZone = effectiveTimeZone(settings);

  return (
    // times in the app's time zone (a new pick shows once the page is refreshed with it)
    <TimeZone tz={timeZone}>
      <SchedulePanel settings={settings} timeZone={timeZone} cron={cron} endpoint={`${origin}/api/cron/scrape`} />
      <FiltersPanel settings={settings} />
      <NotificationsPanel
        notify={settings.notify}
        muted={state.muted}
        queued={queued}
        ai={ai}
        telegram={telegramReady() && settings.telegramEnabled}
        push={{ publicKey: vapidPublicKey(), endpoints: devices.map((device) => device.endpoint) }}
      />
      {/* the bot is asked over the network: a slow answer holds up only this panel */}
      <Suspense fallback={<Skeleton className="mb-3.5 h-28 rounded-xl" />}>
        <TelegramSection
          ready={telegramReady()}
          enabled={settings.telegramEnabled}
          webhookUrl={`${origin}/api/telegram`}
        />
      </Suspense>
      <ScrapersPanel scrapers={scrapers} counts={counts} keywords={settings.keywords} />
    </TimeZone>
  );
}

async function TelegramSection(props: Omit<React.ComponentProps<typeof TelegramPanel>, 'bot'>) {
  return <TelegramPanel {...props} bot={await botAnswer()} />;
}

function SettingsSkeleton() {
  // visible after 150 ms, so a fast load doesn't flash it
  return (
    <div className="animate-appear-late" aria-busy="true" aria-label="Loading">
      {[180, 260, 140, 320].map((height, i) => (
        <Skeleton key={i} className="mb-3.5 rounded-xl" style={{ height }} />
      ))}
    </div>
  );
}
