import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ghostStale, listApplications } from '@/lib/applications';
import { message } from '@/lib/shared/errors';
import { labelsOf, boardOptions } from '@/lib/listings/board-filter';
import { appTimeZone } from '@/lib/time-zone';
import { Header } from '../header';
import { ResultsSkeleton } from '../results';
import { Tabs, TabsFallback } from '../tabs';
import { AppliedList } from './applied-list';

export const metadata: Metadata = { title: 'Jobwatch · Applied' };
export const maxDuration = 300; // "Scrape now" in the header

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
    await ghostStale().catch((failure: unknown) => console.error('[applied] ghosting failed:', failure));
    loaded = await Promise.all([listApplications(), boardOptions(), appTimeZone()]);
  } catch (error) {
    return (
      <div className="notice">
        <strong>Can’t load applications.</strong>
        <code>{message(error)}</code>
      </div>
    );
  }
  const [apps, boards, tz] = loaded;
  return <AppliedList apps={apps} labels={labelsOf(boards)} tz={tz} />;
}
