import { Suspense } from 'react';
import { AiFilterBar } from './ai-filter-bar';
import { AutoRefresh } from './auto-refresh';
import { Controls, ControlsFallback } from './controls';
import { NavProvider } from './nav';
import { Results, ResultsSkeleton } from './results';
import { ResultsBoundary } from './results-boundary';
import { Tabs, TabsFallback } from './tabs';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Shared by "/" (all offers) and "/ai" (the same list, narrowed by the AI filter).
// Nothing here awaits, so everything outside the <Suspense> boundaries is static shell.
export function OffersView({ searchParams, mode }: { searchParams: SearchParams; mode: 'all' | 'ai' }) {
  return (
    <main className="wrap">
      <header className="top">
        <h1>Jobwatch</h1>
        <AutoRefresh />
      </header>

      {/* tab links keep the current filters, so they read the URL */}
      <Suspense fallback={<TabsFallback />}>
        <Tabs />
      </Suspense>

      {mode === 'ai' && (
        // profiles, runs and "N new" counts; reads the date filter from the URL
        <Suspense fallback={<div className="ai-bar ai-bar-loading" aria-busy="true" />}>
          <AiFilterBar searchParams={searchParams} />
        </Suspense>
      )}

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
            {/* the only part that waits for Supabase (and, on /ai, the verdicts) */}
            <ResultsBoundary fallback={<ResultsSkeleton />}>
              <Results searchParams={searchParams} mode={mode} />
            </ResultsBoundary>
          </div>
        </NavProvider>
      </Suspense>
    </main>
  );
}
