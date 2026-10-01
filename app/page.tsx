import { Suspense } from 'react';
import { AutoRefresh } from './auto-refresh';
import { Controls, ControlsFallback } from './controls';
import { Results, ResultsSkeleton } from './results';
import { ResultsBoundary } from './results-boundary';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The page itself never awaits anything, so everything outside the <Suspense> boundaries
// is part of the static shell: served instantly on load and prefetched for navigations.
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="wrap">
      <header className="top">
        <h1>Jobwatch</h1>
        <AutoRefresh />
      </header>

      {/* reads the URL on the client; resolves synchronously on client navigations */}
      <Suspense fallback={<ControlsFallback />}>
        <Controls />
      </Suspense>

      {/* the only part that waits for Supabase */}
      <Suspense fallback={<ResultsSkeleton />}>
        <ResultsBoundary fallback={<ResultsSkeleton />}>
          <Results searchParams={searchParams} />
        </ResultsBoundary>
      </Suspense>
    </main>
  );
}
