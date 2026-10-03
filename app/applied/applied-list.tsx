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
import type { Application, ApplicationWithContent } from '@/lib/applications';
import { formatDay } from '@/lib/dates';
import {
  GHOST_AFTER_DAYS,
  isActive,
  isRejected,
  reached,
  STAGES,
  STATES,
  stageOf,
  stateHeading,
  stateLabel,
  statesFor,
  stats,
  type StageId,
  type StateId,
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
} from '../actions';
import { SearchIcon } from '../search-box';
import { TimeZone, useZone } from '../time-zone';
import { AddApplication, ApplicationForm } from './add-application';

/** "02.10.2026" of an instant, in the app's time zone */
const useDay = () => {
  const z = useZone();
  return (iso: string | null | undefined) => (iso ? z.formatDayOf(iso) : '');
};
const facts = (d: Application['details']) =>
  [d?.salary?.split('; ')[0], d?.contract, d?.remote ? 'Remote' : null, d?.location].filter(Boolean).join(' · ');
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

const CONTENT: Record<Application['contentStatus'], string> = {
  pending: 'saving the ad…',
  ok: '📄 ad saved',
  empty: 'no ad text',
  failed: 'couldn’t fetch the ad',
};

type Filter = { label: string; test: (a: Application) => boolean } | null;
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
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(null);
  const [open, setOpen] = useState<Application | null>(null); // the window shows this one
  const pending = fromServer.some((a) => a.contentStatus === 'pending');

  // notes written in the window show in the list at once, with when the database took them (the
  // window sends that back with the next save); the next refresh brings them from the database
  const [notes, setNotes] = useState<Partial<Record<string, NoteOverlay>>>({});
  const apps = useMemo(
    () =>
      fromServer.map((a) => {
        const mine = notes[a.dupKey];
        return mine ? { ...a, note: mine.note, noteUpdatedAt: mine.at === undefined ? a.noteUpdatedAt : mine.at } : a;
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
          ([k, v]) => v && fromServer.some((a) => a.dupKey === k && a.note !== v.note && !newer(a.noteUpdatedAt, v.at)),
        ),
      );
      return Object.keys(left).length === Object.keys(cur).length ? cur : left;
    });
  }

  // ad texts are scraped in the background right after marking: refresh until they're in
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(t);
  }, [pending, fromServer, router]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return apps.filter(
      (a) =>
        (!filter || filter.test(a)) &&
        words.every((w) => `${a.title} ${a.company ?? ''} ${a.note ?? ''}`.toLowerCase().includes(w)),
    );
  }, [apps, q, filter]);

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
          <SearchIcon />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
              ✕
            </button>
          </>
        )}
      </p>

      <ol className="applied-list">
        {shown.map((a) => (
          <li key={a.dupKey}>
            <button type="button" className="applied-row" onClick={() => setOpen(a)}>
              <time dateTime={a.appliedAt}>{day(a.appliedAt)}</time>
              <span className="body">
                <span className="title">{a.title}</span>
                <span className="meta">
                  {a.company && <span>{a.company}</span>}
                  {facts(a.details) && <span>{facts(a.details)}</span>}
                </span>
                {a.note?.trim() && <span className="note-line">📝 {a.note.trim().split('\n')[0]}</span>}
              </span>
              <span className="side">
                <StatusChip stage={a.stage} state={a.stageState} />
                <span className="src">{labels[a.src] ?? a.src}</span>
                <span className={`status status-${a.contentStatus}`}>{CONTENT[a.contentStatus]}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {open && (
        <AdModal
          key={open.dupKey}
          initial={open}
          labels={labels}
          onClose={(note, key) => {
            setOpen(null);
            if (note !== undefined && note !== open.note)
              setNotes((cur) => ({ ...cur, [key]: { note, at: cur[key]?.at } }));
          }}
          onNoteSaved={(key, note, at) => setNotes((cur) => ({ ...cur, [key]: { note, at } }))}
          // changed elsewhere: what the window saved before is outdated, the list shows the database's
          onNoteStale={(key) => setNotes((cur) => ({ ...cur, [key]: undefined }))}
        />
      )}
    </>
  );
}

function StatusChip({ stage, state }: { stage: StageId; state: StateId }) {
  return (
    <span className={`stage-chip state-${state}`}>
      {stageOf(stage).short} · {stateLabel(stage, state)}
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
  setFilter: (f: Filter) => void;
}) {
  const s = useMemo(() => stats(apps), [apps]);
  const pick = (label: string, test: (a: Application) => boolean) => () =>
    setFilter(filter?.label === label ? null : { label, test });
  const on = (label: string) => (filter?.label === label ? 'true' : undefined);

  const tiles = [
    { label: 'Sent', value: s.sent, sub: '', test: () => true, cls: '' },
    {
      label: 'Positive replies',
      value: s.positive,
      sub: pct(s.positive, s.sent),
      test: (a: Application) => a.stage !== 'submitted',
      cls: 'good',
    },
    {
      label: 'Offers',
      value: s.offers,
      sub: pct(s.offers, s.sent),
      test: (a: Application) => a.stage === 'offer',
      cls: 'good',
    },
    { label: 'In progress', value: s.active, sub: '', test: (a: Application) => isActive(a), cls: '' },
    {
      label: 'Rejected',
      value: s.rejected,
      sub: pct(s.rejected, s.sent),
      test: (a: Application) => isRejected(a),
      cls: 'bad',
    },
    {
      label: 'Ghosted',
      value: s.ghosted,
      sub: pct(s.ghosted, s.sent),
      test: (a: Application) => a.stageState === 'ghosted',
      cls: 'bad',
    },
    {
      label: stateHeading('pool'),
      value: s.pool,
      sub: pct(s.pool, s.sent),
      test: (a: Application) => a.stageState === 'pool',
      cls: 'bad',
    },
  ];

  return (
    <section className="app-stats" aria-label="Application statistics">
      <div className="stat-tiles">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            className={`stat-tile ${t.cls}`}
            aria-pressed={on(t.label)}
            onClick={t.label === 'Sent' ? () => setFilter(null) : pick(t.label, t.test)}
          >
            <span className="stat-value">{t.value}</span>
            <span className="stat-label">{t.label}</span>
            {t.sub && <span className="stat-sub">{t.sub}</span>}
          </button>
        ))}
      </div>

      {/* where applications are: each one at the stage of its last status (a stage it was taken back
          from doesn't count), as a share of all sent */}
      <ol className="funnel" aria-label="By stage, as they are now">
        {s.now.map((f) => {
          const label = stageOf(f.stage).label;
          return (
            <li key={f.stage}>
              <button type="button" aria-pressed={on(label)} onClick={pick(label, (a) => a.stage === f.stage)}>
                <span
                  className="funnel-bar"
                  style={{ width: `${s.sent ? Math.max(4, (f.count / s.sent) * 100) : 0}%` }}
                />
                <span className="funnel-text">
                  <strong>{f.count}</strong> {label}
                  <span className="muted"> · {pct(f.count, s.sent)} of sent</span>
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
              {STATES.map((x) => (
                <th key={x.id} scope="col" className={`state-${x.id}`}>
                  {stateHeading(x.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STAGES.map((st) => (
              <tr key={st.id}>
                <th scope="row">{st.label}</th>
                {STATES.map((x) => {
                  const n = s.byStage[st.id][x.id];
                  const label = `${st.short} · ${stateLabel(st.id, x.id)}`;
                  // an offer has its own outcomes (Received / Accepted / Rejected) and is never ghosted
                  if (!statesFor(st.id).some((y) => y.id === x.id))
                    return (
                      <td key={x.id} className="muted">
                        –
                      </td>
                    );
                  return (
                    <td key={x.id}>
                      {n ? (
                        <button
                          type="button"
                          className="link"
                          aria-pressed={on(label)}
                          onClick={pick(label, (a) => a.stage === st.id && a.stageState === x.id)}
                        >
                          {n}
                        </button>
                      ) : (
                        <span className="muted">0</span>
                      )}
                      {st.id === 'offer' && <small className="muted"> {stateLabel(st.id, x.id).toLowerCase()}</small>}
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
// scrolls inside the window. "✎ Edit" shows the "Add application" form in its place.

type Shown = Application & { content?: string | null }; // no content yet = still loading

const noteValue = (text: string) => (text.trim() ? text : null); // as the database keeps it

async function loadApplication(key: string) {
  const res = await fetch(`/api/application?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
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
  onClose: (note: string | null | undefined, key: string) => void;
  onNoteSaved: (key: string, note: string | null, at: string) => void;
  onNoteStale: (key: string) => void;
}) {
  const [key, setKey] = useState(initial.dupKey); // an edit can make it another job's (see updateApplication)
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
  const follow = async (k = key) => {
    const me = ++run.current;
    try {
      for (;;) {
        const data = await loadApplication(k);
        if (me !== run.current) return;
        setApp(data);
        setLoadError(null);
        if (data.contentStatus !== 'pending') return;
        await new Promise((r) => setTimeout(r, 3000));
        if (me !== run.current) return;
      }
    } catch (e) {
      if (me === run.current) setLoadError(message(e));
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
      } catch (e) {
        setActionError(message(e));
      }
    });

  const setStatus = (stage: StageId, state: StateId) => {
    if (stage === app.stage && state === app.stageState) return;
    run.current++; // a load already on its way would bring the old status back
    setApp({
      ...app,
      stage,
      stageState: state,
      history: [...app.history, { stage, state, at: new Date().toISOString() }],
    });
    act(async () => {
      unwrap(await setApplicationStatusAction({ key, stage, state }));
      await follow();
    });
  };

  // a step clicked by mistake: out of the history with every step after it, the status goes back
  // to the step before
  const removeStep = (i: number) => {
    const all = app.history;
    const h = all[i];
    const later = all.length - 1 - i;
    if (
      later > 0 &&
      !confirm(
        `Remove “${stageOf(h.stage).label} · ${stateLabel(h.stage, h.state)}” of ${day(h.at)} and the ${later === 1 ? 'step' : `${later} steps`} after it?`,
      )
    )
      return;
    run.current++;
    const history = all.slice(0, i);
    const last = history.at(-1);
    setApp({ ...app, history, stage: last?.stage ?? 'submitted', stageState: last?.state ?? 'pending' }); // instant
    act(async () => {
      unwrap(await removeStatusStepAction({ key, step: h }));
      await follow();
    });
  };

  // saved in the form: back to the window with it (under its new key, if it's another job's now)
  const saved = (fresh: ApplicationWithContent) => {
    if (fresh.dupKey !== key) {
      moveDraft(key, fresh.dupKey);
      setKey(fresh.dupKey);
    }
    run.current++; // a load on its way would bring the old details back
    setApp(fresh);
    setEditing(false);
    if (fresh.contentStatus === 'pending') void follow(fresh.dupKey);
  };

  const close = () => dialog.current?.close();
  const d = app.details;
  const rows: [string, string | undefined][] = [
    ['Salary', d?.salary],
    ['Contract', d?.contract],
    ['Location', [d?.remote ? 'Remote' : null, d?.location].filter(Boolean).join(' · ') || undefined],
    ['Posted', d?.posted ? formatDay(d.posted) : undefined],
    ['Valid until', d?.validUntil ? formatDay(d.validUntil) : undefined],
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
      onClose={() => onClose(gone.current ? undefined : note.current?.flush(), key)}
      // editing: Esc goes back to the window, and a click outside does nothing (the form would be lost)
      onCancel={(e) => {
        if (!editing) return;
        e.preventDefault();
        setEditing(false);
      }}
      onClick={(e) => e.target === dialog.current && !editing && close()}
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
              {STAGES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  className={`step${been.has(st.id) ? ' reached' : ''}`}
                  aria-pressed={app.stage === st.id}
                  title={'hint' in st ? `${st.label}: ${st.hint}` : st.label}
                  // a new stage starts "in progress"; clicking the current one keeps its outcome
                  onClick={() => setStatus(st.id, st.id === app.stage ? app.stageState : 'pending')}
                >
                  {st.short}
                </button>
              ))}
            </div>
            <div className="state-steps" role="group" aria-label="Outcome of this stage">
              {statesFor(app.stage).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={`state-btn state-${x.id}`}
                  aria-pressed={app.stageState === x.id}
                  title={x.hint}
                  onClick={() => setStatus(app.stage, x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
            {app.history.length > 0 && (
              // newest first; × takes a step away with the ones after it (above it here), not the first one: applying
              <ol className="timeline" aria-label="History">
                {app.history
                  .map((h, i) => ({ h, i }))
                  .reverse()
                  .map(({ h, i }) => {
                    const later = app.history.length - 1 - i;
                    return (
                      <li key={`${h.at}|${h.stage}|${h.state}|${i}`}>
                        <time dateTime={h.at}>{day(h.at)}</time>
                        <span>{stageOf(h.stage).label} ·</span>
                        <span className={`state-text state-${h.state}`}>{stateLabel(h.stage, h.state)}</span>
                        {h.auto && (
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
                            aria-label={`Remove “${stageOf(h.stage).label} · ${stateLabel(h.stage, h.state)}” of ${day(h.at)}${later ? ` and the ${later} after it` : ''}`}
                            disabled={busy}
                            onClick={() => removeStep(i)}
                          >
                            ×
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
            appKey={key}
            initial={initial.note ?? ''}
            seenAt={initial.noteUpdatedAt}
            editedAt={app.noteUpdatedAt}
            onSaved={(text, at) => onNoteSaved(key, text, at)}
            onStale={() => onNoteStale(key)}
          />

          {rows.some(([, v]) => v) && (
            <dl className="ad-facts">
              {rows
                .filter((row): row is [string, string] => Boolean(row[1]))
                .map(([k, v]) => (
                  <div key={k} className={k === 'Salary' && v.includes('; ') ? 'wide' : undefined}>
                    <dt>{k}</dt>
                    {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
                    <dd>
                      {v.split('; ').map((line, i) => (
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
                  unwrap(await unapplyAction({ key }));
                  gone.current = true;
                  writeDraft(key, null);
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
              ✎ Edit
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
                    unwrap(await refetchContentAction({ key }));
                    await follow();
                  });
                }}
              >
                Fetch again
              </button>
            )}
            {app.url && (
              <a className="button-link" href={app.url} target="_blank" rel="noopener noreferrer">
                Open original ↗
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

const draftKey = (key: string) => `jobwatch:note:${key}`;
function readDraft(key: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(key)) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
}
function moveDraft(from: string, to: string) {
  const d = readDraft(from);
  if (!d) return;
  writeDraft(to, d);
  writeDraft(from, null);
}
function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(key), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(key));
  } catch {
    // storage blocked: autosave still works, there's just no copy in the browser
  }
}

const NOTE_STATUS: Record<NoteStatus, string> = {
  idle: '',
  typing: '…',
  saving: 'saving…',
  saved: 'saved ✓',
  error: 'not saved yet (kept in this browser, tries again on the next change)',
};

function NoteEditor({
  appKey,
  initial,
  seenAt,
  editedAt,
  onSaved,
  onStale,
  ref,
}: {
  appKey: string;
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
    const d = readDraft(appKey);
    if (!d || d.text === initial) return { text: initial, theirs: null };
    // written over the note as it is now: carry on with it (if the list's copy was outdated, the first
    // save finds that out)
    if (d.base === initial) return { text: d.text, theirs: null };
    // the note was changed elsewhere since: both are shown, and you pick
    return { text: d.text, theirs: { note: initial, at: seenAt } };
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
    const fresh = await loadApplication(appKey).catch(() => null);
    if (!fresh || fresh.noteUpdatedAt === savedAt.current) return;
    conflict.current = true;
    setTheirs({ note: fresh.note ?? '', at: fresh.noteUpdatedAt });
    writeDraft(appKey, { text: latest.current || value, base: saved.current });
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
    saving.current = setApplicationNoteAction({ key: appKey, note: value, seenAt: savedAt.current })
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
        writeDraft(appKey, now === value ? null : { text: now, base: value });
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
      writeDraft(appKey, null);
      setStatus('idle');
    }
  };

  // a restored draft is saved right away; an outdated one is dropped
  const mounted = useEffectEvent(() => {
    if (conflict.current) return;
    if (latest.current === saved.current) writeDraft(appKey, null);
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
            </span>
          )}
        </span>
        <textarea
          rows={3}
          maxLength={10_000}
          value={text}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            latest.current = value;
            writeDraft(
              appKey,
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
