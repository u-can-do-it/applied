import { Suspense } from 'react';
import { AutoRefresh } from './auto-refresh';
import { Controls, ControlsFallback } from './controls';
import { NavProvider } from './nav';
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

      {/* NavProvider reads the URL on the client, so the first HTML shows the fallback */}
      <Suspense
        fallback={
          <>
            <ControlsFallback />
            <div className="results">
              <ResultsSkeleton />
            </div>
          </>
        }
      >
        <NavProvider>
          <Controls />
          <div className="results">
            {/* the only part that waits for Supabase */}
            <ResultsBoundary fallback={<ResultsSkeleton />}>
              <Results searchParams={searchParams} />
            </ResultsBoundary>
          </div>
        </NavProvider>
      </Suspense>
    </main>
  );
}
