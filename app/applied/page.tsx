import type { Metadata } from 'next';
import { after, connection } from 'next/server';
import { Suspense } from 'react';
import { ghostStale, listApplications, readDetailsFromText } from '@/lib/applications';
import { log } from '@/lib/log';
import { message } from '@/lib/shared/errors';
import { labelsOf, boardOptions } from '@/lib/listings/board-filter';
import { appTimeZone } from '@/lib/time-zone';
import { Header } from '@/features/shell/header';
import { ResultsSkeleton } from '@/features/offers/results';
import { Tabs, TabsFallback } from '@/features/shell/tabs';
import { AppliedList } from '@/features/applications/applied-list';
import { LoadError } from '@/components/load-error';

export const metadata: Metadata = { title: 'Jobwatch · Applied' };
// "+ Add application" reads the link's page and asks OpenAI; adding, editing and "Fetch again"
// read the boards' pages (in after() or while you wait). ("Scrape now" is POST /api/scrape.)
export const maxDuration = 300;

export default function AppliedPage() {
  return (
    <main className="wrap">
      <Header />
      <Suspense fallback={<TabsFallback />}>
        <Tabs />
      </Suspense>
      <Suspense fallback={<ResultsSkeleton />}>
        <Applications />
      </Suspense>
    </main>
  );
}

async function Applications() {
  await connection(); // always fresh: this list changes whenever you mark an offer
  let loaded: [Awaited<ReturnType<typeof listApplications>>, Awaited<ReturnType<typeof boardOptions>>, string];
  try {
    // a month without news turns "in progress" into "ghosted"; done on the way in, so the list is current
    await ghostStale().catch((failure: unknown) => {
      log.error('Ghosting stale applications failed', { route: '/applied', error: failure });
    });
    loaded = await Promise.all([listApplications(), boardOptions(), appTimeZone()]);
    // ad texts saved before their details were read from them (salary, work mode…): 40 per visit
    after(() =>
      readDetailsFromText().catch((failure: unknown) => {
        log.error('Reading details from the ad texts failed', { route: '/applied', error: failure });
      }),
    );
  } catch (error) {
    return <LoadError title="Can’t load applications." detail={message(error)} />;
  }
  const [apps, boards, tz] = loaded;
  return <AppliedList apps={apps} labels={labelsOf(boards)} tz={tz} />;
}
