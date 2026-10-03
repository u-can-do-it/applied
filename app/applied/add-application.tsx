'use client';

import { startTransition, useEffect, useRef, useState, useTransition } from 'react';
import type { ApplicationWithContent } from '@/lib/applications';
import { BOARD_SUGGESTIONS, boardOf, isLink } from '@/lib/boards';
import type { Zone } from '@/lib/dates';
import { message } from '@/lib/shared/errors';
import { fail } from '@/lib/shared/result';
import type { ApplicationInput } from '@/lib/shared/schemas/applications';
import { STAGES, statesFor, type StageId, type StateId } from '@/lib/stages';
import { addApplicationAction, fillFromLinkAction, updateApplicationAction } from '../actions';
import { DateInput } from '../controls';
import { useZone } from '../time-zone';

// "+ Add application": an application you sent somewhere the scrapers don't see (or before they
// did). Paste the link and "Fill in" reads the page (with the AI, if there's a key); everything
// stays editable. The window has the applied offer's layout: fixed height, the middle scrolls.
// The same form edits an application in its own window ("✎ Edit"), without the status and the
// note: the window has those.

type Draft = ApplicationInput; // what the form sends
type Field = keyof Draft;

const empty = (z: Zone): Draft => ({
  url: '',
  title: '',
  company: '',
  board: 'unknown',
  day: z.day(),
  stage: 'submitted',
  state: 'pending',
  salary: '',
  contract: '',
  location: '',
  remote: false,
  content: '',
  note: '',
});

/** An applied offer as the form shows it. */
const draftOf = (a: ApplicationWithContent, z: Zone): Draft => ({
  url: a.url,
  title: a.title,
  company: a.company ?? '',
  board: a.src,
  day: z.day(a.applied_at),
  stage: a.stage,
  state: a.stage_state,
  salary: a.details?.salary ?? '',
  contract: a.details?.contract ?? '',
  location: a.details?.location ?? '',
  remote: Boolean(a.details?.remote),
  content: a.content ?? '',
  note: '',
});

export function AddApplication() {
  const [n, setN] = useState(0); // a fresh form each time
  return (
    <>
      <button type="button" className="secondary add-app" onClick={() => setN((x) => x + 1)}>
        + Add application
      </button>
      {n > 0 && <AddDialog key={n} onClose={() => setN(0)} />}
    </>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal modal-wide modal-sheet"
      aria-labelledby="add-title"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      {/* saved: closes together with the refreshed list, so the new one is there when it does */}
      <ApplicationForm onCancel={() => dialog.current?.close()} onSaved={onClose} />
    </dialog>
  );
}

type FormProps =
  | { app?: undefined; onCancel: () => void; onSaved: () => void }
  | { app: ApplicationWithContent; onCancel: () => void; onSaved: (saved: ApplicationWithContent) => void };

