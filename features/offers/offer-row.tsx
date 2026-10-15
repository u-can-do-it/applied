import type { Zone } from '@/lib/dates';
import type { ListedJob } from '@/lib/jobs';
import { cn } from '@/lib/shared/cn';
import { Badge } from '@/components/ui/badge';
import { ApplyButton } from './apply-button';
import { ArchiveButton, ArchiveRow } from './archive';
import { JOB_ROW, JobRow } from './job-row';
import { OfferWindowButton } from './offer-window-button';
import { SeenItem, SeenMark } from './seen';

// shared with the skeleton, so the rows don't move when the list comes in
export const OFFER = cn(JOB_ROW, 'grid-cols-[44px_1fr_auto] max-[560px]:grid-cols-[1fr_auto]');

/** "Thu 02.10.2026, 14:05", in the app's time zone */
const fullLabel = (zone: Zone, at: string) => `${zone.weekday(at)} ${zone.formatDayOf(at)}, ${zone.formatTime(at)}`;

/** The boards this job was posted on, each once, with its offer's link (earliest first, aggregators last). */
const boardsOf = (job: ListedJob) => {
  const seen = new Set<string>();
  return job.offers
    .filter((offer) => !seen.has(offer.src) && seen.add(offer.src))
    .map(({ src, url }) => ({ src, url }));
};

/**
 * One job in the offer list, as JobRow shows a job on either tab. A job the latest scrape run that brought
 * new jobs brought is marked "new", with a faint tint, so what came in last time stands out; one you opened
 * before has a check mark after its title, and then the button of its window (the ad, your note, the fit;
 * once applied to, the application's). The archive button takes it out of the list (or, in the archived
 * list, back into the others). With a mouse, the archive and "Mark applied" buttons show on the row's hover
 * (or keyboard focus) only. Under a day's heading the row shows the hour it came in; in a list not grouped
 * by day (a search's), its day instead: "Today", "Yesterday", "Tue" earlier this week, "02/10" before, in
 * a wider first column.
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
        <JobRow
          title={job.title}
          href={job.url}
          company={job.company}
          facts={[
            ...(job.seniority && job.seniority !== 'unknown' ? [{ key: 'seniority', text: job.seniority }] : []),
            job.remote
              ? { key: 'mode', text: 'Remote', className: 'text-success' }
              : { key: 'mode', text: 'Office / hybrid' },
          ]}
          verdict={job.ai}
          rentADev={Boolean(job.ai?.bodyLeasing)}
          marks={job.marks}
          boards={boardsOf(job)}
          labels={labels}
          before={
            job.isNew && (
              <Badge variant="success" className="mr-1.5 align-[1px]" title="Brought by the latest scrape run">
                new
              </Badge>
            )
          }
          after={
            <>
              <SeenMark />
              <OfferWindowButton
                job={{
                  jobId: job.jobId,
                  src: job.src,
                  id: job.id,
                  title: job.title,
                  company: job.company,
                  url: job.url,
                  firstSeen: job.firstSeen,
                  ai: job.ai,
                }}
                labels={labels}
                tz={zone.tz}
                applied={!!job.appliedAt}
              />
            </>
          }
          bottom={
            <div className="flex flex-wrap items-center justify-end gap-1">
              <ArchiveButton />
              <ApplyButton
                jobId={job.jobId}
                src={job.src}
                id={job.id}
                appliedAt={job.appliedAt}
                labels={labels}
                tz={zone.tz}
              />
            </div>
          }
        />
      </SeenItem>
    </ArchiveRow>
  );
}
