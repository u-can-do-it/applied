'use client';

import { startTransition, useEffect, useRef, useState, useTransition } from 'react';
import { BOARD_SUGGESTIONS, boardOf, isLink } from '@/lib/boards';
import { todayInWarsaw } from '@/lib/dates';
import { STAGES, STATES, type StageId, type StateId } from '@/lib/stages';
import { addApplicationAction, fillFromLinkAction, type ApplicationInput } from '../actions';
import { DateInput } from '../controls';

// "+ Add application": an application you sent somewhere the scrapers don't see (or before they
// did). Paste the link and "Fill in" reads the page (with the AI, if there's a key); everything
// stays editable. The window has the applied offer's layout: fixed height, the middle scrolls.

type Draft = Omit<ApplicationInput, 'stage' | 'state'> & { stage: StageId; state: StateId };
type Field = keyof Draft;

const empty = (): Draft => ({
  url: '', title: '', company: '', board: 'unknown', day: todayInWarsaw(), stage: 'submitted', state: 'pending',
  salary: '', contract: '', location: '', remote: false, content: '', note: '',
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
  const [d, setD] = useState<Draft>(empty);
  const touched = useRef(new Set<Field>()); // what you typed: "Fill in" doesn't overwrite it
  const [filling, startFill] = useTransition();
  const [saving, startSave] = useTransition();
  const [info, setInfo] = useState<{ warning?: string; known?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

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
      const r = await fillFromLinkAction(d.url).catch((e) => ({ error: e instanceof Error ? e.message : String(e), draft: undefined }));
      startTransition(() => {
        if (!r.draft) return setError(r.error ?? 'Couldn’t read the page.');
        const f = r.draft;
        setD((x) => {
          const next = { ...x };
          const put = <K extends Field>(k: K, v: Draft[K]) => {
            if (!touched.current.has(k) && v !== '' && v !== undefined) next[k] = v;
          };
          put('url', f.url);
          put('board', f.board);
          put('title', f.title);
          put('company', f.company);
          put('location', f.location);
          put('salary', f.salary);
          put('contract', f.contract);
          put('content', f.content);
          if (!touched.current.has('remote')) next.remote = f.remote;
          return next;
        });
        setInfo({ warning: f.warning, known: f.known });
      });
    });
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const r = await addApplicationAction(d).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
      // closes together with the refreshed list, so the new one is there when it does
      startTransition(() => (r.error ? setError(r.error) : onClose()));
    });
  };

  const text = (k: Field, extra: Record<string, unknown> = {}) => ({
    value: d[k] as string,
    onChange: (e: { target: { value: string } }) => edit({ [k]: e.target.value } as Partial<Draft>),
    ...extra,
  });

  return (
    <dialog
      ref={dialog}
      className="modal modal-wide modal-sheet"
      aria-labelledby="add-title"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="modal-body">
        <div className="sheet-head">
          <h2 id="add-title">Add an application</h2>
          <p className="muted">One you sent outside the lists here. Paste its link to fill in the rest.</p>
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
          {info?.known && <p className="small ok-text">This offer is among the scraped ones: {info.known}. The application joins it.</p>}
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
            <DateInput label="Applied on" value={d.day} max={todayInWarsaw()} onCommit={(day) => edit({ day })} />
          </div>
          <div className="field-row">
            <label className="field">
              <span>Stage</span>
              <select value={d.stage} onChange={(e) => edit({ stage: e.target.value as StageId })}>
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
                {STATES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
            <small>Kept with the application, so you can read it after the board takes the ad down.{!d.content && d.url && ' Left empty, it’s fetched from the link after saving.'}</small>
          </label>
          <label className="field">
            <span>Note</span>
            <textarea {...text('note', { rows: 3, maxLength: 10_000, placeholder: 'Recruiter, the salary you asked for, next steps…' })} />
          </label>
        </div>

        <div className="sheet-foot">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <span className="spacer" />
            <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving || !d.title.trim()} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
