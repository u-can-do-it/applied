'use client';

import { Skeleton } from '@/components/ui/skeleton';
import type { Shown } from './use-application';
import { useDay } from './use-day';

/** What the box needs: an application's, or an offer's (its window names them the same). */
export type ShownAd = Pick<Shown, 'content' | 'contentStatus' | 'contentError' | 'scrapedAt'>;

/**
 * The saved ad text. It loads into this box, which has the same place and size before and after; it
 * fills what's left, so a short ad or the placeholder look the same as a long one.
 */
export function AdText({ ad: app, loadError }: { ad: ShownAd; loadError: string | null }) {
  const day = useDay();
  const waiting = app.content === undefined || app.contentStatus === 'pending';
  const hasText = app.contentStatus === 'ok' && !!app.content;
  return (
    <>
      <div
        className="min-h-[180px] flex-[1_0_auto]! rounded-lg border bg-background px-3.5 py-3 text-sm leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]"
        aria-busy={waiting || undefined}
      >
        {waiting ? (
          loadError ? (
            <p className="m-0 text-[13px] text-destructive">Couldn’t load the ad: {loadError}</p>
          ) : (
            <div
              className="flex animate-appear-late flex-col gap-[13px] pt-1"
              role="status"
              aria-label={app.contentStatus === 'pending' ? 'Saving the ad text' : 'Loading the ad text'}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-[11px] rounded-sm" style={{ width: `${58 + ((i * 29) % 40)}%` }} />
              ))}
            </div>
          )
        ) : hasText ? (
          app.content
        ) : (
          <p className="m-0 text-[13px] text-destructive">
            {app.contentStatus === 'empty' ? 'The board page had no ad text.' : 'Couldn’t fetch the ad.'}{' '}
            {app.contentError}
          </p>
        )}
      </div>
      {app.scrapedAt && hasText && (
        <p className="m-0 -mt-1.5 text-xs text-muted-foreground">saved {day(app.scrapedAt)}.</p>
      )}
    </>
  );
}
