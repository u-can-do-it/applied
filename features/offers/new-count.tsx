import type { RunWindow } from '@/lib/db/repos/offers';
import type { Zone } from '@/lib/dates';
import { withParams } from '@/lib/shared/search-params';
import { NavLink } from './nav';

/**
 * The count line's " · 5 new in the last run", which shows only those (?new=1, where a push
 * notification leads), and with them on, when that run was and a way back to the whole list.
 */
export function NewCount({
  newCount,
  latest,
  active,
  zone,
  current,
  path,
}: {
  /** how many of the list the latest run that brought new jobs brought */
  newCount: number;
  latest: RunWindow | null;
  /** ?new=1 */
  active: boolean;
  zone: Zone;
  current: URLSearchParams;
  path: string;
}) {
  if (active) {
    const when = latest
      ? zone.day(latest.finishedAt) === zone.day()
        ? zone.formatTime(latest.finishedAt)
        : zone.formatDateTime(latest.finishedAt)
      : null;
    return (
      <>
        {' · '}
        {when ? `new in the run of ${when}` : 'new'}
        {' · '}
        <NavLink href={withParams(current, { new: null }, path)}>show all</NavLink>
      </>
    );
  }
  if (!newCount) return null;
  return (
    <>
      {' · '}
      <NavLink href={withParams(current, { new: '1' }, path)}>
        {newCount.toLocaleString('en-GB')} new in the last run
      </NavLink>
    </>
  );
}

/**
 * The count line's " · 3 archived", which lists only the archived jobs (?archived=1), and there a way
 * back to the others.
 */
export function ArchivedCount({
  archivedCount,
  active,
  current,
  path,
}: {
  /** how many jobs these filters find among the archived ones */
  archivedCount: number;
  /** ?archived=1 */
  active: boolean;
  current: URLSearchParams;
  path: string;
}) {
  if (!active && !archivedCount) return null;
  return (
    <>
      {' · '}
      <NavLink href={withParams(current, { archived: active ? null : '1' }, path)}>
        {active ? 'back to the list' : `${archivedCount.toLocaleString('en-GB')} archived`}
      </NavLink>
    </>
  );
}
