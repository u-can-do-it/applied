import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ghostStale, listApplications } from '@/lib/applications';
import { labelsOf, sourceOptions } from '@/lib/source-list';
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
  try {
    // a month without news turns "in progress" into "ghosted"; done on the way in, so the list is current
    await ghostStale().catch((e) => console.error('[applied] ghosting failed:', e));
    const [apps, sources] = await Promise.all([listApplications(), sourceOptions()]);
    return <AppliedList apps={apps} labels={labelsOf(sources)} />;
  } catch (e) {
    return (
      <div className="notice">
        <strong>Can’t load applications.</strong> Did you run <code>scripts/db-migrate.sh</code>?
        <code>{e instanceof Error ? e.message : String(e)}</code>
      </div>
    );
  }
}
