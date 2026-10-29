'use client';

import { PencilIcon } from 'lucide-react';
import type { Find } from '@/lib/shared/search';
import { Marked } from '@/components/marked';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Shown } from './use-application';
import { useDay } from './use-day';

/** What the box needs: an application's, or an offer's (its window names them the same). */
export type ShownAd = Pick<Shown, 'content' | 'contentStatus' | 'contentError' | 'scrapedAt'>;

/**
 * The text by lines, a bullet's wrapped lines under its text, not under the "•". A text saved before
 * htmlToText read source line breaks as spaces has its "•" on a line of its own, a blank line before
 * it: shown as it is saved now. `find`: the list's search, its words marked (a line at a time).
 */
function AdLines({ text, find }: { text: string; find?: Find }) {
  return text
    .replace(/\n+•\n+/g, '\n• ')
    .split('\n')
    .map((line, i) =>
      line.startsWith('• ') ? (
        <div key={i} className="pl-[1.1em] -indent-[1.1em]">
          <span className="inline-block w-[1.1em] indent-0">• </span>
          <Marked text={line.slice(2)} marks={find?.(line.slice(2))} />
        </div>
      ) : (
        <div key={i} className="min-h-[1lh]">
          <Marked text={line} marks={find?.(line)} />
        </div>
      ),
    );
}

/**
 * The saved ad text. It loads into this box, which has the same place and size before and after; it
 * fills what's left, so a short ad or the placeholder look the same as a long one. `onEdit`: an
 * offer's window lets you change it, or paste one the board page doesn't give. `find`: the list's
 * search, its words marked.
 */
export function AdText({
  ad: app,
  loadError,
  onEdit,
  find,
}: {
  ad: ShownAd;
  loadError: string | null;
  onEdit?: () => void;
  find?: Find;
}) {
  const day = useDay();
  const waiting = app.content === undefined || app.contentStatus === 'pending';
  const text = app.contentStatus === 'ok' && app.content;
  const hasText = !!text;
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
          <AdLines text={text} find={find} />
        ) : (
          <p className="m-0 text-[13px] text-destructive">
            {app.contentStatus === 'empty' ? 'The board page had no ad text.' : 'Couldn’t fetch the ad.'}{' '}
            {app.contentError}
          </p>
        )}
      </div>
      {((app.scrapedAt && hasText) || (onEdit && !waiting)) && (
        <p className="m-0 -mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          {app.scrapedAt && hasText && <>saved {day(app.scrapedAt)}.</>}
          {onEdit && !waiting && (
            <Button type="button" variant="link" size="xs" className="ml-auto px-0" onClick={onEdit}>
              <PencilIcon /> {hasText ? 'Edit the ad' : 'Paste the ad text'}
            </Button>
          )}
        </p>
      )}
    </>
  );
}
