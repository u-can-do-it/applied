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
import { NOTE_CONFLICT } from '@/lib/shared/schemas/applications';
import { unwrap } from '@/lib/shared/result';
import {
  refetchContentAction,
  removeStatusStepAction,
  setApplicationNoteAction,
  setApplicationStatusAction,
  unapplyAction,
} from './actions';
import { TimeZone, useZone } from '@/components/time-zone';
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
      <div className="empty">
        <p>
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

      <div className="applied-tools">
        <div className="search">
          <SearchIcon className="size-4.5" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, company or note…"
            aria-label="Search applied offers"
          />
        </div>
        <AddApplication />
      </div>
      <p className="count">
        <strong>{shown.length}</strong>
        {shown.length !== apps.length && <> of {apps.length}</>} applied
        {filter && (
          <>
            {' · '}
            {filter.label}{' '}
            <button type="button" className="link" onClick={() => setFilter(null)} aria-label="Clear the filter">
              <XIcon />
            </button>
          </>
        )}
      </p>

      <ol className="applied-list">
        {shown.map((app) => (
          <li key={app.jobId}>
            <button type="button" className="applied-row" onClick={() => setOpen(app)}>
              <time dateTime={app.appliedAt}>{day(app.appliedAt)}</time>
              <span className="body">
                <span className="title">{app.title}</span>
                <span className="meta">
                  {app.company && <span>{app.company}</span>}
                  {facts(app.details) && <span>{facts(app.details)}</span>}
                </span>
                {app.note?.trim() && (
                  <span className="note-line">
                    <NotebookPenIcon /> {app.note.trim().split('\n')[0]}
                  </span>
                )}
              </span>
              <span className="side">
                <StatusChip stage={app.stage} outcome={app.outcome} />
                <span className="src">{labels[app.src] ?? app.src}</span>
                <span className={`status status-${app.contentStatus}`}>
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
    <span className={`stage-chip state-${outcome}`}>
      {stageOf(stage).short} · {outcomeLabel(stage, outcome)}
    </span>
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
    { label: 'Sent', value: counts.sent, sub: '', test: () => true, cls: '' },
    {
      label: 'Positive replies',
      value: counts.positive,
      sub: pct(counts.positive, counts.sent),
      test: (app: Application) => app.stage !== 'submitted',
      cls: 'good',
    },
    {
      label: 'Offers',
      value: counts.offers,
      sub: pct(counts.offers, counts.sent),
      test: (app: Application) => app.stage === 'offer',
      cls: 'good',
    },
    { label: 'In progress', value: counts.active, sub: '', test: (app: Application) => isActive(app), cls: '' },
    {
      label: 'Rejected',
      value: counts.rejected,
      sub: pct(counts.rejected, counts.sent),
      test: (app: Application) => isRejected(app),
      cls: 'bad',
    },
    {
      label: 'Ghosted',
      value: counts.ghosted,
      sub: pct(counts.ghosted, counts.sent),
      test: (app: Application) => app.outcome === 'ghosted',
      cls: 'bad',
    },
    {
      label: outcomeHeading('pool'),
      value: counts.pool,
      sub: pct(counts.pool, counts.sent),
      test: (app: Application) => app.outcome === 'pool',
      cls: 'bad',
    },
  ];

  return (
    <section className="app-stats" aria-label="Application statistics">
      <div className="stat-tiles">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            className={`stat-tile ${tile.cls}`}
            aria-pressed={on(tile.label)}
            onClick={tile.label === 'Sent' ? () => setFilter(null) : pick(tile.label, tile.test)}
          >
            <span className="stat-value">{tile.value}</span>
            <span className="stat-label">{tile.label}</span>
            {tile.sub && <span className="stat-sub">{tile.sub}</span>}
          </button>
        ))}
      </div>

      {/* where applications are: each one at the stage of its last status (a stage it was taken back
          from doesn't count), as a share of all sent */}
      <ol className="funnel" aria-label="By stage, as they are now">
        {counts.now.map((atStage) => {
          const label = stageOf(atStage.stage).label;
          return (
            <li key={atStage.stage}>
              <button
                type="button"
                aria-pressed={on(label)}
                onClick={pick(label, (app) => app.stage === atStage.stage)}
              >
                <span
                  className="funnel-bar"
                  style={{ width: `${counts.sent ? Math.max(4, (atStage.count / counts.sent) * 100) : 0}%` }}
                />
                <span className="funnel-text">
                  <strong>{atStage.count}</strong> {label}
                  <span className="muted"> · {pct(atStage.count, counts.sent)} of sent</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <details className="stage-table">
        <summary>Where they are now</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              {OUTCOMES.map((outcome) => (
                <th key={outcome.id} scope="col" className={`state-${outcome.id}`}>
                  {outcomeHeading(outcome.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STAGES.map((stage) => (
              <tr key={stage.id}>
                <th scope="row">{stage.label}</th>
                {OUTCOMES.map((outcome) => {
                  const count = counts.byStage[stage.id][outcome.id];
                  const label = `${stage.short} · ${outcomeLabel(stage.id, outcome.id)}`;
                  // an offer has its own outcomes (Received / Accepted / Rejected) and is never ghosted
                  if (!outcomesFor(stage.id).some((possible) => possible.id === outcome.id))
                    return (
                      <td key={outcome.id} className="muted">
                        –
                      </td>
                    );
                  return (
                    <td key={outcome.id}>
                      {count ? (
                        <button
                          type="button"
                          className="link"
                          aria-pressed={on(label)}
                          onClick={pick(label, (app) => app.stage === stage.id && app.outcome === outcome.id)}
                        >
                          {count}
                        </button>
                      ) : (
                        <span className="muted">0</span>
                      )}
                      {stage.id === 'offer' && (
                        <small className="muted"> {outcomeLabel(stage.id, outcome.id).toLowerCase()}</small>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
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
  const dialog = useRef<HTMLDialogElement>(null);
  const note = useRef<NoteHandle>(null);
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
    if (!dialog.current?.open) dialog.current?.showModal();
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
  const removeStep = (i: number) => {
    const all = app.history;
    const step = all[i];
    const later = all.length - 1 - i;
    if (
      later > 0 &&
      !confirm(
        `Remove “${stageOf(step.stage).label} · ${outcomeLabel(step.stage, step.state)}” of ${day(step.at)} and the ${later === 1 ? 'step' : `${later} steps`} after it?`,
      )
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

  const close = () => dialog.current?.close();
  const details = app.details;
  const rows: [string, string | undefined][] = [
    ['Salary', details?.salary],
    ['Contract', details?.contract],
    ['Location', [details?.remote ? 'Remote' : null, details?.location].filter(Boolean).join(' · ') || undefined],
    ['Posted', details?.posted ? formatDay(details.posted) : undefined],
    ['Valid until', details?.validUntil ? formatDay(details.validUntil) : undefined],
  ];
  const been = reached(app);
  const waiting = app.content === undefined || app.contentStatus === 'pending';
  const hasText = app.contentStatus === 'ok' && !!app.content;

  return (
    <dialog
      ref={dialog}
      className="modal modal-wide modal-sheet"
      aria-labelledby={editing ? 'edit-title' : 'ad-title'}
      // Esc, a click outside and Close all end here; the note's last words are saved on the way out
      onClose={() => onClose(gone.current ? undefined : note.current?.flush(), jobId)}
      // editing: Esc goes back to the window, and a click outside does nothing (the form would be lost)
      onCancel={(event) => {
        if (!editing) return;
        event.preventDefault();
        setEditing(false);
      }}
      onClick={(event) => event.target === dialog.current && !editing && close()}
    >
      {editing && (
        <ApplicationForm app={app as ApplicationWithContent} onCancel={() => setEditing(false)} onSaved={saved} />
      )}
      {/* hidden, not gone, while editing: the note keeps what you typed */}
      <div className="modal-body" style={editing ? { display: 'none' } : undefined}>
        <div className="sheet-head">
          <h2 id="ad-title">{app.title}</h2>
          <p className="muted">
            {app.company && <>{app.company} · </>}
            {labels[app.src] ?? app.src} · applied {day(app.appliedAt)}
          </p>
        </div>

        <div className="sheet-scroll">
          <section className="status-editor" aria-label="Status" aria-busy={busy || undefined}>
            <div className="stage-steps" role="group" aria-label="Stage">
              {STAGES.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  className={`step${been.has(stage.id) ? ' reached' : ''}`}
                  aria-pressed={app.stage === stage.id}
                  title={'hint' in stage ? `${stage.label}: ${stage.hint}` : stage.label}
                  // a new stage starts "in progress"; clicking the current one keeps its outcome
                  onClick={() => setStatus(stage.id, stage.id === app.stage ? app.outcome : 'pending')}
                >
                  {been.has(stage.id) && <CheckIcon className="step-check" role="img" aria-label="reached" />}
                  {stage.short}
                </button>
              ))}
            </div>
            <div className="state-steps" role="group" aria-label="Outcome of this stage">
              {outcomesFor(app.stage).map((outcome) => (
                <button
                  key={outcome.id}
                  type="button"
                  className={`state-btn state-${outcome.id}`}
                  aria-pressed={app.outcome === outcome.id}
                  title={outcome.hint}
                  onClick={() => setStatus(app.stage, outcome.id)}
                >
                  {outcome.label}
                </button>
              ))}
            </div>
            {app.history.length > 0 && (
              // newest first; the X takes a step away with the ones after it (above it here), not the first one: applying
              <ol className="timeline" aria-label="History">
                {app.history
                  .map((step, i) => ({ step, i }))
                  .reverse()
                  .map(({ step, i }) => {
                    const later = app.history.length - 1 - i;
                    return (
                      <li key={`${step.at}|${step.stage}|${step.state}|${i}`}>
                        <time dateTime={step.at}>{day(step.at)}</time>
                        <span>{stageOf(step.stage).label} ·</span>
                        <span className={`state-text state-${step.state}`}>{outcomeLabel(step.stage, step.state)}</span>
                        {step.auto && (
                          <span className="muted" title={`No news for ${GHOST_AFTER_DAYS} days`}>
                            (auto)
                          </span>
                        )}
                        {i > 0 && (
                          <button
                            type="button"
                            className="step-remove"
                            title={
                              later ? 'Remove this step and the ones after it' : 'Remove this step (clicked by mistake)'
                            }
                            aria-label={`Remove “${stageOf(step.stage).label} · ${outcomeLabel(step.stage, step.state)}” of ${day(step.at)}${later ? ` and the ${later} after it` : ''}`}
                            disabled={busy}
                            onClick={() => removeStep(i)}
                          >
                            <XIcon />
                          </button>
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
            <dl className="ad-facts">
              {rows
                .filter((row): row is [string, string] => Boolean(row[1]))
                .map(([label, value]) => (
                  <div key={label} className={label === 'Salary' && value.includes('; ') ? 'wide' : undefined}>
                    <dt>{label}</dt>
                    {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
                    <dd>
                      {value.split('; ').map((line, i) => (
                        <span key={i} className="fact-line">
                          {line}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
            </dl>
          )}

          {/* the ad text loads into this box, which has the same place and size before and after */}
          <div className="ad-text" aria-busy={waiting || undefined}>
            {waiting ? (
              loadError ? (
                <p className="form-error">Couldn’t load the ad: {loadError}</p>
              ) : (
                <div
                  className="skeleton ad-skeleton"
                  role="status"
                  aria-label={app.contentStatus === 'pending' ? 'Saving the ad text' : 'Loading the ad text'}
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} className="bar" style={{ width: `${58 + ((i * 29) % 40)}%` }} />
                  ))}
                </div>
              )
            ) : hasText ? (
              app.content
            ) : (
              <p className="form-error">
                {app.contentStatus === 'empty' ? 'The board page had no ad text.' : 'Couldn’t fetch the ad.'}{' '}
                {app.contentError}
              </p>
            )}
          </div>
          {app.scrapedAt && hasText && <p className="muted small ad-saved">Ad saved {day(app.scrapedAt)}.</p>}
        </div>

        <div className="sheet-foot">
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary danger"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => {
                if (!confirm('Unmark as applied? Its saved ad text, status history and note are deleted too.')) return;
                act(async () => {
                  unwrap(await unapplyAction({ jobId }));
                  gone.current = true;
                  writeDraft(jobId, null);
                  close();
                });
              }}
            >
              Unmark applied
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="secondary"
              disabled={busy || waiting}
              title={waiting ? 'Once the ad text is in' : undefined}
              onClick={() => setEditing(true)}
            >
              <PencilIcon /> Edit
            </button>
            {!waiting && !hasText && (
              <button
                type="button"
                className="secondary"
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
              </button>
            )}
            {app.url && (
              <a className="button-link" href={app.url} target="_blank" rel="noopener noreferrer">
                Open original <ExternalLinkIcon />
              </a>
            )}
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    </dialog>
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
    <div className="note-field">
      <label className="field">
        <span>
          Note
          {shownStatus && (
            <span className={`note-status${status === 'error' || theirs ? ' warn' : ''}`} aria-live="polite">
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
        <textarea
          rows={3}
          maxLength={10_000}
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
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      {theirs && (
        <div className="note-conflict" role="alert">
          <p className="form-error">{problem ?? NOTE_CONFLICT}</p>
          <p className="muted small">The note now{theirs.at ? ` (edited ${day(theirs.at)})` : ''}:</p>
          <blockquote className="note-theirs">{theirs.note.trim() || <em>empty</em>}</blockquote>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => pick(false)}>
              Use that one
            </button>
            <button type="button" onClick={() => pick(true)}>
              Keep mine (replaces it)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
