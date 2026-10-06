import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { SearchParams } from '@/lib/shared/search-params';
import { Header } from '@/features/shell/header';
import { Tabs, TabsFallback } from '@/features/shell/tabs';
import { Activity } from '@/features/activity/activity';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Jobwatch · Activity' };

export default function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="wrap">
      <Header />
      <Suspense fallback={<TabsFallback />}>
        <Tabs />
      </Suspense>
      <Suspense fallback={<ActivitySkeleton />}>
        <Activity searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function ActivitySkeleton() {
  // visible after 150 ms, so a fast load doesn't flash it
  return (
    <div className="animate-appear-late" aria-busy="true" aria-label="Loading">
      {[320, 200, 120, 100, 160].map((height, i) => (
        <Skeleton key={i} className="mb-3.5 rounded-xl" style={{ height }} />
      ))}
    </div>
  );
}
