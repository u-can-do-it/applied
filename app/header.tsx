import { connection } from 'next/server';
import { Suspense } from 'react';
import { appSettings } from '@/lib/time-zone';
import { AutoRefresh } from './auto-refresh';
import { ScrapeButton } from './scrape-button';
import { BrowserZone } from './time-zone';

export function Header() {
  return (
    <header className="top">
      <h1>Jobwatch</h1>
      <div className="top-side">
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
