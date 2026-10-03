import { connection } from 'next/server';
import { Suspense } from 'react';
import { appSettings } from '@/lib/time-zone';
import { AutoRefresh } from './auto-refresh';
import { ScrapeButton } from '@/features/scraping/scrape-button';
import { BrowserZone } from './browser-zone';

export function Header() {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-3 max-[480px]:flex-wrap">
      <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">Jobwatch</h1>
      <div className="flex items-center gap-3">
        <ScrapeButton />
        <AutoRefresh />
      </div>
      <Suspense fallback={null}>
        <ZoneCheck />
      </Suspense>
    </header>
  );
}

// The app follows the browser's time zone unless one is picked in Settings: this one's goes to the
// server when it's not the zone the server has (opened elsewhere, or the first time).
async function ZoneCheck() {
  await connection();
  // the header is on every page: the database being down shows in the page's own content, not here
  const settings = await appSettings().catch(() => null);
  return settings && !settings.timeZone ? <BrowserZone known={settings.browserTimeZone} /> : null;
}
