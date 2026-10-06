import Link from 'next/link';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { rangeStats } from '@/lib/ai/runs';
import { DEFAULT_TZ, describeRange, zoneOf } from '@/lib/dates';
import { getJobs, getTotalCount, PAGE_SIZE } from '@/lib/jobs';
import { isUsable, listProfiles } from '@/lib/ai/profiles';
import { labelsOf, type BoardOption } from '@/lib/listings/board-filter';
import { message } from '@/lib/shared/errors';
import { parseOfferQuery, type SearchParams } from '@/lib/shared/search-params';
import { withParams } from '@/lib/shared/search-params';
import { appZone } from '@/lib/time-zone';
import { DAY_HEADING, DAY_LIST, groupByDay } from '@/components/day-groups';
import { LoadError } from '@/components/load-error';
import { Skeleton } from '@/components/ui/skeleton';
import { NavLink } from './nav';
import { OFFER, OfferRow } from './offer-row';
import { ArchivedCount, NewCount } from './new-count';

const fmt = (count: number) => count.toLocaleString('en-GB');

// shared with the skeleton, so the rows don't move when the list comes in
const COUNT =
  'mt-1 mb-0 min-h-[19px] text-[13px] text-muted-foreground tabular-nums [&_a]:text-brand [&_a]:no-underline [&_strong]:font-semibold [&_strong]:text-foreground';
const EMPTY = 'mt-8 mb-4 text-center text-muted-foreground';

export async function Results({
  searchParams,
  boards,
}: {
  searchParams: SearchParams;
  boards: Promise<BoardOption[]>;
}) {
  const path = '/';
  const { q, src, page, days, from, to, latest, archived, fit } = parseOfferQuery(await searchParams);
  const filtered = Boolean(q || src || days || from || to || latest);
  const range = describeRange({ days, from, to });
  // the app's time zone is a setting, so it's read with the rest: a database that's down shows the notice below
  let zone = zoneOf(DEFAULT_TZ);

  // the URL as the list understands it, for the pager links
  const current = new URLSearchParams();
  const params = { q, src, days, from, to, fit, new: latest ? '1' : '', archived: archived ? '1' : '' };
  for (const [param, value] of Object.entries(params)) if (value) current.set(param, value);

  let data: Awaited<ReturnType<typeof getJobs>> | null = null; // stays null only with ?fit= and no profile
  let all: number | null = null; // whole table, only needed when something is filtered
  let stats: { total: number; checked: number; matched: number } | null = null; // ?fit=: this date range
  try {
    let profiles: Awaited<ReturnType<typeof listProfiles>>;
    [zone, profiles] = await Promise.all([appZone(), listProfiles()]); // the fit badges are the active profile's
    const profile = profiles.at(0);
    const query = { q, src, page, days, from, to, latest, archived };
    if (fit) {
      // only the jobs the active profile judged, matches or rejected
      if (isUsable(profile)) {
        const ai = { profileId: profile.id, version: profile.version, rejected: fit === 'rejected' };
        [data, stats] = await Promise.all([
          getJobs({ ...query, ai }),
          rangeStats(profile, zone.resolveRange({ days, from, to })),
        ]);
      }
    } else {
      // every job, the judged ones with their fit badge; in parallel, (if filtered) the unfiltered count
      const verdictsOf = profile && { profileId: profile.id, version: profile.version };
      [data, all] = await Promise.all([
        getJobs({ ...query, verdictsOf }),
        filtered ? getTotalCount().catch(() => null) : Promise.resolve(null),
      ]);
    }
  } catch (error) {
    return <LoadError title="Can’t load offers." detail={message(error)} />;
  }
  if (!data) {
    return (
      <p className={EMPTY}>
        No AI profile yet. Set one up in <SettingsLink />: describe what you&apos;re looking for and add your CV.
      </p>
    );
  }

  const pages = Math.ceil(data.total / PAGE_SIZE);
  const unchecked = stats ? stats.total - stats.checked : 0;
  const labels = labelsOf(await boards); // fetched alongside, usually in by now
  const newLine = (
    <NewCount newCount={data.newCount} latest={data.latest} active={latest} zone={zone} current={current} path={path} />
  );
  const archivedLine = (
    <ArchivedCount archivedCount={data.archivedCount} active={archived} current={current} path={path} />
  );

  return (
    <>
      {archived ? (
        <p className={COUNT}>
          {/* "3 archived offers · last 7 days · show all" */}
          <strong>{fmt(data.total)}</strong> archived {data.total === 1 ? 'offer' : 'offers'}
          {range && ` · ${range}`}
          {newLine}
          {archivedLine}
        </p>
      ) : stats ? (
        <p className={COUNT}>
          {/* "9 match of 14 checked · 6 not checked yet · today" */}
          <strong>{fmt(fit === 'rejected' ? stats.checked - stats.matched : stats.matched)}</strong>{' '}
          {fit === 'rejected' ? 'rejected' : 'match'} of {fmt(stats.checked)} checked
          {unchecked > 0 && <span className="text-warning"> · {fmt(unchecked)} not checked yet</span>}
          {range && ` · ${range}`}
          {(q || src || latest) && <> · {fmt(data.total)} shown</>}
          {newLine}
          {archivedLine}
        </p>
      ) : (
        <p className={COUNT}>
          {/* "42 of 1,279 offers · last 7 days" when filtered, "1,279 offers" otherwise */}
          <strong>{fmt(data.total)}</strong>
          {filtered && all !== null && <> of {fmt(all)}</>} offers
          {range && ` · ${range}`}
          {newLine}
          {archivedLine}
        </p>
      )}

      {data.jobs.length === 0 && (
        <p className={EMPTY}>
          {archived ? (
            filtered ? (
              'No archived offers match these filters.'
            ) : (
              'Nothing archived. The archive button on an offer moves it here.'
            )
          ) : stats ? (
            stats.checked === 0 ? (
              <>
                Nothing {range ? `from ${range} ` : ''}has been checked with this profile yet: <SettingsLink /> checks
                them.
              </>
            ) : fit === 'rejected' ? (
              'Nothing was rejected here.'
            ) : (
              'No matches here. See the rejected ones, or loosen the profile in Settings.'
            )
          ) : latest && !data.latest ? (
            'No scrape run has brought new offers lately.'
          ) : filtered ? (
            'Nothing matches these filters.'
          ) : (
            'No offers yet. Use “Scrape now” at the top, or wait for the next scheduled run.'
          )}
        </p>
      )}

      {groupByDay(data.jobs, (job) => job.firstSeen, zone).map((group) => (
        <section key={group.day}>
          <h2 className={DAY_HEADING}>{group.label}</h2>
          <ol className={DAY_LIST}>
            {group.items.map((job) => (
              <OfferRow key={job.src + ':' + job.id} job={job} zone={zone} labels={labels} />
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

/** Where the AI profile and its runs are. */
function SettingsLink() {
  return (
    <Link href="/settings#ai-filter" className="text-brand no-underline hover:underline">
      Settings → AI filter
    </Link>
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
