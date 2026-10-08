import { SparklesIcon } from 'lucide-react';
import type { Zone } from '@/lib/dates';
import type { ListedJob } from '@/lib/jobs';
import { cn } from '@/lib/shared/cn';
import { Marked } from '@/components/marked';
import { Badge } from '@/components/ui/badge';
import { ApplyButton } from './apply-button';
import { ArchiveButton, ArchiveRow } from './archive';
import { FitScore } from './fit-score';
import { SeenItem, SeenMark } from './seen';

// shared with the skeleton, so the rows don't move when the list comes in
export const OFFER = 'grid grid-cols-[44px_1fr_auto] items-start gap-3 px-3.5 py-3 max-[560px]:grid-cols-[1fr_auto]';

/** "Thu 02.10.2026, 14:05", in the app's time zone */
const fullLabel = (zone: Zone, at: string) => `${zone.weekday(at)} ${zone.formatDayOf(at)}, ${zone.formatTime(at)}`;

/** The boards this job was posted on, one link each (earliest first). */
function BoardLinks({ job, labels }: { job: ListedJob; labels: Record<string, string> }) {
  const seen = new Set<string>();
  const links = job.offers.filter((offer) => !seen.has(offer.src) && seen.add(offer.src));
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {links.map((offer) => (
        <Badge key={offer.src} variant="quiet" className="rounded-md no-underline" asChild>
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open on ${labels[offer.src] ?? offer.src}`}
          >
            {labels[offer.src] ?? offer.src}
          </a>
        </Badge>
      ))}
    </span>
  );
}

/**
 * One job in the list. A job the latest scrape run that brought new jobs brought is marked "new", with a
 * faint tint, so what came in last time stands out; one you opened before has a check mark after its title.
 * The archive button takes it out of the list (or, in the archived list, back into the others). With a
 * mouse, the archive and "Mark applied" buttons show on the row's hover (or keyboard focus) only. A job
 * the active profile judged has its fit badge, and the verdict's line under its title. A search's
 * words are marked in yellow in the title and the company. Under a day's heading the row shows the hour it
 * came in; in a list not grouped by day (a search's), its day instead: "Today", "Yesterday", "Tue" earlier
 * this week, "02/10" before, in a wider first column.
 */
export function OfferRow({
  job,
  zone,
  labels,
  dated = false,
}: {
  job: ListedJob;
  zone: Zone;
  labels: Record<string, string>;
  dated?: boolean;
}) {
  return (
    <ArchiveRow jobId={job.jobId} title={job.title} archived={job.archived}>
      <SeenItem
        jobId={job.jobId}
        seen={job.seen}
        className={cn(
          OFFER,
          dated && 'grid-cols-[68px_1fr_auto]',
          'group/offer',
          job.isNew && 'bg-success-soft/40 first:rounded-t-[10px] last:rounded-b-[10px]',
        )}
        data-new={job.isNew || undefined}
      >
        <time
          dateTime={job.firstSeen}
          title={fullLabel(zone, job.firstSeen)}
          className="pt-px text-[13px] text-muted-foreground tabular-nums max-[560px]:col-span-full max-[560px]:p-0"
        >
          {dated ? zone.shortDay(job.firstSeen) : zone.formatTime(job.firstSeen)}
        </time>
        <div className="min-w-0">
          {job.isNew && (
            <Badge variant="success" className="mr-1.5 align-[1px]" title="Brought by the latest scrape run">
              new
            </Badge>
          )}
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold no-underline [overflow-wrap:anywhere] visited:text-muted-foreground hover:text-brand hover:underline hover:underline-offset-2"
          >
            <Marked text={job.title} marks={job.marks?.title} />
          </a>
          <SeenMark />
          <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']">
            {job.company && (
              <span>
                <Marked text={job.company} marks={job.marks?.company} />
              </span>
            )}
            {job.seniority && job.seniority !== 'unknown' && <span>{job.seniority}</span>}
            <span className={job.remote ? 'text-success' : undefined}>{job.remote ? 'Remote' : 'Office / hybrid'}</span>
          </div>
          {job.ai?.summary && (
            <p className="mt-1 mb-0 text-xs text-brand">
              <SparklesIcon /> {job.ai.summary}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {job.ai && (
            <FitScore
              match={job.ai.match}
              score={job.ai.score}
              summary={job.ai.summary}
              checks={job.ai.checks}
              hadDescription={job.ai.hadDescription}
            />
          )}
          <BoardLinks job={job} labels={labels} />
          <div className="flex flex-wrap items-center justify-end gap-1">
            <ArchiveButton />
            <ApplyButton jobId={job.jobId} src={job.src} id={job.id} appliedAt={job.appliedAt} tz={zone.tz} />
          </div>
        </div>
      </SeenItem>
    </ArchiveRow>
  );
}
