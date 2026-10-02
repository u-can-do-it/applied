'use client';

import { useActionState, useEffect, useImperativeHandle, useRef, useState, useTransition, type Ref } from 'react';
import { deleteProfileAction, saveProfileAction, selectProfileAction, type FormState } from './actions';

export type ProfileOption = { id: string; name: string; prompt: string; fileName: string | null; version: number };

const NEW = '__new__';

export function ProfileDialog({ profiles, activeId, ref }: {
  profiles: ProfileOption[];
  activeId: string | null;
  ref: Ref<{ open: () => void }>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string>(activeId ?? NEW);
  const [state, save, saving] = useActionState<FormState, FormData>(saveProfileAction, {});
  const [busy, startBusy] = useTransition();
  const [removeFile, setRemoveFile] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form fields with the chosen profile's values

  const profile = profiles.find((p) => p.id === selected) ?? null;

  const choose = (id: string) => {
    setSelected(id);
    setRemoveFile(false);
    setPicked(null);
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
    if (state.ok) dialog.current?.close();
  }, [state]);

  const close = () => dialog.current?.close();

  return (
    <dialog ref={dialog} className="modal" onClick={(e) => e.target === dialog.current && close()}>
      <form action={save} className="modal-body" key={formKey}>
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
          <input name="name" defaultValue={profile?.name ?? ''} placeholder="e.g. Frontend React" required maxLength={80} />
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
          Changing the text or the file re-checks this profile&apos;s offers on the next run. Renaming or switching profiles keeps what&apos;s
          already been checked.
        </p>

        {state.error && <p className="form-error">{state.error}</p>}

        <div className="modal-actions">
          {profile && (
            <button
              type="button"
              className="secondary danger"
              disabled={busy || saving}
              onClick={() => {
                if (!confirm(`Delete “${profile.name}” and everything it has checked?`)) return;
                startBusy(async () => {
                  await deleteProfileAction(profile.id);
                  close();
                });
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
              onClick={() => startBusy(async () => {
                await selectProfileAction(profile.id);
                close();
              })}
            >
              Use without changes
            </button>
          )}
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={saving || busy}>
            {saving ? 'Saving…' : profile ? 'Save & use' : 'Create & use'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
