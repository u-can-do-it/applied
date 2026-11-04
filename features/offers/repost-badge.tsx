'use client';

import { Repeat2Icon } from 'lucide-react';
import { zoneOf } from '@/lib/dates';
import type { RepostOf } from '@/lib/db/repos/reposts';
import { Badge } from '@/components/ui/badge';
import { JobWindow } from './offer-window-button';

// A repost's badge, on either tab: the job was posted before, 30+ days earlier (lib/db/repos/reposts.ts). A
// click opens that earlier job's window, the application's if you applied to it (then the badge is the
// brand's colour: you've been there). A button, so the row neither opens its own window nor counts as seen.

/** "Repost of “Middle Full-Stack Developer”, first seen Fri 25.09.2026; you applied on 02.10.2026" */
export function repostTitle(of: Pick<RepostOf, 'title' | 'firstSeen' | 'appliedAt'>, tz: string): string {
  const zone = zoneOf(tz);
  const applied = of.appliedAt ? `; you applied on ${zone.formatDayOf(of.appliedAt)}` : '';
  return `Repost of “${of.title}”, first seen ${zone.weekday(of.firstSeen)} ${zone.formatDayOf(of.firstSeen)}${applied}. A click opens it.`;
}

export function RepostBadge({ of, labels, tz }: { of: RepostOf; labels: Record<string, string>; tz: string }) {
  const { jobId, src, id, title, company, url, firstSeen } = of;
  return (
    // the earlier job's window is this row's in React's tree: its clicks (a link in it) aren't the row's
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <JobWindow
        job={{ jobId, src, id, title, company, url, firstSeen }}
        labels={labels}
        tz={tz}
        applied={Boolean(of.appliedAt)}
        trigger={({ onClick, onPrefetch, busy }) => (
          <Badge variant={of.appliedAt ? 'brand' : 'quiet'} className="cursor-pointer" asChild>
            <button
              type="button"
              onClick={onClick}
              onPointerEnter={onPrefetch}
              onFocus={onPrefetch}
              aria-busy={busy || undefined}
              aria-haspopup="dialog"
              title={repostTitle(of, tz)}
            >
              <Repeat2Icon aria-hidden />
              repost
            </button>
          </Badge>
        )}
      />
    </span>
  );
}
