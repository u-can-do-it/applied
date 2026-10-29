'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import type { Application, ListedApplication } from '@/lib/applications';
import { cn } from '@/lib/shared/cn';
import { companyKeyOf } from '@/lib/shared/company-key';
import { adsWords } from '@/lib/ads/details';
import { rank, snippetOf } from '@/lib/shared/search';
import { DateRangePicker } from '@/components/date-range-picker';
import { DAY_COUNT, DAY_HEADING, DAY_LIST, groupByDay } from '@/components/day-groups';
import { EverythingToggle, searchBox, searchInput, searchPlaceholder } from '@/components/search-field';
import { TimeZone, useZone } from '@/components/time-zone';
import { useRefreshWhile } from '@/components/use-refresh-while';
import { Button } from '@/components/ui/button';
import { AddApplication } from './add-application';
import { AppliedStats } from './applied-stats';
import { ApplicationRow } from './application-row';
import { ApplicationSheet, type SheetHandle } from './application-sheet';
import { useAdTexts } from './use-ad-texts';
import { applicationQuery } from './use-application';
import { useAppliedQuery } from './use-applied-query';

// The Applied tab: the search, statistics, the list (by the day you applied, like the offer lists), and
// one application's window.

/** a note saved in the window, and its note_updated_at once the database answered */
type NoteOverlay = { note: string | null; at?: string | null };
/** the database's note is newer than the one saved here (changed elsewhere since): the list shows that one */
const newer = (database: string | null, saved: string | null | undefined) =>
  Boolean(database && saved && Date.parse(database) > Date.parse(saved));

/** tz: the app's time zone, for every day shown here and in the windows */
export function AppliedList({
  tz,
  ...props
}: {
  apps: ListedApplication[];
  labels: Record<string, string>;
  tz: string;
}) {
  return (
    <TimeZone tz={tz}>
      <List {...props} />
    </TimeZone>
  );
}

