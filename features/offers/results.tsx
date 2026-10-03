import { ArrowLeftIcon, ArrowRightIcon, SparklesIcon } from 'lucide-react';
import { rangeStats } from '@/lib/ai/runs';
import { addDays, DEFAULT_TZ, describeRange, zoneOf, type Zone } from '@/lib/dates';
import { getJobs, getTotalCount, PAGE_SIZE, type ListedJob } from '@/lib/jobs';
import { isUsable, listProfiles } from '@/lib/ai/profiles';
import { labelsOf, type BoardOption } from '@/lib/listings/board-filter';
import { message } from '@/lib/shared/errors';
import { parseOfferQuery, type SearchParams } from '@/lib/shared/search-params';
import { withParams } from '@/lib/shared/search-params';
import { appZone } from '@/lib/time-zone';
import { LoadError } from '@/components/load-error';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ApplyButton } from './apply-button';
import { FitScore } from './fit-score';
import { NavLink } from './nav';

// days and times in the app's time zone
const dayLabel = (zone: Zone, at: string) => `${zone.weekday(at)} ${zone.formatDayOf(at)}`; // "Thu 02.10.2026"
const fullLabel = (zone: Zone, at: string) => `${dayLabel(zone, at)}, ${zone.formatTime(at)}`; // "Thu 02.10.2026, 14:05"

const fmt = (count: number) => count.toLocaleString('en-GB');

// shared with the skeleton, so the rows don't move when the list comes in
const COUNT =
  'mt-1 mb-0 min-h-[19px] text-[13px] text-muted-foreground tabular-nums [&_a]:text-brand [&_a]:no-underline [&_strong]:font-semibold [&_strong]:text-foreground';
const DAY_HEADING =
  'sticky top-0 z-1 mt-6 mb-0 bg-background py-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase';
// no overflow-hidden: it would clip the fit tooltip; the rows have no background of their own
const DAY_LIST = 'm-0 list-none divide-y rounded-[10px] border bg-card p-0';
const OFFER = 'grid grid-cols-[44px_1fr_auto] items-start gap-3 px-3.5 py-3 max-[560px]:grid-cols-[1fr_auto]';
const EMPTY = 'mt-8 mb-4 text-center text-muted-foreground';

function groupByDay(jobs: ListedJob[], zone: Zone) {
  const today = zone.day();
  const yesterday = addDays(today, -1);
  const groups: { day: string; label: string; jobs: ListedJob[] }[] = [];
  for (const job of jobs) {
    const day = zone.day(job.firstSeen);
    let group = groups.at(-1);
    if (!group || group.day !== day) {
      const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : dayLabel(zone, job.firstSeen);
      group = { day, label, jobs: [] };
      groups.push(group);
    }
    group.jobs.push(job);
  }
  return groups;
}

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

