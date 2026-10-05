'use client';

import { useMemo, useRef, useState } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import type { Application } from '@/lib/applications';
import { cn } from '@/lib/shared/cn';
import { searchBox, searchInput } from '@/components/search-field';
import { TimeZone } from '@/components/time-zone';
import { useRefreshWhile } from '@/components/use-refresh-while';
import { Button } from '@/components/ui/button';
import { AddApplication } from './add-application';
import { AppliedStats, type Filter } from './applied-stats';
import { ApplicationRow } from './application-row';
import { ApplicationSheet, type SheetHandle } from './application-sheet';

// The Applied tab: statistics, the list, and one application's window.

/** a note saved in the window, and its note_updated_at once the database answered */
type NoteOverlay = { note: string | null; at?: string | null };
/** the database's note is newer than the one saved here (changed elsewhere since): the list shows that one */
const newer = (database: string | null, saved: string | null | undefined) =>
  Boolean(database && saved && Date.parse(database) > Date.parse(saved));

/** tz: the app's time zone, for every day shown here and in the windows */
export function AppliedList({ tz, ...props }: { apps: Application[]; labels: Record<string, string>; tz: string }) {
  return (
    <TimeZone tz={tz}>
      <List {...props} />
    </TimeZone>
  );
}

function List({ apps: fromServer, labels }: { apps: Application[]; labels: Record<string, string> }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(null);
  const [open, setOpen] = useState<Application | null>(null); // the window shows this one
  const [switched, setSwitched] = useState(false); // …in place of another one
  const sheet = useRef<SheetHandle>(null);
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

  // ad texts are scraped in the background right after marking: refresh until they're in
  useRefreshWhile(pending, 3000, fromServer);

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return apps.filter(
      (app) =>
        (!filter || filter.test(app)) &&
        words.every((word) => `${app.title} ${app.company ?? ''} ${app.note ?? ''}`.toLowerCase().includes(word)),
    );
  }, [apps, search, filter]);

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
      <AppliedStats apps={apps} filter={filter} setFilter={setFilter} />

      <div className="flex items-stretch gap-2 max-[560px]:flex-col">
        <div className={cn(searchBox, 'flex-1')}>
          <SearchIcon className="size-4.5" />
          <input
            type="search"
            className={searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, company or note…"
            aria-label="Search applied offers"
          />
        </div>
        <AddApplication />
      </div>
      <p className="mt-1 mb-0 min-h-[19px] text-[13px] text-muted-foreground tabular-nums">
        <strong className="font-semibold text-foreground">{shown.length}</strong>
        {shown.length !== apps.length && <> of {apps.length}</>} applied
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
      <ol data-application-list className="mt-3 mb-0 list-none divide-y rounded-[10px] border bg-card p-0">
        {shown.map((app) => (
          <li key={app.jobId}>
            <ApplicationRow
              app={app}
              labels={labels}
              active={open?.jobId === app.jobId}
              onOpen={() => void show(app)}
            />
          </li>
        ))}
      </ol>

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