function List({ apps: fromServer, labels }: { apps: ListedApplication[]; labels: Record<string, string> }) {
  const zone = useZone();
  const { search, setSearch, searchAll, everything, setEverything, filter, setFilter, range, setRange } =
    useAppliedQuery(); // in the URL
  const adTexts = useAdTexts(everything); // the list has none: loaded when the search reads everything
  const [open, setOpen] = useState<Application | null>(null); // the window shows this one
  const [switched, setSwitched] = useState(false); // …in place of another one
  const sheet = useRef<SheetHandle>(null);
  // Next keeps this page as you left it while you're on another tab (cacheComponents' <Activity>): Back
  // brings the window back with it, but coming here by a link (the Applied tab) shows the list, closed.
  // bfcacheId changes on a link, not on Back / Forward. Its note was saved as the page was left (useAutosave).
  const { bfcacheId } = useRouter();
  const [visit, setVisit] = useState(bfcacheId);
  if (visit !== bfcacheId) {
    setVisit(bfcacheId);
    setOpen(null);
  }
  const pending = fromServer.some((app) => app.contentStatus === 'pending');

  // notes written in the window show in the list at once, with when the database took them (the
  // window sends that back with the next save); the next refresh brings them from the database.
  // By job id.
  const [notes, setNotes] = useState<Partial<Record<string, NoteOverlay>>>({});
  const apps = useMemo(
    () =>
      fromServer.map((app) => {
        const mine = notes[app.jobId];
        return mine
          ? { ...app, note: mine.note, noteUpdatedAt: mine.at === undefined ? app.noteUpdatedAt : mine.at }
          : app;
      }),
    [fromServer, notes],
  );
  // a new list from the server: keep only what the database doesn't have yet (and nothing for offers
  // no longer applied). Adjusted while rendering, not in an effect, so there's no extra render.
  const [notesOf, setNotesOf] = useState(fromServer);
  if (notesOf !== fromServer) {
    setNotesOf(fromServer);
    setNotes((cur) => {
      const left = Object.fromEntries(
        Object.entries(cur).filter(
          ([jobId, overlay]) =>
            overlay &&
            fromServer.some(
              (app) => app.jobId === jobId && app.note !== overlay.note && !newer(app.noteUpdatedAt, overlay.at),
            ),
        ),
      );
      return Object.keys(left).length === Object.keys(cur).length ? cur : left;
    });
  }

  // the note as the window left it, in the list at once (unless the database has a newer one)
  const keepNote = (jobId: string, note: string | null | undefined, before: string | null) => {
    if (note !== undefined && note !== before) setNotes((cur) => ({ ...cur, [jobId]: { note, at: cur[jobId]?.at } }));
  };

  // a click on an application: its window, or the open window shows it instead (once the one there lets go)
  const show = async (app: Application) => {
    if (open?.jobId === app.jobId) return;
    if (open) {
      const left = await sheet.current?.leave();
      if (left === null) return; // stays: an edit under way
      if (left) keepNote(left.jobId, left.note, open.note);
    }
    setSwitched(Boolean(open));
    setOpen(app);
  };

  // pointing at an application: its ad text and verdict on the way before the click (the window shows the
  // list's copy until they're in, and checks again as it opens). Not the open one's: that window has it.
  const queryClient = useQueryClient();
  const prefetch = (jobId: string) => {
    if (open?.jobId === jobId) return;
    void queryClient.query(applicationQuery(jobId)).catch(() => {}); // a failure shows in the window
  };

  // ad texts are scraped in the background right after marking: refresh until they're in
  useRefreshWhile(pending, 3000, fromServer);

  // your applications per company, all of them whatever the filters, the latest first: the company's hover lists them
  const atCompany = useMemo(() => {
    const byCompany = new Map<string, Application[]>();
    for (const app of apps.toSorted((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt))) {
      const key = companyKeyOf(app.jobId);
      if (key) byCompany.set(key, [...(byCompany.get(key) ?? []), app]);
    }
    return byCompany;
  }, [apps]);
  const appliedAtCompany = (app: Application) =>
    atCompany.get(companyKeyOf(app.jobId))?.map((there) => ({
      title: there.title,
      day: zone.formatDayOf(there.appliedAt),
      self: there.jobId === app.jobId,
    }));

  // the ones you applied for in the dates: the statistics count these, the list shows them
  const inRange = useMemo(() => (range ? apps.filter(range.test) : apps), [apps, range]);

  // the search is the offers' (lib/shared/search.ts), its words marked in the rows; the list stays by day.
  // Searching everything, the ad too (its details, and its text once loaded), and where it matched there
  // (the row shows the note itself)
  const texts = adTexts.data;
  const { shown, marks, snippets } = useMemo(() => {
    const filtered = filter ? inRange.filter((app) => filter.test(app)) : inRange;
    const searched = everything
      ? filtered.map((app) => ({ ...app, more: adsWords([{ details: app.details, text: texts?.get(app.jobId) }]) }))
      : filtered;
    const found = search.trim() ? rank(searched, search) : null;
    if (!found) return { shown: filtered, marks: undefined, snippets: undefined };
    const ids = new Set(found.ids);
    const snippets = new Map(
      searched.flatMap((app) => {
        const snippet = everything && snippetOf({ ...app, note: null }, found.marks.get(app.jobId));
        return snippet ? [[app.jobId, snippet] as const] : [];
      }),
    );
    return { shown: filtered.filter((app) => ids.has(app.jobId)), marks: found.marks, snippets };
  }, [inRange, search, filter, everything, texts]);

  if (!apps.length) {
    return (
      <div className="mt-8 text-center text-muted-foreground">
        <p className="mb-2">
          Nothing here yet. Use <strong>Mark applied</strong> on an offer: it shows up here with its complete ad text.
          Or add one you sent elsewhere:
        </p>
        <AddApplication />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2.5 flex items-stretch gap-2 max-[560px]:flex-col">
        <div className={cn(searchBox, 'flex-1')}>
          <SearchIcon className="size-4.5" />
          <input
            type="search"
            className={searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder(everything, true)}
            aria-label="Search applied offers"
          />
          <EverythingToggle checked={everything} onChange={setEverything} />
        </div>
        <AddApplication />
      </div>
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground">
        <DateRangePicker
          label="Applied"
          from={range?.from ?? ''}
          to={range?.to ?? ''}
          highlighted={Boolean(range)}
          onCommit={setRange}
        />
        {range && (
          <Button
            type="button"
            variant="link"
            size="icon-xs"
            onClick={() => setRange({ from: '', to: '' })}
            aria-label="Clear date range"
          >
            <XIcon />
          </Button>
        )}
      </div>

      <AppliedStats apps={inRange} filter={filter?.id ?? null} setFilter={setFilter} />

      <p className="mt-1 mb-0 min-h-[19px] text-[13px] text-muted-foreground tabular-nums">
        <strong className="font-semibold text-foreground">{shown.length}</strong>
        {shown.length !== apps.length && <> of {apps.length}</>} applied
        {everything && search.trim() && adTexts.isPending && ' · reading the ads…'}
        {everything && search.trim() && adTexts.isError && (
          <span className="text-destructive"> · the ads’ text didn’t load: searched without it</span>
        )}
        {filter && (
          <>
            {' · '}
            {filter.label}{' '}
            <Button
              type="button"
              variant="link"
              size="icon-xs"
              onClick={() => setFilter(null)}
              aria-label="Clear the filter"
            >
              <XIcon />
            </Button>
          </>
        )}
      </p>

      {/* a click in it doesn't close the window (application-sheet.tsx): it shows another application */}
      <div data-application-list>
        {groupByDay(shown, (app) => app.appliedAt, zone).map((group) => (
          <section key={group.day}>
            <h2 className={DAY_HEADING}>
              {group.label}
              <span className={DAY_COUNT}>
                {group.items.length}
                <span className="sr-only"> applied</span>
              </span>
            </h2>
            <ol className={DAY_LIST}>
              {group.items.map((app) => (
                <li key={app.jobId}>
                  <ApplicationRow
                    app={app}
                    labels={labels}
                    marks={marks?.get(app.jobId)}
                    snippet={snippets?.get(app.jobId)}
                    active={open?.jobId === app.jobId}
                    onOpen={() => void show(app)}
                    onPrefetch={() => prefetch(app.jobId)}
                    onCompany={searchAll}
                    companyApplied={appliedAtCompany(app)}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {open && (
        <ApplicationSheet
          ref={sheet}
          key={open.jobId}
          initial={open}
          labels={labels}
          switched={switched}
          onClose={(note, jobId) => {
            setOpen(null);
            keepNote(jobId, note, open.note);
          }}
          onNoteSaved={(jobId, note, at) => setNotes((cur) => ({ ...cur, [jobId]: { note, at } }))}
          // changed elsewhere: what the window saved before is outdated, the list shows the database's
          onNoteStale={(jobId) => setNotes((cur) => ({ ...cur, [jobId]: undefined }))}
        />
      )}
    </>
  );
}
