'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, useTransition, type Ref } from 'react';
import type { Application, ApplicationWithContent } from '@/lib/applications';
import { formatDay, todayInWarsaw } from '@/lib/dates';
import {
  GHOST_AFTER_DAYS, isActive, isRejected, reached, STAGES, STATES, stageOf, stateHeading, stateLabel, statesFor, stats,
  type HistoryEntry, type StageId, type StateId,
} from '@/lib/stages';
import { refetchContentAction, removeStatusStepAction, setApplicationNoteAction, setApplicationStatusAction, unapplyAction } from '../actions';
import { SearchIcon } from '../search-box';
import { AddApplication, ApplicationForm } from './add-application';

const day = (iso: string | null | undefined) => (iso ? formatDay(todayInWarsaw(Date.parse(iso))) : '');
const facts = (d: Application['details']) =>
  [d?.salary?.split('; ')[0], d?.contract, d?.remote ? 'Remote' : null, d?.location].filter(Boolean).join(' · ');
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

const CONTENT: Record<Application['content_status'], string> = {
  pending: 'saving the ad…',
  ok: '📄 ad saved',
  empty: 'no ad text',
  failed: 'couldn’t fetch the ad',
};

type Filter = { label: string; test: (a: Application) => boolean } | null;

export function AppliedList({ apps: fromServer, labels }: { apps: Application[]; labels: Record<string, string> }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(null);
  const [open, setOpen] = useState<Application | null>(null); // the window shows this one
  const pending = fromServer.some((a) => a.content_status === 'pending');

  // notes written in the window show in the list at once; the next refresh brings them from the database
  const [notes, setNotes] = useState<Record<string, string | null>>({});
  const apps = useMemo(
    () => fromServer.map((a) => (a.dup_key in notes ? { ...a, note: notes[a.dup_key] } : a)),
    [fromServer, notes],
  );
  useEffect(() => {
    setNotes((cur) => {
      // keep only what the database doesn't have yet (and nothing for offers no longer applied)
      const left = Object.fromEntries(Object.entries(cur).filter(([k, v]) => fromServer.some((a) => a.dup_key === k && a.note !== v)));
      return Object.keys(left).length === Object.keys(cur).length ? cur : left;
    });
  }, [fromServer]);

  // ad texts are scraped in the background right after marking: refresh until they're in
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(t);
  }, [pending, fromServer, router]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return apps.filter(
      (a) => (!filter || filter.test(a)) && words.every((w) => `${a.title} ${a.company ?? ''} ${a.note ?? ''}`.toLowerCase().includes(w)),
    );
  }, [apps, q, filter]);

  if (!apps.length) {
    return (
      <div className="empty">
        <p>
          Nothing here yet. Use <strong>Mark applied</strong> on an offer: it shows up here with its complete ad text. Or add one you sent
          elsewhere:
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
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, company or note…" aria-label="Search applied offers" />
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
          <li key={a.dup_key}>
            <button type="button" className="applied-row" onClick={() => setOpen(a)}>
              <time dateTime={a.applied_at}>{day(a.applied_at)}</time>
              <span className="body">
                <span className="title">{a.title}</span>
                <span className="meta">
                  {a.company && <span>{a.company}</span>}
                  {facts(a.details) && <span>{facts(a.details)}</span>}
                </span>
                {a.note?.trim() && <span className="note-line">📝 {a.note.trim().split('\n')[0]}</span>}
              </span>
              <span className="side">
                <StatusChip stage={a.stage} state={a.stage_state} />
                <span className="src">{labels[a.src] ?? a.src}</span>
                <span className={`status status-${a.content_status}`}>{CONTENT[a.content_status]}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {open && (
        <AdModal
          key={open.dup_key}
          initial={open}
          labels={labels}
          onClose={(note, key) => {
            setOpen(null);
            if (note !== undefined && note !== open.note) setNotes((cur) => ({ ...cur, [key]: note }));
          }}
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

function AppliedStats({ apps, filter, setFilter }: { apps: Application[]; filter: Filter; setFilter: (f: Filter) => void }) {
  const s = useMemo(() => stats(apps), [apps]);
  const pick = (label: string, test: (a: Application) => boolean) => () => setFilter(filter?.label === label ? null : { label, test });
  const on = (label: string) => (filter?.label === label ? 'true' : undefined);

  const tiles = [
    { label: 'Sent', value: s.sent, sub: '', test: () => true, cls: '' },
    { label: 'Positive replies', value: s.positive, sub: pct(s.positive, s.sent), test: (a: Application) => a.stage !== 'submitted', cls: 'good' },
    { label: 'Offers', value: s.offers, sub: pct(s.offers, s.sent), test: (a: Application) => a.stage === 'offer', cls: 'good' },
    { label: 'In progress', value: s.active, sub: '', test: (a: Application) => isActive(a), cls: '' },
    { label: 'Rejected', value: s.rejected, sub: pct(s.rejected, s.sent), test: (a: Application) => isRejected(a), cls: 'bad' },
    { label: 'Ghosted', value: s.ghosted, sub: pct(s.ghosted, s.sent), test: (a: Application) => a.stage_state === 'ghosted', cls: 'bad' },
    { label: stateHeading('pool'), value: s.pool, sub: pct(s.pool, s.sent), test: (a: Application) => a.stage_state === 'pool', cls: 'bad' },
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
                <span className="funnel-bar" style={{ width: `${s.sent ? Math.max(4, (f.count / s.sent) * 100) : 0}%` }} />
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
                  if (!statesFor(st.id).some((y) => y.id === x.id)) return <td key={x.id} className="muted">–</td>;
                  return (
                    <td key={x.id}>
                      {n ? (
                        <button type="button" className="link" aria-pressed={on(label)} onClick={pick(label, (a) => a.stage === st.id && a.stage_state === x.id)}>
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

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const noteValue = (text: string) => (text.trim() ? text : null); // as the database keeps it

async function loadApplication(key: string) {
  const res = await fetch(`/api/application?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as ApplicationWithContent;
}

function AdModal({ initial, labels, onClose }: {
  initial: Application;
  labels: Record<string, string>;
  onClose: (note: string | null | undefined, key: string) => void;
}) {
  const [key, setKey] = useState(initial.dup_key); // an edit can make it another job's (see updateApplication)
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
        if (data.content_status !== 'pending') return;
        await new Promise((r) => setTimeout(r, 3000));
        if (me !== run.current) return;
      }
    } catch (e) {
      if (me === run.current) setLoadError(message(e));
    }
  };

  const opened = useEffectEvent(follow);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    opened();
    return () => {
      run.current++; // closed: stop looking
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
    if (stage === app.stage && state === app.stage_state) return;
    run.current++; // a load already on its way would bring the old status back
    setApp({ ...app, stage, stage_state: state, history: [...(app.history ?? []), { stage, state, at: new Date().toISOString() }] });
    act(async () => {
      const res = await setApplicationStatusAction(key, stage, state);
      if (res.error) throw new Error(res.error);
      await follow();
    });
  };

  // a step clicked by mistake: out of the history with every step after it, the status goes back
  // to the step before
  const removeStep = (i: number) => {
    const all = app.history ?? [];
    const h = all[i];
    const later = all.length - 1 - i;
    if (later > 0 && !confirm(`Remove “${stageOf(h.stage).label} · ${stateLabel(h.stage, h.state)}” of ${day(h.at)} and the ${later === 1 ? 'step' : `${later} steps`} after it?`)) return;
    run.current++;
    const history = all.slice(0, i);
    const last = history[history.length - 1];
    setApp({ ...app, history, stage: last?.stage ?? 'submitted', stage_state: last?.state ?? 'pending' }); // instant
    act(async () => {
      const res = await removeStatusStepAction(key, h);
      if (res.error) throw new Error(res.error);
      await follow();
    });
  };

  // saved in the form: back to the window with it (under its new key, if it's another job's now)
  const saved = (fresh: ApplicationWithContent) => {
    if (fresh.dup_key !== key) {
      moveDraft(key, fresh.dup_key);
      setKey(fresh.dup_key);
    }
    run.current++; // a load on its way would bring the old details back
    setApp(fresh);
    setEditing(false);
    if (fresh.content_status === 'pending') follow(fresh.dup_key);
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
  const waiting = app.content === undefined || app.content_status === 'pending';
  const hasText = app.content_status === 'ok' && !!app.content;

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
      {editing && <ApplicationForm app={app as ApplicationWithContent} onCancel={() => setEditing(false)} onSaved={saved} />}
      {/* hidden, not gone, while editing: the note keeps what you typed */}
      <div className="modal-body" style={editing ? { display: 'none' } : undefined}>
        <div className="sheet-head">
          <h2 id="ad-title">{app.title}</h2>
          <p className="muted">
            {app.company && <>{app.company} · </>}
            {labels[app.src] ?? app.src} · applied {day(app.applied_at)}
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
                  onClick={() => setStatus(st.id, st.id === app.stage ? app.stage_state : 'pending')}
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
                  aria-pressed={app.stage_state === x.id}
                  title={x.hint}
                  onClick={() => setStatus(app.stage, x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
            {(app.history ?? []).length > 0 && (
              // newest first; × takes a step away with the ones after it (above it here), not the first one: applying
              <ol className="timeline" aria-label="History">
                {app.history.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => {
                  const later = app.history.length - 1 - i;
                  return (
                    <li key={`${h.at}|${h.stage}|${h.state}|${i}`}>
                      <time dateTime={h.at}>{day(h.at)}</time>
                      <span>{stageOf(h.stage).label} ·</span>
                      <span className={`state-text state-${h.state}`}>{stateLabel(h.stage, h.state)}</span>
                      {h.auto && <span className="muted" title={`No news for ${GHOST_AFTER_DAYS} days`}>(auto)</span>}
                      {i > 0 && (
                        <button
                          type="button"
                          className="step-remove"
                          title={later ? 'Remove this step and the ones after it' : 'Remove this step (clicked by mistake)'}
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

          <NoteEditor ref={note} appKey={key} initial={initial.note ?? ''} editedAt={app.note_updated_at} />

          {rows.some(([, v]) => v) && (
            <dl className="ad-facts">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className={k === 'Salary' && v!.includes('; ') ? 'wide' : undefined}>
                  <dt>{k}</dt>
                  {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
                  <dd>{v!.split('; ').map((line, i) => <span key={i} className="fact-line">{line}</span>)}</dd>
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
                <div className="skeleton ad-skeleton" role="status" aria-label={app.content_status === 'pending' ? 'Saving the ad text' : 'Loading the ad text'}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} className="bar" style={{ width: `${58 + ((i * 29) % 40)}%` }} />
                  ))}
                </div>
              )
            ) : hasText ? (
              app.content
            ) : (
              <p className="form-error">
                {app.content_status === 'empty' ? 'The board page had no ad text.' : 'Couldn’t fetch the ad.'} {app.content_error}
              </p>
            )}
          </div>
          {app.scraped_at && hasText && <p className="muted small ad-saved">Ad saved {day(app.scraped_at)}.</p>}
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
                  await unapplyAction(key);
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
                    await refetchContentAction(key);
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

type NoteHandle = { flush: () => string | null }; // saves what's left, returns the note
type NoteStatus = 'idle' | 'typing' | 'saving' | 'saved' | 'error';
type Draft = { text: string; base: string }; // base = the saved note it was written over

const draftKey = (key: string) => `jobwatch:note:${key}`;
function readDraft(key: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(key)) ?? 'null');
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

function NoteEditor({ appKey, initial, editedAt, ref }: { appKey: string; initial: string; editedAt: string | null; ref: Ref<NoteHandle> }) {
  // an unsaved draft of this note comes back, unless the note was changed somewhere else since
  const [restored] = useState(() => {
    const d = readDraft(appKey);
    return d && d.base === initial && d.text !== initial ? d.text : initial;
  });
  const [text, setText] = useState(restored);
  const [status, setStatus] = useState<NoteStatus>(restored === initial ? 'idle' : 'typing');
  const latest = useRef(restored); // what's in the box
  const saved = useRef(initial); // what the database has
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void> | null>(null);

  // one save at a time, always of the newest text
  const save = (): Promise<void> => {
    clearTimeout(timer.current);
    if (saving.current) return saving.current.then(save);
    const value = latest.current;
    if (value === saved.current) return Promise.resolve();
    setStatus('saving');
    saving.current = setApplicationNoteAction(appKey, value)
      .then((res) => {
        if (res.error) throw new Error(res.error);
        saved.current = value;
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
      save();
      return noteValue(latest.current);
    },
  }));

  // a restored draft is saved right away; an outdated one is dropped
  const mounted = useEffectEvent(() => (latest.current === saved.current ? writeDraft(appKey, null) : save()));
  useEffect(() => {
    mounted();
  }, []);

  const shownStatus = status === 'idle' && initial && editedAt ? `edited ${day(editedAt)}` : NOTE_STATUS[status];
  return (
    <label className="field note-field">
      <span>
        Note
        {shownStatus && (
          <span className={`note-status${status === 'error' ? ' warn' : ''}`} aria-live="polite">
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
          writeDraft(appKey, value === saved.current ? null : { text: value, base: saved.current });
          setStatus(value === saved.current ? (status === 'idle' ? 'idle' : 'saved') : 'typing');
          clearTimeout(timer.current);
          timer.current = setTimeout(save, 700);
        }}
        onBlur={() => save()}
        placeholder="Recruiter's name, the salary you asked for, what they asked in the interview, next steps…"
      />
    </label>
  );
}
