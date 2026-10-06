import { connection } from 'next/server';
import { Suspense } from 'react';
import type { SearchParams } from '@/lib/shared/search-params';
import { DEFAULT_TZ } from '@/lib/dates';
import { filterBoards, boardOptions } from '@/lib/listings/board-filter';
import { appTimeZone } from '@/lib/time-zone';
import { Controls, ControlsFallback } from './controls';
import { Header } from '@/features/shell/header';
import { NavProvider } from './nav';
import { Results, ResultsSkeleton } from './results';
import { ResultsBoundary } from './results-boundary';
import { Tabs, TabsFallback } from '@/features/shell/tabs';

// the list area never collapses while loading, so the page height (and your scroll position on the
// chips) stays put when the rows are replaced by the skeleton
const RESULTS = 'min-h-screen';

// The offers ("/"): every job, or (?fit=) the AI's matches or rejected ones.
// Nothing here awaits, so everything outside the <Suspense> boundaries is static shell.
export function OffersView({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="wrap">
      <Header />

      {/* tab links keep the current filters, so they read the URL */}
      <Suspense fallback={<TabsFallback />}>
        <Tabs />
      </Suspense>

      {/* NavProvider reads the URL on the client, so the first HTML shows the fallback */}
      <Suspense
        fallback={
          <>
            <ControlsFallback labels={filterBoards().map((board) => board.label)} />
            <div className={RESULTS}>
              <ResultsSkeleton />
            </div>
          </>
        }
      >
        <OffersBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// The board chips include your own scrapers' boards: their list is fetched alongside the offers (not
// before them), and the chips render once it's in. Not while prerendering the shell at build time
// (connection()): the build has no database to ask, or must not ask the one in .env.
async function OffersBody({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  // without the database (it's down) the chips are the built-in boards; the list says what's wrong
  const boards = boardOptions().catch(() => filterBoards());
  // the date picker's "today" is the app's (the list's days are)
  const tz = appTimeZone().catch(() => DEFAULT_TZ);
  return (
    <NavProvider>
      <Controls boards={boards} tz={tz} />
      <div className={RESULTS}>
        {/* the only part that waits for Supabase */}
        <ResultsBoundary fallback={<ResultsSkeleton />}>
          <Results searchParams={searchParams} boards={boards} />
        </ResultsBoundary>
      </div>
    </NavProvider>
  );
}
