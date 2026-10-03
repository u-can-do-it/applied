'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Ref,
} from 'react';
import {
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  NotebookPenIcon,
  PencilIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import type { Application, ApplicationWithContent } from '@/lib/applications';
import { formatDay } from '@/lib/dates';
import {
  GHOST_AFTER_DAYS,
  isActive,
  isRejected,
  reached,
  STAGES,
  OUTCOMES,
  stageOf,
  outcomeHeading,
  outcomeLabel,
  outcomesFor,
  stats,
  type StageId,
  type OutcomeId,
} from '@/lib/stages';
import { message } from '@/lib/shared/errors';
import { NOTE_CONFLICT } from '@/lib/shared/application-messages';
import { unwrap } from '@/lib/shared/result';
import {
  refetchContentAction,
  removeStatusStepAction,
  setApplicationNoteAction,
  setApplicationStatusAction,
  unapplyAction,
} from './actions';
import { useConfirm } from '@/components/confirm';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { searchBox, searchInput } from '@/components/search-field';
import { TimeZone, useZone } from '@/components/time-zone';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/shared/cn';
import { AddApplication, ApplicationForm } from './add-application';

/** "02.10.2026" of an instant, in the app's time zone */
const useDay = () => {
  const zone = useZone();
  return (iso: string | null | undefined) => (iso ? zone.formatDayOf(iso) : '');
};
const facts = (details: Application['details']) =>
  [details?.salary?.split('; ')[0], details?.contract, details?.remote ? 'Remote' : null, details?.location]
    .filter(Boolean)
    .join(' · ');
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

const CONTENT: Record<Application['contentStatus'], string> = {
  pending: 'saving the ad…',
  ok: 'ad saved',
  empty: 'no ad text',
  failed: 'couldn’t fetch the ad',
};
const CONTENT_COLOUR: Record<Application['contentStatus'], string> = {
  pending: 'text-muted-foreground',
  ok: 'text-success',
  empty: 'text-destructive',
  failed: 'text-destructive',
};

// an outcome's colour: its badge, its text in the history, its button when picked
const OUTCOME_BADGE = {
  pending: 'brand',
  passed: 'success',
  failed: 'danger',
  ghosted: 'dashed',
  pool: 'pool',
} as const satisfies Record<OutcomeId, string>;
const OUTCOME_TEXT: Record<OutcomeId, string> = {
  pending: 'text-muted-foreground',
  passed: 'text-success',
  failed: 'text-destructive',
  ghosted: 'text-muted-foreground',
  pool: 'text-pool',
};
const OUTCOME_ON: Record<OutcomeId, string> = {
  pending: 'data-[state=on]:border-brand data-[state=on]:bg-brand data-[state=on]:text-brand-foreground',
  passed: 'data-[state=on]:border-success data-[state=on]:bg-success data-[state=on]:text-success-foreground',
  failed:
    'data-[state=on]:border-destructive data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground',
  ghosted:
    'data-[state=on]:border-muted-foreground data-[state=on]:bg-muted-foreground data-[state=on]:text-background',
  pool: 'data-[state=on]:border-pool data-[state=on]:bg-pool data-[state=on]:text-pool-foreground',
};
/** a chip in the status editor (a stage, an outcome) */
const STEP =
  'h-auto min-w-0 rounded-full border bg-transparent px-2.5 py-1 text-[13px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground';
const META =
  "mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:before:content-['·']";

type Filter = { label: string; test: (app: Application) => boolean } | null;
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
  const router = useRouter();
  const day = useDay();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(null);
  const [open, setOpen] = useState<Application | null>(null); // the window shows this one
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

  // ad texts are scraped in the background right after marking: refresh until they're in
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(timer);
  }, [pending, fromServer, router]);

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

      <ol className="mt-3 mb-0 list-none divide-y rounded-[10px] border bg-card p-0">
        {shown.map((app) => (
          <li key={app.jobId}>
            <button
              type="button"
              className="group/row grid w-full cursor-pointer grid-cols-[84px_1fr_auto] items-start gap-3 px-3.5 py-3 text-left max-[560px]:grid-cols-[1fr_auto]"
              onClick={() => setOpen(app)}
            >
              <time
                dateTime={app.appliedAt}
                className="pt-px text-[13px] text-muted-foreground tabular-nums max-[560px]:col-span-full"
              >
                {day(app.appliedAt)}
              </time>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold [overflow-wrap:anywhere] group-hover/row:text-brand group-hover/row:underline group-hover/row:underline-offset-2">
                  {app.title}
                </span>
                <span className={META}>
                  {app.company && <span>{app.company}</span>}
                  {facts(app.details) && <span>{facts(app.details)}</span>}
                </span>
                {app.note?.trim() && (
                  <span className="mt-[3px] truncate text-[13px] text-muted-foreground">
                    <NotebookPenIcon /> {app.note.trim().split('\n')[0]}
                  </span>
                )}
              </span>
              <span className="flex flex-col items-end gap-1 max-[560px]:max-w-[42vw]">
                <StatusChip stage={app.stage} outcome={app.outcome} />
                <Badge variant="quiet" className="rounded-md">
                  {labels[app.src] ?? app.src}
                </Badge>
                <span className={cn('text-xs whitespace-nowrap', CONTENT_COLOUR[app.contentStatus])}>
                  {app.contentStatus === 'ok' && <FileTextIcon />} {CONTENT[app.contentStatus]}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {open && (
        <AdModal
          key={open.jobId}
          initial={open}
          labels={labels}
          onClose={(note, jobId) => {
            setOpen(null);
            if (note !== undefined && note !== open.note)
              setNotes((cur) => ({ ...cur, [jobId]: { note, at: cur[jobId]?.at } }));
          }}
          onNoteSaved={(jobId, note, at) => setNotes((cur) => ({ ...cur, [jobId]: { note, at } }))}
          // changed elsewhere: what the window saved before is outdated, the list shows the database's
          onNoteStale={(jobId) => setNotes((cur) => ({ ...cur, [jobId]: undefined }))}
        />
      )}
    </>
  );
}

function StatusChip({ stage, outcome }: { stage: StageId; outcome: OutcomeId }) {
  return (
    // a long status ("HR · CV do bazy, ty do dupy") takes two lines on a phone rather than the title's room
    <Badge
      variant={OUTCOME_BADGE[outcome]}
      className="font-normal max-[560px]:h-auto max-[560px]:rounded-[10px] max-[560px]:text-right max-[560px]:whitespace-normal"
    >
      {stageOf(stage).short} · {outcomeLabel(stage, outcome)}
    </Badge>
  );
}

// ---- statistics ----------------------------------------------------------------------

function AppliedStats({
  apps,
  filter,
  setFilter,
}: {
  apps: Application[];
  filter: Filter;
  setFilter: (filter: Filter) => void;
}) {
  const counts = useMemo(() => stats(apps), [apps]);
  const pick = (label: string, test: (app: Application) => boolean) => () =>
    setFilter(filter?.label === label ? null : { label, test });
  const on = (label: string) => (filter?.label === label ? 'true' : undefined);

  const tiles = [
    { label: 'Sent', value: counts.sent, sub: '', test: () => true, tone: '' },
    {
      label: 'Positive replies',
      value: counts.positive,
      sub: pct(counts.positive, counts.sent),
      test: (app: Application) => app.stage !== 'submitted',
      tone: 'good',
    },
    {
      label: 'Offers',
      value: counts.offers,
      sub: pct(counts.offers, counts.sent),
      test: (app: Application) => app.stage === 'offer',
      tone: 'good',
    },
    { label: 'In progress', value: counts.active, sub: '', test: (app: Application) => isActive(app), tone: '' },
    {
      label: 'Rejected',
      value: counts.rejected,
      sub: pct(counts.rejected, counts.sent),
      test: (app: Application) => isRejected(app),
      tone: 'bad',
    },
    {
      label: 'Ghosted',
      value: counts.ghosted,
      sub: pct(counts.ghosted, counts.sent),
      test: (app: Application) => app.outcome === 'ghosted',
      tone: 'bad',
    },
    {
      label: outcomeHeading('pool'),
      value: counts.pool,
      sub: pct(counts.pool, counts.sent),
      test: (app: Application) => app.outcome === 'pool',
      tone: 'bad',
    },
  ];

  return (
    <section className="mb-3.5 flex flex-col gap-2.5" aria-label="Application statistics">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
        {tiles.map((tile) => (
          <Card
            key={tile.label}
            size="sm"
            className="py-0 transition-shadow hover:ring-muted-foreground has-aria-pressed:ring-2 has-aria-pressed:ring-brand"
          >
            <button
              type="button"
              className="flex flex-col items-start px-3 py-2.5 text-left focus-visible:outline-offset-[-2px]"
              aria-pressed={on(tile.label)}
              onClick={tile.label === 'Sent' ? () => setFilter(null) : pick(tile.label, tile.test)}
            >
              <span className="text-[22px] leading-[1.2] font-bold tabular-nums">{tile.value}</span>
              <span className="text-xs text-muted-foreground">{tile.label}</span>
              {tile.sub && (
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    tile.tone === 'good' && 'text-success',
                    tile.tone === 'bad' && 'text-destructive',
                  )}
                >
                  {tile.sub}
                </span>
              )}
            </button>
          </Card>
        ))}
      </div>

      {/* where applications are: each one at the stage of its last status (a stage it was taken back
          from doesn't count), as a share of all sent */}
      <Funnel
        stages={counts.now.map((atStage) => ({ ...atStage, label: stageOf(atStage.stage).label }))}
        sent={counts.sent}
        isOn={(label) => Boolean(on(label))}
        onPick={(label, stage) => pick(label, (app) => app.stage === stage)()}
      />

      <details className="overflow-x-auto">
        <summary className="cursor-pointer text-[13px] text-muted-foreground">Where they are now</summary>
        <Table className="mt-1.5 text-[13px] tabular-nums">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                scope="col"
                className="h-auto px-2 py-1.5 text-xs font-medium text-muted-foreground max-[480px]:px-1"
              >
                Stage
              </TableHead>
              {OUTCOMES.map((outcome) => (
                <TableHead
                  key={outcome.id}
                  scope="col"
                  className="h-auto px-2 py-1.5 text-right text-xs font-medium text-muted-foreground max-[480px]:px-1"
                >
                  {outcomeHeading(outcome.id)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {STAGES.map((stage) => (
              <TableRow key={stage.id} className="hover:bg-transparent">
                <TableHead scope="row" className="h-auto px-2 py-1.5 font-medium max-[480px]:px-1">
                  {stage.label}
                </TableHead>
                {OUTCOMES.map((outcome) => {
                  const count = counts.byStage[stage.id][outcome.id];
                  const label = `${stage.short} · ${outcomeLabel(stage.id, outcome.id)}`;
                  const cell = 'px-2 py-1.5 text-right max-[480px]:px-1';
                  // an offer has its own outcomes (Received / Accepted / Rejected) and is never ghosted
                  if (!outcomesFor(stage.id).some((possible) => possible.id === outcome.id))
                    return (
                      <TableCell key={outcome.id} className={cn(cell, 'text-muted-foreground')}>
                        –
                      </TableCell>
                    );
                  return (
                    <TableCell key={outcome.id} className={cell}>
                      {count ? (
                        <Button
                          type="button"
                          variant="link"
                          size="xs"
                          className="h-auto p-0 text-[13px] aria-pressed:underline"
                          aria-pressed={on(label)}
                          onClick={pick(label, (app) => app.stage === stage.id && app.outcome === outcome.id)}
                        >
                          {count}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                      {stage.id === 'offer' && (
                        <small className="text-muted-foreground">
                          {' '}
                          {outcomeLabel(stage.id, outcome.id).toLowerCase()}
                        </small>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </section>
  );
}

/** Applications by the stage they're at now: one bar per stage, its length the share of all sent. */
function Funnel({
  stages,
  sent,
  isOn,
  onPick,
}: {
  stages: { stage: StageId; label: string; count: number }[];
  sent: number;
  isOn: (label: string) => boolean;
  onPick: (label: string, stage: StageId) => void;
}) {
  return (
    <ol
      className="m-0 flex list-none flex-col gap-1 rounded-xl bg-card px-3 py-2.5 ring-1 ring-foreground/10"
      aria-label="By stage, as they are now"
    >
      {stages.map(({ stage, label, count }) => (
        <li key={stage}>
          <button
            type="button"
            className="relative block w-full overflow-hidden rounded-md px-2 py-1 text-left text-[13px] aria-pressed:outline-2 aria-pressed:outline-brand"
            aria-pressed={isOn(label) || undefined}
            onClick={() => onPick(label, stage)}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-accent"
              style={{ width: `${sent ? Math.max(4, (count / sent) * 100) : 0}%` }}
            />
            <span className="relative tabular-nums">
              <strong>{count}</strong> {label}
              <span className="text-muted-foreground"> · {pct(count, sent)} of sent</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---- one application: status, timeline, note, saved ad ---------------------------------
// Opens with what the list already has (title, status, details, note) and keeps one height:
// only the ad text loads, into its own box, and everything between the title and the buttons
// scrolls inside the window. "Edit" shows the "Add application" form in its place.

type Shown = Application & { content?: string | null }; // no content yet = still loading

const noteValue = (text: string) => (text.trim() ? text : null); // as the database keeps it

async function loadApplication(jobId: string) {
  const res = await fetch(`/api/application?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ApplicationWithContent;
}

function AdModal({
  initial,
  labels,
  onClose,
  onNoteSaved,
  onNoteStale,
}: {
  initial: Application;
  labels: Record<string, string>;
  onClose: (note: string | null | undefined, jobId: string) => void;
  onNoteSaved: (jobId: string, note: string | null, at: string) => void;
  onNoteStale: (jobId: string) => void;
}) {
  const [jobId, setJobId] = useState(initial.jobId); // an edit can make it another job's (see updateApplication)
  const day = useDay();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(true);
  const confirm = useConfirm();
  const focus = useReturnFocus();
  const note = useRef<NoteHandle>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // back from the form to the window: focus where you left it (the form, now gone, had it)
  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const closedWith = useRef<string | null | undefined>(undefined); // the note as the window closed
  const [app, setApp] = useState<Shown>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const run = useRef(0); // the newest load; answers to older ones are dropped
  const gone = useRef(false); // unmarked: there's no note to save any more

  // the saved ad and the current status; while the ad is still being fetched, look again every 3 s
  const follow = async (id = jobId) => {
    const me = ++run.current;
    try {
      for (;;) {
        const data = await loadApplication(id);
        if (me !== run.current) return;
        setApp(data);
        setLoadError(null);
        if (data.contentStatus !== 'pending') return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (me !== run.current) return;
      }
    } catch (error) {
      if (me === run.current) setLoadError(message(error));
    }
  };

  const opened = useEffectEvent(() => {
    void follow();
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow() sets state only after its fetch, not synchronously
    opened();
    const loads = run;
    return () => {
      loads.current++; // closed: stop looking
    };
  }, []);

  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      setActionError(null);
      try {
        await fn();
      } catch (error) {
        setActionError(message(error));
      }
    });

  const setStatus = (stage: StageId, outcome: OutcomeId) => {
    if (stage === app.stage && outcome === app.outcome) return;
    run.current++; // a load already on its way would bring the old status back
    setApp({
      ...app,
      stage,
      outcome,
      history: [...app.history, { stage, state: outcome, at: new Date().toISOString() }],
    });
    act(async () => {
      unwrap(await setApplicationStatusAction({ jobId, stage, outcome }));
      await follow();
    });
  };

  // a step clicked by mistake: out of the history with every step after it, the status goes back
  // to the step before
  const removeStep = async (i: number) => {
    const all = app.history;
    const step = all[i];
    const later = all.length - 1 - i;
    if (
      later > 0 &&
      !(await confirm({
        title: `Remove “${stageOf(step.stage).label} · ${outcomeLabel(step.stage, step.state)}” of ${day(step.at)}?`,
        description: `${later === 1 ? 'The step after it goes' : `The ${later} steps after it go`} too, and the status goes back to the step before.`,
        action: 'Remove',
        destructive: true,
      }))
    )
      return;
    run.current++;
    const history = all.slice(0, i);
    const last = history.at(-1);
    setApp({ ...app, history, stage: last?.stage ?? 'submitted', outcome: last?.state ?? 'pending' }); // instant
    act(async () => {
      unwrap(await removeStatusStepAction({ jobId, step }));
      await follow();
    });
  };

  // saved in the form: back to the window with it (under its new job, if it's another job's now)
  const saved = (fresh: ApplicationWithContent) => {
    if (fresh.jobId !== jobId) {
      moveDraft(jobId, fresh.jobId);
      setJobId(fresh.jobId);
    }
    run.current++; // a load on its way would bring the old details back
    setApp(fresh);
    setEditing(false);
    if (fresh.contentStatus === 'pending') void follow(fresh.jobId);
  };

  // Escape, a click outside, the X and Close all end here; the note's last words are saved on the way
  // out, and the list hears of them once the window has gone (onCloseAutoFocus)
  const close = () => {
    closedWith.current = gone.current ? undefined : note.current?.flush();
    setOpen(false);
  };
  const details = app.details;
  const rows: [string, string | undefined][] = [
    ['Salary', details?.salary],
    ['Contract', details?.contract],
    ['Location', [details?.remote ? 'Remote' : null, details?.location].filter(Boolean).join(' · ') || undefined],
    ['Posted', details?.posted ? formatDay(details.posted) : undefined],
    ['Valid until', details?.validUntil ? formatDay(details.validUntil) : undefined],
  ];
  const been = reached(app);
  const subtitle = (
    <>
      {app.company && <>{app.company} · </>}
      {labels[app.src] ?? app.src} · applied {day(app.appliedAt)}
    </>
  );
  const unmark = async () => {
    const yes = await confirm({
      title: 'Unmark as applied?',
      description: 'Its saved ad text, status history and note are deleted too.',
      action: 'Unmark',
      destructive: true,
    });
    if (!yes) return;
    act(async () => {
      unwrap(await unapplyAction({ jobId }));
      gone.current = true;
      writeDraft(jobId, null);
      close();
    });
  };
  const waiting = app.content === undefined || app.contentStatus === 'pending';
  const hasText = app.contentStatus === 'ok' && !!app.content;

  // A side panel: it reads like a page about one application, as tall as the screen, with the list
  // still in view beside it on a wide one
  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]"
        showCloseButton={!editing}
        // editing: Esc goes back to the window, and a click outside does nothing (the form would be lost)
        onEscapeKeyDown={(event) => {
          if (!editing) return;
          event.preventDefault();
          stopEditing();
        }}
        onInteractOutside={(event) => (editing ? event.preventDefault() : keepOpenOnToast(event))}
        onCloseAutoFocus={(event) => {
          focus.onCloseAutoFocus(event);
          onClose(closedWith.current, jobId);
        }}
      >
        {editing && <ApplicationForm app={app as ApplicationWithContent} onCancel={stopEditing} onSaved={saved} />}
        {/* hidden, not gone, while editing: the note keeps what you typed */}
        <div className={cn('flex min-h-0 flex-1 flex-col', editing && 'hidden')}>
          <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
            {/* the form has the window's title while it's open */}
            {editing ? (
              <h2 className="m-0 text-lg font-semibold">{app.title}</h2>
            ) : (
              <SheetTitle className="text-lg font-semibold">{app.title}</SheetTitle>
            )}
            {editing ? (
              <p className="m-0 text-[13px] text-muted-foreground">{subtitle}</p>
            ) : (
              <SheetDescription className="text-[13px]">{subtitle}</SheetDescription>
            )}
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
            <section
              className="flex flex-col gap-2 rounded-lg border px-3 py-2.5"
              aria-label="Status"
              aria-busy={busy || undefined}
            >
              <ToggleGroup
                type="single"
                spacing={1.5}
                className="flex-wrap"
                aria-label="Stage"
                value={app.stage}
                // a new stage starts "in progress"; the current one clicked again keeps its outcome
                onValueChange={(stage) => stage && setStatus(stage as StageId, 'pending')}
              >
                {STAGES.map((stage) => (
                  <ToggleGroupItem
                    key={stage.id}
                    value={stage.id}
                    title={'hint' in stage ? `${stage.label}: ${stage.hint}` : stage.label}
                    className={cn(
                      STEP,
                      been.has(stage.id) && 'text-foreground',
                      'data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background',
                    )}
                  >
                    {been.has(stage.id) && (
                      <CheckIcon
                        className="text-success group-data-[state=on]/toggle:text-current"
                        role="img"
                        aria-label="reached"
                      />
                    )}
                    {stage.short}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup
                type="single"
                spacing={1.5}
                className="flex-wrap"
                aria-label="Outcome of this stage"
                value={app.outcome}
                onValueChange={(outcome) => outcome && setStatus(app.stage, outcome as OutcomeId)}
              >
                {outcomesFor(app.stage).map((outcome) => (
                  <ToggleGroupItem
                    key={outcome.id}
                    value={outcome.id}
                    title={outcome.hint}
                    className={cn(STEP, OUTCOME_ON[outcome.id])}
                  >
                    {outcome.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {app.history.length > 0 && (
                // newest first; the X takes a step away with the ones after it (above it here), not the first one: applying
                <ol
                  className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-muted-foreground"
                  aria-label="History"
                >
                  {app.history
                    .map((step, i) => ({ step, i }))
                    .reverse()
                    .map(({ step, i }) => {
                      const later = app.history.length - 1 - i;
                      return (
                        <li
                          key={`${step.at}|${step.stage}|${step.state}|${i}`}
                          // what an X takes away, struck through while it's pointed at: its step and the later
                          // ones, listed above it
                          className="group/step flex flex-wrap items-center gap-1 [&>:not(button)]:decoration-destructive has-[button:hover:not(:disabled)]:[&>:not(button)]:line-through has-[~li_button:hover:not(:disabled)]:[&>:not(button)]:line-through"
                        >
                          <time dateTime={step.at} className="mr-1 tabular-nums">
                            {day(step.at)}
                          </time>
                          <span>{stageOf(step.stage).label} ·</span>
                          <span className={OUTCOME_TEXT[step.state]}>{outcomeLabel(step.stage, step.state)}</span>
                          {step.auto && <span title={`No news for ${GHOST_AFTER_DAYS} days`}>(auto)</span>}
                          {i > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              // shown on the step under the pointer (or with the keyboard); a touch screen can't
                              // hover: always there
                              className="h-5 text-muted-foreground transition-opacity hover:bg-background hover:text-destructive focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/step:opacity-100 pointer-fine:focus-visible:opacity-100"
                              title={
                                later
                                  ? 'Remove this step and the ones after it'
                                  : 'Remove this step (clicked by mistake)'
                              }
                              aria-label={`Remove “${stageOf(step.stage).label} · ${outcomeLabel(step.stage, step.state)}” of ${day(step.at)}${later ? ` and the ${later} after it` : ''}`}
                              disabled={busy}
                              onClick={() => void removeStep(i)}
                            >
                              <XIcon />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                </ol>
              )}
            </section>

            <NoteEditor
              ref={note}
              jobId={jobId}
              initial={initial.note ?? ''}
              seenAt={initial.noteUpdatedAt}
              editedAt={app.noteUpdatedAt}
              onSaved={(text, at) => onNoteSaved(jobId, text, at)}
              onStale={() => onNoteStale(jobId)}
            />

            {rows.some(([, value]) => value) && (
              <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-4 gap-y-2 rounded-lg border bg-background px-3 py-2.5">
                {rows
                  .filter((row): row is [string, string] => Boolean(row[1]))
                  .map(([label, value]) => (
                    <div key={label} className={label === 'Salary' && value.includes('; ') ? 'col-span-2' : undefined}>
                      <dt className="text-[11px] tracking-[0.05em] text-muted-foreground uppercase">{label}</dt>
                      {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
                      <dd className="mt-0.5 ml-0 text-sm">
                        {value.split('; ').map((line, i) => (
                          <span key={i} className="block">
                            {line}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}

            {/* the ad text loads into this box, which has the same place and size before and after; it
                fills what's left, so a short ad or the placeholder look the same as a long one */}
            <div
              className="min-h-[180px] flex-[1_0_auto]! rounded-lg border bg-background px-3.5 py-3 text-sm leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]"
              aria-busy={waiting || undefined}
            >
              {waiting ? (
                loadError ? (
                  <p className="m-0 text-[13px] text-destructive">Couldn’t load the ad: {loadError}</p>
                ) : (
                  <div
                    className="flex animate-appear-late flex-col gap-[13px] pt-1"
                    role="status"
                    aria-label={app.contentStatus === 'pending' ? 'Saving the ad text' : 'Loading the ad text'}
                  >
                    {Array.from({ length: 10 }, (_, i) => (
                      <Skeleton key={i} className="h-[11px] rounded-sm" style={{ width: `${58 + ((i * 29) % 40)}%` }} />
                    ))}
                  </div>
                )
              ) : hasText ? (
                app.content
              ) : (
                <p className="m-0 text-[13px] text-destructive">
                  {app.contentStatus === 'empty' ? 'The board page had no ad text.' : 'Couldn’t fetch the ad.'}{' '}
                  {app.contentError}
                </p>
              )}
            </div>
            {app.scrapedAt && hasText && (
              <p className="m-0 -mt-1.5 text-xs text-muted-foreground">Ad saved {day(app.scrapedAt)}.</p>
            )}
          </div>

          <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
            {actionError && (
              <Alert variant="destructive" className="basis-full">
                <TriangleAlertIcon />
                <AlertTitle className="font-normal">{actionError}</AlertTitle>
              </Alert>
            )}
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void unmark()}
            >
              Unmark applied
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || waiting}
              title={waiting ? 'Once the ad text is in' : undefined}
              ref={editButton}
              onClick={() => setEditing(true)}
            >
              <PencilIcon /> Edit
            </Button>
            {!waiting && !hasText && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => {
                  setApp({ ...app, content: undefined }); // back to the placeholder while it fetches
                  act(async () => {
                    unwrap(await refetchContentAction({ jobId }));
                    await follow();
                  });
                }}
              >
                Fetch again
              </Button>
            )}
            {app.url && (
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original <ExternalLinkIcon />
              </a>
            )}
            <Button type="button" onClick={close}>
              Close
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---- your note: saves itself when you stop typing, leave the box or close the window ------
// Until the database has it, the text is also kept in this browser, so a dropped connection or
// a closed tab doesn't lose it: it's back (and saved) the next time you open this application.
// A save says which version of the note it was written over (note_updated_at); if the note was
// changed elsewhere since (another tab), nothing is overwritten: you see both and pick.

type NoteHandle = { flush: () => string | null | undefined }; // saves what's left, returns the note (undefined: not saved, see the conflict)
type NoteStatus = 'idle' | 'typing' | 'saving' | 'saved' | 'error';
/** base = the saved note it was written over (another one in the database = changed elsewhere) */
type Draft = { text: string; base: string };
/** the note as it is in the database, when it isn't the one this was written over */
type Theirs = { note: string; at: string | null };

// Drafts already sit in browsers under this name and in this shape ({ text, base }): changing either
// would lose the unsaved ones. The job id is the value it always was (offers_unique.dup_key).
const storageKey = (jobId: string) => `jobwatch:note:${jobId}`;
function readDraft(jobId: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey(jobId)) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
}
function moveDraft(from: string, to: string) {
  const draft = readDraft(from);
  if (!draft) return;
  writeDraft(to, draft);
  writeDraft(from, null);
}
function writeDraft(jobId: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(storageKey(jobId), JSON.stringify(draft));
    else localStorage.removeItem(storageKey(jobId));
  } catch {
    // storage blocked: autosave still works, there's just no copy in the browser
  }
}

const NOTE_STATUS: Record<NoteStatus, string> = {
  idle: '',
  typing: '…',
  saving: 'saving…',
  saved: 'saved',
  error: 'not saved yet (kept in this browser, tries again on the next change)',
};

function NoteEditor({
  jobId,
  initial,
  seenAt,
  editedAt,
  onSaved,
  onStale,
  ref,
}: {
  jobId: string;
  /** the note as the window opened with it, and its note_updated_at */
  initial: string;
  seenAt: string | null;
  editedAt: string | null;
  onSaved: (note: string | null, at: string) => void;
  /** the note was changed elsewhere: the list's copy of it is outdated */
  onStale: () => void;
  ref: Ref<NoteHandle>;
}) {
  const day = useDay();
  const router = useRouter();
  // an unsaved draft of this note comes back; if the note was changed somewhere else meanwhile, it
  // comes back next to that version, for you to pick (it's never dropped without asking)
  const [restored] = useState(() => {
    const draft = readDraft(jobId);
    if (!draft || draft.text === initial) return { text: initial, theirs: null };
    // written over the note as it is now: carry on with it (if the list's copy was outdated, the first
    // save finds that out)
    if (draft.base === initial) return { text: draft.text, theirs: null };
    // the note was changed elsewhere since: both are shown, and you pick
    return { text: draft.text, theirs: { note: initial, at: seenAt } };
  });
  const [text, setText] = useState(restored.text);
  const [status, setStatus] = useState<NoteStatus>(restored.text === initial ? 'idle' : 'typing');
  const [problem, setProblem] = useState<string | null>(null); // why the last save didn't go through
  const [theirs, setTheirs] = useState<Theirs | null>(restored.theirs);
  const latest = useRef(restored.text); // what's in the box
  const saved = useRef(initial); // what the database has
  const savedAt = useRef(seenAt); // ... and its note_updated_at, sent with the next save
  const conflict = useRef(Boolean(restored.theirs)); // no saving until you pick a version
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void> | null>(null);

  // after a failed save: if the note isn't the one this was written over any more, show the other one
  const lookAgain = async (value: string) => {
    const fresh = await loadApplication(jobId).catch(() => null);
    if (!fresh || fresh.noteUpdatedAt === savedAt.current) return;
    conflict.current = true;
    setTheirs({ note: fresh.note ?? '', at: fresh.noteUpdatedAt });
    writeDraft(jobId, { text: latest.current || value, base: saved.current });
    onStale();
    router.refresh(); // the list shows the note as it is now
  };

  // one save at a time, always of the newest text
  const save = (): Promise<void> => {
    clearTimeout(timer.current);
    if (conflict.current) return Promise.resolve();
    if (saving.current) return saving.current.then(save);
    const value = latest.current;
    if (value === saved.current) return Promise.resolve();
    setStatus('saving');
    saving.current = setApplicationNoteAction({ jobId, note: value, seenAt: savedAt.current })
      .then(async (res) => {
        if (!res.ok) {
          setProblem(res.error);
          setStatus('error');
          await lookAgain(value);
          return;
        }
        saved.current = value;
        savedAt.current = res.data.noteUpdatedAt;
        setProblem(null);
        onSaved(noteValue(value), res.data.noteUpdatedAt);
        const now = latest.current;
        writeDraft(jobId, now === value ? null : { text: now, base: value });
        setStatus(now === value ? 'saved' : 'typing');
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        saving.current = null;
      });
    return saving.current;
  };

  useImperativeHandle(ref, () => ({
    flush: () => {
      if (conflict.current) return undefined; // the list keeps the database's note
      void save();
      return noteValue(latest.current);
    },
  }));

  // the version you pick becomes the one the database has; "mine" is then saved over "theirs"
  const pick = (mine: boolean) => {
    if (!theirs) return;
    conflict.current = false;
    saved.current = theirs.note;
    savedAt.current = theirs.at;
    setTheirs(null);
    setProblem(null);
    if (mine) void save();
    else {
      latest.current = theirs.note;
      setText(theirs.note);
      writeDraft(jobId, null);
      setStatus('idle');
    }
  };

  // a restored draft is saved right away; an outdated one is dropped
  const mounted = useEffectEvent(() => {
    if (conflict.current) return;
    if (latest.current === saved.current) writeDraft(jobId, null);
    else void save();
  });
  useEffect(() => {
    mounted();
  }, []);

  const shownStatus = theirs
    ? 'not saved: changed elsewhere'
    : status === 'idle' && initial && editedAt
      ? `edited ${day(editedAt)}`
      : NOTE_STATUS[status];
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
        <span>
          Note
          {shownStatus && (
            <span className={cn(status === 'error' || theirs ? 'text-warning' : undefined)} aria-live="polite">
              {' · '}
              {shownStatus}
              {!theirs && status === 'saved' && (
                <>
                  {' '}
                  <CheckIcon />
                </>
              )}
            </span>
          )}
        </span>
        <Textarea
          rows={3}
          maxLength={10_000}
          className="max-h-[40vh] min-h-[4.6em] resize-y bg-background text-sm text-foreground md:text-sm dark:bg-background"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            latest.current = value;
            writeDraft(
              jobId,
              value === saved.current && !conflict.current ? null : { text: value, base: saved.current },
            );
            if (conflict.current) return; // nothing is saved until you pick
            setStatus(value === saved.current ? (status === 'idle' ? 'idle' : 'saved') : 'typing');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void save(), 700);
          }}
          onBlur={() => void save()}
          placeholder="Recruiter's name, the salary you asked for, what they asked in the interview, next steps…"
        />
      </label>
      {problem && !theirs && status === 'error' && (
        <p className="m-0 text-[13px] text-destructive" role="alert">
          {problem}
        </p>
      )}
      {theirs && (
        <div className="flex flex-col gap-1.5" role="alert">
          <p className="m-0 text-[13px] text-destructive">{problem ?? NOTE_CONFLICT}</p>
          <p className="m-0 text-xs text-muted-foreground">
            The note now{theirs.at ? ` (edited ${day(theirs.at)})` : ''}:
          </p>
          <blockquote className="m-0 max-h-[30vh] overflow-auto border-l-3 bg-background px-2.5 py-2 text-[13px] whitespace-pre-wrap">
            {theirs.note.trim() || <em>empty</em>}
          </blockquote>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => pick(false)}>
              Use that one
            </Button>
            <Button type="button" onClick={() => pick(true)}>
              Keep mine (replaces it)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
