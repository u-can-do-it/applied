'use client';

import { Repeat2Icon } from 'lucide-react';
import { zoneOf } from '@/lib/dates';
import type { RepostOf } from '@/lib/db/repos/reposts';
import { isRejected, outcomeHeading, stageOf } from '@/lib/stages';
import { Badge } from '@/components/ui/badge';
import { JobWindow } from './offer-window-button';
import { Hint } from '@/components/hint';

// A repost's badge, on either tab: the job was posted before, 30+ days earlier (lib/db/repos/reposts.ts). A
// click opens that earlier job's window, the application's if you applied to it. Its colour says how that
// application went: the brand's (you've been there), yellow if they went quiet (Ghosted), red if they said no
// (Rejected); its title says so in words. A button, so the row neither opens its own window nor counts as seen.

/** The badge's colour: by how your application to the earlier job went, if you applied. */
export function repostVariant(of: Pick<RepostOf, 'appliedAt' | 'status'>): 'quiet' | 'brand' | 'warning' | 'danger' {
  if (!of.appliedAt) return 'quiet';
  if (of.status && isRejected(of.status)) return 'danger';
  return of.status?.outcome === 'ghosted' ? 'warning' : 'brand';
}

/**
 * ", rejected at Technical interview" (", rejected": a plain no to what you sent); at the Offer, ", the offer was
 * taken back" (OFFER_LABELS); ", ghosted: they went quiet"
 */
function howItWent(status: RepostOf['status']): string {
  if (!status) return '';
  if (isRejected(status)) {
    if (status.stage === 'offer') return ', the offer was taken back';
    return status.stage === 'submitted' ? ', rejected' : `, rejected at ${stageOf(status.stage).label}`;
  }
  return status.outcome === 'ghosted' ? `, ${outcomeHeading('ghosted').toLowerCase()}: they went quiet` : '';
}

/**
 * "Repost of “Middle Full-Stack Developer”, first seen Fri 25.09.2026; you applied on 02.10.2026", and how it
 * ended if they said no (", rejected at Technical interview") or went quiet.
 */
export function repostTitle(of: Pick<RepostOf, 'title' | 'firstSeen' | 'appliedAt' | 'status'>, tz: string): string {
  const zone = zoneOf(tz);
  const applied = of.appliedAt ? `; you applied on ${zone.formatDayOf(of.appliedAt)}${howItWent(of.status)}` : '';
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
          <Hint text={repostTitle(of, tz)}>
            <Badge variant={repostVariant(of)} className="cursor-pointer" asChild>
              <button
                type="button"
                onClick={onClick}
                onPointerEnter={onPrefetch}
                onFocus={onPrefetch}
                aria-busy={busy || undefined}
                aria-haspopup="dialog"
              >
                <Repeat2Icon aria-hidden />
                repost
              </button>
            </Badge>
          </Hint>
        )}
      />
    </span>
  );
}
