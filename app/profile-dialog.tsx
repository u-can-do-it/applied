'use client';

import {
  startTransition,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
  type SubmitEvent,
  type Ref,
} from 'react';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';
import { deleteProfileAction, saveProfileAction, selectProfileAction } from './actions';

export type ProfileOption = { id: string; name: string; prompt: string; fileName: string | null; version: number };

const NEW = '__new__';

export function ProfileDialog({
  profiles,
  activeId,
  ref,
}: {
  profiles: ProfileOption[];
  activeId: string | null;
  ref: Ref<{ open: () => void }>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string>(activeId ?? NEW);
  // onSubmit, not <form action>: React resets a form after its action, which would throw away
  // what you typed whenever the save fails (e.g. a file that's too big)
  const [state, setState] = useState<Result<unknown> | null>(null);
  const [saving, startSave] = useTransition();
  const save = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setState(null);
    startSave(async () => {
      const answer = await saveProfileAction(null, data).catch((err: unknown) => fail(message(err)));
      startTransition(() => setState(answer)); // lands with the refreshed page; then the effect below closes
    });
  };
  const [busy, startBusy] = useTransition();
  const [removeFile, setRemoveFile] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form fields with the chosen profile's values

  const profile = profiles.find((p) => p.id === selected) ?? null;

  const choose = (id: string) => {
    setSelected(id);
    setRemoveFile(false);
    setPicked(null);
    setState(null); // no message from the last save
    setFormKey((k) => k + 1);
  };

  useImperativeHandle(ref, () => ({
    open() {
      choose(activeId ?? (profiles.length ? profiles[0].id : NEW));
      dialog.current?.showModal();
    },
  }));

  // close once saved; the action refreshes the page with the new active profile
  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);

  const close = () => dialog.current?.close();
  // Delete / Use without changes: the dialog closes once done, or says what went wrong
  const runAndClose = (fn: () => Promise<Result<unknown>>) =>
    startBusy(async () => {
      const answer = await fn().catch((err: unknown) => fail(message(err)));
      if (answer.ok) close();
      else startTransition(() => setState(answer));
    });

  return (
    <dialog ref={dialog} className="modal" onClick={(e) => e.target === dialog.current && close()}>
      <form onSubmit={save} className="modal-body" key={formKey}>
        <div className="modal-head">
          <h2>AI profile</h2>
          <select
            aria-label="Profile"
            value={selected}
            onChange={(e) => choose(e.target.value)}
            className="profile-select"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === activeId ? ' (active)' : ''}
              </option>
            ))}
            <option value={NEW}>+ New profile</option>
          </select>
        </div>

        <input type="hidden" name="profileId" value={profile?.id ?? ''} />

        <label className="field">
          <span>Name</span>
          <input
            name="name"
            defaultValue={profile?.name ?? ''}
            placeholder="e.g. Frontend React"
            required
            maxLength={80}
          />
        </label>

        <label className="field">
          <span>What should it keep?</span>
          <textarea
            name="prompt"
            rows={6}
            defaultValue={profile?.prompt ?? ''}
            placeholder="e.g. Senior or mid frontend roles with React. No Angular, no .NET or Java backends. Remote, or hybrid in Warsaw. Skip agencies and body leasing."
          />
        </label>

        <div className="field">
          <span>CV or notes (optional) – PDF / TXT / MD, up to 5 MB. Used for the % fit.</span>
          {profile?.fileName && !picked && (
            <p className="file-row">
              {removeFile ? <s>📎 {profile.fileName}</s> : <>📎 {profile.fileName}</>}
              <button type="button" className="link" onClick={() => setRemoveFile(!removeFile)}>
                {removeFile ? 'will be removed · undo' : 'remove'}
              </button>
            </p>
          )}
          {removeFile && !picked && <input type="hidden" name="removeFile" value="on" />}
          <input
            type="file"
            name="file"
            accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
            onChange={(e) => setPicked(e.target.files?.[0]?.name ?? null)}
          />
          {picked && profile?.fileName && <p className="muted small">Replaces {profile.fileName}.</p>}
        </div>

        <p className="muted small">
          Changing the text or the file re-checks this profile&apos;s offers on the next run. Renaming or switching
          profiles keeps what&apos;s already been checked.
        </p>

        {state?.ok === false && <p className="form-error">{state.error}</p>}

        <div className="modal-actions">
          {profile && (
            <button
              type="button"
              className="secondary danger"
              disabled={busy || saving}
              aria-busy={busy || undefined}
              onClick={() => {
                if (!confirm(`Delete “${profile.name}” and everything it has checked?`)) return;
                runAndClose(() => deleteProfileAction({ id: profile.id }));
              }}
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          {profile && profile.id !== activeId && (
            <button
              type="button"
              className="secondary"
              disabled={busy || saving}
              aria-busy={busy || undefined}
              onClick={() => runAndClose(() => selectProfileAction({ id: profile.id }))}
            >
              Use without changes
            </button>
          )}
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={saving || busy} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : profile ? 'Save & use' : 'Create & use'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