export async function Results({
  searchParams,
  mode = 'all',
  boards,
}: {
  searchParams: SearchParams;
  mode?: 'all' | 'ai';
  boards: Promise<BoardOption[]>;
}) {
  const path = mode === 'ai' ? '/ai' : '/';
  const query = parseOfferQuery(await searchParams);
  const { q, src, page, days, from, to } = query;
  const rejected = mode === 'ai' && query.rejected;
  const filtered = Boolean(q || src || days || from || to);
  const range = describeRange({ days, from, to });
  // the app's time zone is a setting, so it's read with the rest: a database that's down shows the notice below
  let zone = zoneOf(DEFAULT_TZ);

  // the URL as the list understands it, for the pager links
  const current = new URLSearchParams();
  for (const [param, value] of Object.entries({ q, src, days, from, to, rejected: rejected ? '1' : '' }))
    if (value) current.set(param, value);

  let data: Awaited<ReturnType<typeof getJobs>> | null = null; // stays null only on the AI tab without a profile
  let all: number | null = null; // whole table, only needed when something is filtered
  let stats: { total: number; checked: number; matched: number } | null = null; // AI: this date range
  try {
    zone = await appZone();
    if (mode === 'ai') {
      const profile = (await listProfiles())[0];
      if (isUsable(profile)) {
        [data, stats] = await Promise.all([
          getJobs({
            q,
            src,
            page,
            days,
            from,
            to,
            ai: { profileId: profile.id, version: profile.version, rejected },
          }),
          rangeStats(profile, zone.resolveRange({ days, from, to })),
        ]);
      }
    } else {
      // in parallel: the filtered page and (if filtered) the unfiltered count
      [data, all] = await Promise.all([
        getJobs({ q, src, page, days, from, to }),
        filtered ? getTotalCount().catch(() => null) : Promise.resolve(null),
      ]);
    }
  } catch (error) {
    return <LoadError title="Can’t load offers." detail={message(error)} />;
  }
  if (!data) {
    return (
      <p className={EMPTY}>
        No profile yet. Click <strong>Profile</strong> above, describe what you&apos;re looking for and add your CV.
      </p>
    );
  }

  const pages = Math.ceil(data.total / PAGE_SIZE);
  const unchecked = stats ? stats.total - stats.checked : 0;
  const labels = labelsOf(await boards); // fetched alongside, usually in by now

  return (
    <>
      {mode === 'ai' && stats ? (
        <p className={COUNT}>
          {/* "9 match of 14 checked · 6 not checked yet · today · show 5 rejected" */}
          <strong>{fmt(stats.matched)}</strong> match of {fmt(stats.checked)} checked
          {unchecked > 0 && <span className="text-warning"> · {fmt(unchecked)} not checked yet</span>}
          {range && ` · ${range}`}
          {(q || src) && <> · {fmt(data.total)} shown</>}
          {' · '}
          <NavLink href={withParams(current, { rejected: rejected ? null : '1' }, path)}>
            {rejected ? 'show matches' : `show ${fmt(stats.checked - stats.matched)} rejected`}
          </NavLink>
        </p>
      ) : (
        <p className={COUNT}>
          {/* "42 of 1,279 offers · last 7 days" when filtered, "1,279 offers" otherwise */}
          <strong>{fmt(data.total)}</strong>
          {filtered && all !== null && <> of {fmt(all)}</>} offers
          {range && ` · ${range}`}
        </p>
      )}

      {data.jobs.length === 0 && (
        <p className={EMPTY}>
          {mode === 'ai'
            ? stats && stats.checked === 0
              ? `Nothing ${range ? `from ${range} ` : ''}has been checked with this profile yet. Use the buttons above.`
              : rejected
                ? 'Nothing was rejected here.'
                : 'No matches here. Check the rejected ones, or loosen the profile.'
            : filtered
              ? 'Nothing matches these filters.'
              : 'No offers yet. Use “Scrape now” at the top, or wait for the next scheduled run.'}
        </p>
      )}

      {groupByDay(data.jobs, zone).map((group) => (
        <section key={group.day}>
          <h2 className={DAY_HEADING}>{group.label}</h2>
          <ol className={DAY_LIST}>
            {group.jobs.map((job) => (
              <li key={job.src + ':' + job.id} className={OFFER}>
                <time
                  dateTime={job.firstSeen}
                  title={fullLabel(zone, job.firstSeen)}
                  className="pt-px text-[13px] text-muted-foreground tabular-nums max-[560px]:col-span-full max-[560px]:p-0"
                >
                  {zone.formatTime(job.firstSeen)}
                </time>
                <div className="min-w-0">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold no-underline [overflow-wrap:anywhere] visited:text-muted-foreground hover:text-brand hover:underline hover:underline-offset-2"
                  >
                    {job.title}
                  </a>
                  <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']">
                    {job.company && <span>{job.company}</span>}
                    {job.seniority && job.seniority !== 'unknown' && <span>{job.seniority}</span>}
                    <span className={job.remote ? 'text-success' : undefined}>
                      {job.remote ? 'Remote' : 'Office / hybrid'}
                    </span>
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
                      score={job.ai.score}
                      summary={job.ai.summary}
                      checks={job.ai.checks}
                      hadDescription={job.ai.hadDescription}
                    />
                  )}
                  <BoardLinks job={job} labels={labels} />
                  <ApplyButton jobId={job.jobId} src={job.src} id={job.id} appliedAt={job.appliedAt} tz={zone.tz} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {pages > 1 && (
        <nav
          className="mt-6 flex items-center justify-between text-sm text-muted-foreground [&_a]:text-brand [&_a]:no-underline"
          aria-label="Pages"
        >
          {page > 0 ? (
            <NavLink href={withParams(current, { page: page - 1 }, path)} scrollTop>
              <ArrowLeftIcon /> Newer
            </NavLink>
          ) : (
            <span />
          )}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <NavLink href={withParams(current, { page: page + 1 }, path)} scrollTop>
              Older <ArrowRightIcon />
            </NavLink>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

export function ResultsSkeleton() {
  // shown at once while the database answers, and visible after 150 ms, so a fast load doesn't flash it
  return (
    <div className="animate-appear-late" aria-busy="true" aria-label="Loading offers">
      <div className={COUNT}>
        <Skeleton className="inline-block h-[11px] w-[90px] rounded-sm" />
      </div>
      <div className={DAY_HEADING}>
        <Skeleton className="inline-block h-[11px] w-[70px] rounded-sm" />
      </div>
      <ol className={DAY_LIST}>
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className={OFFER}>
            <Skeleton className="h-[11px] w-9 rounded-sm" />
            <div className="min-w-0">
              <Skeleton className="h-3.5 rounded-sm" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
              <Skeleton className="mt-2 h-[11px] rounded-sm" style={{ width: `${25 + ((i * 11) % 20)}%` }} />
            </div>
            <Skeleton className="h-[11px] w-14 rounded-sm" />
          </li>
        ))}
      </ol>
    </div>
  );
}
