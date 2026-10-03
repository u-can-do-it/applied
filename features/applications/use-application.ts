'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Application, ApplicationWithContent } from '@/lib/applications';

/** An application as its window shows it: no content yet = the ad text is still loading. */
export type Shown = Application & { content?: string | null };

export const applicationKey = (jobId: string) => ['application', jobId] as const;

const PENDING_EVERY_MS = 3000;

/** GET /api/application: the saved application with its complete ad text. */
export async function loadApplication(jobId: string) {
  const res = await fetch(`/api/application?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ApplicationWithContent;
}

/**
 * One application's window: its saved ad and its current status. The ad text is fetched in the
 * background right after marking: while it is (`pending`), it's asked for again 3 s after the last
 * answer, until it's in. A failed load stops that and shows; the next action loads again.
 * `acting`: an action is on its way. No looking meanwhile: an answer from before the action is
 * done would bring the old status back over the one shown at once; the action loads after it.
 */
export function useApplication(jobId: string, { acting }: { acting: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery<Shown>({
    queryKey: applicationKey(jobId),
    queryFn: () => loadApplication(jobId),
    refetchInterval: (current) =>
      !acting && current.state.data?.contentStatus === 'pending' && !current.state.error ? PENDING_EVERY_MS : false,
    // it always kept looking while the browser tab was in the background
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
  // Closed (or another job's after an edit): forgotten, so the next opening starts from the list's
  // copy and loads, as before. gcTime 0 covers the query the window started; this covers one that
  // setQueryData made before it had an observer (an edit that made it another job's), which got the
  // default gcTime, and TanStack only ever raises a query's gcTime.
  useEffect(
    () => () => queryClient.removeQueries({ queryKey: applicationKey(jobId), exact: true }),
    [jobId, queryClient],
  );
  return query;
}
