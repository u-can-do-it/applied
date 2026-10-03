'use client';

import { startTransition, useEffect, useRef, useState, useTransition } from 'react';
import type { ApplicationWithContent } from '@/lib/applications';
import { BOARD_SUGGESTIONS, boardOf, isLink } from '@/lib/boards';
import type { Zone } from '@/lib/dates';
import { message } from '@/lib/shared/errors';
import { fail } from '@/lib/shared/result';
import type { ApplicationInput } from '@/lib/shared/schemas/applications';
import { STAGES, outcomesFor, type StageId, type OutcomeId } from '@/lib/stages';
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

const empty = (zone: Zone): Draft => ({
  url: '',
  title: '',
  company: '',
  board: 'unknown',
  day: zone.day(),
  stage: 'submitted',
  outcome: 'pending',
  salary: '',
  contract: '',
  location: '',
  remote: false,
  content: '',
  note: '',
});

/** An applied offer as the form shows it. */
const draftOf = (application: ApplicationWithContent, zone: Zone): Draft => ({
  url: application.url,
  title: application.title,
  company: application.company ?? '',
  board: application.src,
  day: zone.day(application.appliedAt),
  stage: application.stage,
  outcome: application.outcome,
  salary: application.details?.salary ?? '',
  contract: application.details?.contract ?? '',
  location: application.details?.location ?? '',
  remote: Boolean(application.details?.remote),
  content: application.content ?? '',
  note: '',
});

export function AddApplication() {
  const [formKey, setFormKey] = useState(0); // a fresh form each time
  return (
    <>
      <button type="button" className="secondary add-app" onClick={() => setFormKey((previous) => previous + 1)}>
        + Add application
      </button>
      {formKey > 0 && <AddDialog key={formKey} onClose={() => setFormKey(0)} />}
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
      onClick={(event) => event.target === dialog.current && dialog.current.close()}
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
  const zone = useZone();
  const [draft, setDraft] = useState<Draft>(() => (props.app ? draftOf(props.app, zone) : empty(zone)));
  const touched = useRef(new Set<Field>()); // what you typed: "Fill in" doesn't overwrite it
  const [filling, startFill] = useTransition();
  const [saving, startSave] = useTransition();
  const [info, setInfo] = useState<{ warning?: string; known?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<Draft>) => {
    for (const field of Object.keys(patch) as Field[]) touched.current.add(field);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const onLink = (url: string) =>
    setDraft((current) => ({
      ...current,
      url,
      // the board follows the link until you pick one yourself
      board: touched.current.has('board') ? current.board : isLink(url) ? boardOf(url) : current.board,
    }));

  const fill = () => {
    setError(null);
    setInfo(null);
    startFill(async () => {
      const answer = await fillFromLinkAction({ link: draft.url }).catch((failure: unknown) => fail(message(failure)));
      startTransition(() => {
        if (!answer.ok) {
          setError(answer.error);
          return;
        }
        const filled = answer.data;
        setDraft((current) => {
          const next = { ...current };
          // what you typed stays; when editing, so does everything already filled in
          const free = (field: Field) =>
            !touched.current.has(field) &&
            (!editing || next[field] === '' || (field === 'board' && next[field] === 'unknown'));
          const put = <K extends Field>(field: K, value: Draft[K]) => {
            if (free(field) && value !== '') next[field] = value;
          };
          put('url', filled.url);
          put('board', filled.board);
          put('title', filled.title);
          put('company', filled.company);
          put('location', filled.location);
          put('salary', filled.salary);
          put('contract', filled.contract);
          put('content', filled.content);
          if (!touched.current.has('remote') && (!editing || !next.remote)) next.remote = filled.remote;
          return next;
        });
        // editing one that's this scraped offer already: nothing to say
        setInfo({
          warning: filled.warning,
          known: filled.knownJobId && filled.knownJobId === props.app?.jobId ? null : filled.known,
        });
      });
    });
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const failed = (failure: unknown) => fail(message(failure));
      if (props.app) {
        const { url, title, company, board, day, salary, contract, location, remote, content } = draft; // not the status, not the note
        const answer = await updateApplicationAction({
          jobId: props.app.jobId,
          input: { url, title, company, board, day, salary, contract, location, remote, content },
        }).catch(failed);
        const onSaved = props.onSaved;
        startTransition(() => (answer.ok ? onSaved(answer.data) : setError(answer.error)));
      } else {
        const answer = await addApplicationAction(draft).catch(failed);
        const onSaved = props.onSaved;
        startTransition(() => (answer.ok ? onSaved() : setError(answer.error)));
      }
    });
  };

  const text = (field: Field, extra: Record<string, unknown> = {}) => ({
    value: draft[field] as string,
    // eslint-disable-next-line react-hooks/refs -- an event handler; the compiler can't tell through the spread into props
    onChange: (event: { target: { value: string } }) => edit({ [field]: event.target.value }),
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
              value={draft.url}
              onChange={(event) => onLink(event.target.value)}
              placeholder="https://…"
              inputMode="url"
              spellCheck={false}
              autoFocus
            />
          </label>
          <button
            type="button"
            onClick={fill}
            disabled={!isLink(draft.url) || filling}
            aria-busy={filling || undefined}
          >
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
          <DateInput label="Applied on" value={draft.day} max={zone.day()} onCommit={(day) => edit({ day })} />
        </div>
        {!editing && (
          <div className="field-row">
            <label className="field">
              <span>Stage</span>
              <select
                value={draft.stage}
                onChange={(event) => {
                  const stage = event.target.value as StageId;
                  // an offer has no "ghosted" or talent pool
                  edit(
                    outcomesFor(stage).some((outcome) => outcome.id === draft.outcome)
                      ? { stage }
                      : { stage, outcome: 'pending' },
                  );
                }}
              >
                {STAGES.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Outcome</span>
              <select value={draft.outcome} onChange={(event) => edit({ outcome: event.target.value as OutcomeId })}>
                {outcomesFor(draft.stage).map((outcome) => (
                  <option key={outcome.id} value={outcome.id}>
                    {outcome.label}
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
          <input type="checkbox" checked={draft.remote} onChange={(event) => edit({ remote: event.target.checked })} />{' '}
          Remote
        </label>
        <label className="field">
          <span>Ad text</span>
          <textarea {...text('content', { rows: 8, placeholder: 'Filled in from the link, or paste it' })} />
          <small>
            Kept with the application, so you can read it after the board takes the ad down.
            {!draft.content.trim() && draft.url && ' Left empty, it’s fetched from the link after saving.'}
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
          <button type="button" onClick={save} disabled={saving || !draft.title.trim()} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
