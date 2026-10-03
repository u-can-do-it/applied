'use client';

import { BellOffIcon } from 'lucide-react';
import { useZone } from '@/components/time-zone';
import type { QueuedAt } from '@/lib/db/repos/notify-queue';

/** The offers waiting to be sent to Telegram, oldest first: the first few of `total`. */
export function QueueList({ queue, total, muted }: { queue: QueuedAt[]; total: number; muted: boolean }) {
  const zone = useZone();
  return (
    <>
      <p className="my-1.5 text-xs text-muted-foreground">
        {muted && (
          <>
            <BellOffIcon /> Muted.{' '}
          </>
        )}
        {total ? `${total} waiting.` : 'Nothing waiting.'}
      </p>
      {queue.length > 0 && (
        <ol className="m-0 list-none border-t p-0 text-[13px]">
          {queue.map((offer) => (
            <li key={`${offer.src}\n${offer.id}`} className="flex flex-wrap gap-x-2.5 border-b py-1.5">
              <span className="text-muted-foreground tabular-nums">{zone.formatDateTime(offer.queuedAt)}</span>
              <a
                href={offer.url}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline-offset-4 hover:underline"
              >
                {offer.title}
              </a>
              <span className="text-muted-foreground">{[offer.company, offer.src].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ol>
      )}
      {total > queue.length && (
        <p className="my-1.5 text-xs text-muted-foreground">…and {total - queue.length} more.</p>
      )}
    </>
  );
}