/** The form without a window around it: a new application, or `app` to edit. */
export function ApplicationForm(props: FormProps) {
  const editing = props.app !== undefined;
  const z = useZone();
  const [d, setD] = useState<Draft>(() => (props.app ? draftOf(props.app, z) : empty(z)));
  const touched = useRef(new Set<Field>()); // what you typed: "Fill in" doesn't overwrite it
  const [filling, startFill] = useTransition();
  const [saving, startSave] = useTransition();
  const [info, setInfo] = useState<{ warning?: string; known?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<Draft>) => {
    for (const k of Object.keys(patch) as Field[]) touched.current.add(k);
    setD((x) => ({ ...x, ...patch }));
  };
  const onLink = (url: string) =>
    setD((x) => ({
      ...x,
      url,
      // the board follows the link until you pick one yourself
      board: touched.current.has('board') ? x.board : isLink(url) ? boardOf(url) : x.board,
    }));

  const fill = () => {
    setError(null);
    setInfo(null);
    startFill(async () => {
      const r = await fillFromLinkAction({ link: d.url }).catch((e: unknown) => fail(message(e)));
      startTransition(() => {
        if (!r.ok) {
          setError(r.error);
          return;
        }
        const f = r.data;
        setD((x) => {
          const next = { ...x };
          // what you typed stays; when editing, so does everything already filled in
          const free = (k: Field) =>
            !touched.current.has(k) && (!editing || next[k] === '' || (k === 'board' && next[k] === 'unknown'));
          const put = <K extends Field>(k: K, v: Draft[K]) => {
            if (free(k) && v !== '') next[k] = v;
          };
          put('url', f.url);
          put('board', f.board);
          put('title', f.title);
          put('company', f.company);
          put('location', f.location);
          put('salary', f.salary);
          put('contract', f.contract);
          put('content', f.content);
          if (!touched.current.has('remote') && (!editing || !next.remote)) next.remote = f.remote;
          return next;
        });
        // editing one that's this scraped offer already: nothing to say
        setInfo({ warning: f.warning, known: f.knownKey && f.knownKey === props.app?.dup_key ? null : f.known });
      });
    });
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const failed = (e: unknown) => fail(message(e));
      if (props.app) {
        const { url, title, company, board, day, salary, contract, location, remote, content } = d; // not the status, not the note
        const r = await updateApplicationAction({
          key: props.app.dup_key,
          input: { url, title, company, board, day, salary, contract, location, remote, content },
        }).catch(failed);
        const onSaved = props.onSaved;
        startTransition(() => (r.ok ? onSaved(r.data) : setError(r.error)));
      } else {
        const r = await addApplicationAction(d).catch(failed);
        const onSaved = props.onSaved;
        startTransition(() => (r.ok ? onSaved() : setError(r.error)));
      }
    });
  };

  const text = (k: Field, extra: Record<string, unknown> = {}) => ({
    value: d[k] as string,
    // eslint-disable-next-line react-hooks/refs -- an event handler; the compiler can't tell through the spread into props
    onChange: (e: { target: { value: string } }) => edit({ [k]: e.target.value }),
    ...extra,
  });

  return (
    <div className="modal-body">
      <div className="sheet-head">
        {editing ? (
          <>
            <h2 id="edit-title">Edit the application</h2>
            <p className="muted">Its status and note stay as they are: they’re set in the window itself.</p>
          </>
        ) : (
          <>
            <h2 id="add-title">Add an application</h2>
            <p className="muted">One you sent outside the lists here. Paste its link to fill in the rest.</p>
          </>
        )}
      </div>

      <div className="sheet-scroll">
        <div className="link-row">
          <label className="field">
            <span>Link to the offer</span>
            <input
              value={d.url}
              onChange={(e) => onLink(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              spellCheck={false}
              autoFocus
            />
          </label>
          <button type="button" onClick={fill} disabled={!isLink(d.url) || filling} aria-busy={filling || undefined}>
            {filling ? 'Reading the page…' : '✦ Fill in from the link'}
          </button>
        </div>
        {editing && (
          <p className="small muted">“Fill in” fills only the empty fields: clear one to have it filled in again.</p>
        )}
        {info?.known && (
          <p className="small ok-text">
            {editing
              ? `This link is a scraped offer: ${info.known}. Saving joins the application to it.`
              : `This offer is among the scraped ones: ${info.known}. The application joins it.`}
          </p>
        )}
        {info?.warning && <p className="small warn">{info.warning}</p>}

        <div className="field-row">
          <label className="field">
            <span>Title *</span>
            <input {...text('title', { placeholder: 'Senior Frontend Developer' })} />
          </label>
          <label className="field">
            <span>Company</span>
            <input {...text('company')} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Board</span>
            <input {...text('board', { list: 'boards', spellCheck: false })} />
            <datalist id="boards">
              {BOARD_SUGGESTIONS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <DateInput label="Applied on" value={d.day} max={z.day()} onCommit={(day) => edit({ day })} />
        </div>
        {!editing && (
          <div className="field-row">
            <label className="field">
              <span>Stage</span>
              <select
                value={d.stage}
                onChange={(e) => {
                  const stage = e.target.value as StageId;
                  // an offer has no "ghosted" or talent pool
                  edit(statesFor(stage).some((x) => x.id === d.state) ? { stage } : { stage, state: 'pending' });
                }}
              >
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Outcome</span>
              <select value={d.state} onChange={(e) => edit({ state: e.target.value as StateId })}>
                {statesFor(d.stage).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span>Salary</span>
            <input {...text('salary', { placeholder: '20 000–25 000 PLN / month (B2B)' })} />
          </label>
          <label className="field">
            <span>Contract</span>
            <input {...text('contract', { placeholder: 'B2B' })} />
          </label>
          <label className="field">
            <span>Location</span>
            <input {...text('location', { placeholder: 'Warszawa' })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={d.remote} onChange={(e) => edit({ remote: e.target.checked })} /> Remote
        </label>
        <label className="field">
          <span>Ad text</span>
          <textarea {...text('content', { rows: 8, placeholder: 'Filled in from the link, or paste it' })} />
          <small>
            Kept with the application, so you can read it after the board takes the ad down.
            {!d.content.trim() && d.url && ' Left empty, it’s fetched from the link after saving.'}
          </small>
        </label>
        {!editing && (
          <label className="field">
            <span>Note</span>
            <textarea
              {...text('note', {
                rows: 3,
                maxLength: 10_000,
                placeholder: 'Recruiter, the salary you asked for, next steps…',
              })}
            />
          </label>
        )}
      </div>

      <div className="sheet-foot">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving || !d.title.trim()} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
