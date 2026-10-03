import { connection } from 'next/server';
import { Suspense } from 'react';
import type { SearchParams } from '@/lib/shared/search-params';
import { filterSources, sourceOptions } from '@/lib/listings/sources';
import { AiFilterBar } from './ai-filter-bar';
import { Controls, ControlsFallback } from './controls';
import { Header } from './header';
import { NavProvider } from './nav';
import { Results, ResultsSkeleton } from './results';
import { ResultsBoundary } from './results-boundary';
import { Tabs, TabsFallback } from './tabs';

// Shared by "/" (all offers) and "/ai" (the same list, narrowed by the AI filter).
// Nothing here awaits, so everything outside the <Suspense> boundaries is static shell.
export function OffersView({ searchParams, mode }: { searchParams: SearchParams; mode: 'all' | 'ai' }) {
  return (
    <main className="wrap">
      <Header />

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
            <ControlsFallback labels={filterSources().map((source) => source.label)} />
            <div className="results">
              <ResultsSkeleton />
            </div>
          </>
        }
      >
        <OffersBody searchParams={searchParams} mode={mode} />
      </Suspense>
    </main>
  );
}

// The source chips include your own scrapers: their list is fetched alongside the offers (not
// before them), and the chips render once it's in. Not while prerendering the shell at build time
// (connection()): the build has no database to ask, or must not ask the one in .env.
async function OffersBody({ searchParams, mode }: { searchParams: SearchParams; mode: 'all' | 'ai' }) {
  await connection();
  // without the database (it's down) the chips are the built-in boards; the list says what's wrong
  const sources = sourceOptions().catch(() => filterSources());
  return (
    <NavProvider>
      <Controls sources={sources} />
      <div className="results">
        {/* the only part that waits for Supabase (and, on /ai, the verdicts) */}
        <ResultsBoundary fallback={<ResultsSkeleton />}>
          <Results searchParams={searchParams} mode={mode} sources={sources} />
        </ResultsBoundary>
      </div>
    </NavProvider>
  );
}
