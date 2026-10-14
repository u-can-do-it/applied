'use client';

import { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TimeZone } from '@/components/time-zone';
import type { ApplicationWithContent } from '@/lib/applications';
import { message } from '@/lib/shared/errors';
import { applicationKey, loadApplication } from '@/features/applications/use-application';

// The application's window (as on the Applied tab) loads when it's first opened: the offers don't
// need its editors until then. It loads alongside the application, so it's in when that is.
const loadSheet = () => import('@/features/applications/application-sheet');
const ApplicationSheet = lazy(() => loadSheet().then((module) => ({ default: module.ApplicationSheet })));

// fetched as you point at what opens it (or tab to it), so the click finds it in: younger than this, the
// click uses it; the window then checks it again as it opens, as on the Applied tab
const PREFETCHED_FOR_MS = 30_000;
const applicationQuery = (jobId: string) => ({
  queryKey: applicationKey(jobId),
  queryFn: () => loadApplication(jobId),
  staleTime: PREFETCHED_FOR_MS,
});

/**
 * An applied offer's window, the application's: `prefetch` on pointing at what opens it, `open` on its
 * click (a failure goes to `onError`), and `window` rendered beside it.
 */
export function useApplicationWindow({
  jobId,
  labels,
  tz,
  onError,
}: {
  jobId: string;
  labels: Record<string, string>;
  tz: string;
  onError: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState(false);
  const [shown, setShown] = useState<ApplicationWithContent | null>(null); // its window is open

  // the application and the window's code, on the way before the click; a failure shows on the click
  const prefetch = () => {
    if (shown) return;
    void queryClient.query(applicationQuery(jobId)).catch(() => {});
    void loadSheet().catch(() => {});
  };

  // the window opens with the application as the database has it (the list has only the day)
  const open = async () => {
    if (shown || opening) return;
    onError(null);
    setOpening(true);
    try {
      const [app] = await Promise.all([queryClient.query(applicationQuery(jobId)), loadSheet()]);
      setShown(app);
    } catch (failed) {
      onError(message(failed));
    } finally {
      setOpening(false);
    }
  };

  const window = shown && (
    <TimeZone tz={tz}>
      <Suspense fallback={null}>
        <ApplicationSheet
          initial={shown}
          labels={labels}
          onClose={() => setShown(null)}
          // no notes in the offer list: the window saves them, the Applied tab shows them
          onNoteSaved={() => {}}
          onNoteStale={() => {}}
        />
      </Suspense>
    </TimeZone>
  );

  return { prefetch, open, opening, window };
}
