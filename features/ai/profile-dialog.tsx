'use client';

import { startTransition, useImperativeHandle, useState, useTransition, type SubmitEvent, type Ref } from 'react';
import { PaperclipIcon, TriangleAlertIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/field';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';
import { deleteProfileAction, saveProfileAction, selectProfileAction } from './actions';

export type ProfileOption = { id: string; name: string; prompt: string; fileName: string | null; version: number };

const NEW = '__new__';

// A Dialog, not a side panel: a short form you fill in and close, about the list behind it as a whole.
export function ProfileDialog({
  profiles,
  activeId,
  ref,
}: {
  profiles: ProfileOption[];
  activeId: string | null;
  ref: Ref<{ open: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const focus = useReturnFocus();
  const [selected, setSelected] = useState<string>(activeId ?? NEW);
  // onSubmit, not <form action>: React resets a form after its action, which would throw away
  // what you typed whenever the save fails (e.g. a file that's too big)
  const [state, setState] = useState<Result<unknown> | null>(null);
  const [saving, startSave] = useTransition();
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setState(null);
    startSave(async () => {
      const answer = await saveProfileAction(null, data).catch((err: unknown) => fail(message(err)));
      // lands with the refreshed page (the action refreshes it with the new active profile)
      startTransition(() => {
        setState(answer);
        if (answer.ok) setOpen(false);
      });
    });
  };
  const [busy, startBusy] = useTransition();
  const [removeFile, setRemoveFile] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form fields with the chosen profile's values

  const profile = profiles.find((option) => option.id === selected) ?? null;

  const choose = (id: string) => {
    setSelected(id);
    setRemoveFile(false);
    setPicked(null);
    setState(null); // no message from the last save
    setFormKey((previous) => previous + 1);
  };

  useImperativeHandle(ref, () => ({
    open() {
      choose(activeId ?? (profiles.length ? profiles[0].id : NEW));
      focus.remember();
      setOpen(true);
    },
  }));

  // Delete / Use without changes: the dialog closes once done, or says what went wrong
  const runAndClose = (fn: () => Promise<Result<unknown>>) =>
    startBusy(async () => {
      const answer = await fn().catch((err: unknown) => fail(message(err)));
      if (answer.ok) setOpen(false);
      else startTransition(() => setState(answer));
    });

  const remove = async ({ id, name }: ProfileOption) => {
    const yes = await confirm({
      title: `Delete “${name}”?`,
      description: 'Everything it has checked goes with it.',
      action: 'Delete',
      destructive: true,
    });
    if (yes) runAndClose(() => deleteProfileAction({ id }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-[560px]"
        showCloseButton={false}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        onInteractOutside={keepOpenOnToast}
      >
        <form onSubmit={save} className="flex flex-col gap-3.5 p-5" key={formKey}>
          <DialogHeader className="flex-row items-center justify-between gap-3">
            <DialogTitle className="text-lg font-semibold">AI profile</DialogTitle>
            <NativeSelect
              aria-label="Profile"
              value={selected}
              onChange={(event) => choose(event.target.value)}
              className="max-w-[60%]"
            >
              {profiles.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.name}
                  {option.id === activeId ? ' (active)' : ''}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value={NEW}>+ New profile</NativeSelectOption>
            </NativeSelect>
          </DialogHeader>

          <input type="hidden" name="profileId" value={profile?.id ?? ''} />

          <Field label="Name">
            <Input
              name="name"
              defaultValue={profile?.name ?? ''}
              placeholder="e.g. Frontend React"
              required
              maxLength={80}
            />
          </Field>

          <Field label="What should it keep?">
            <Textarea
              name="prompt"
              rows={6}
              defaultValue={profile?.prompt ?? ''}
              className="field-sizing-fixed resize-y"
              placeholder="e.g. Senior or mid frontend roles with React. No Angular, no .NET or Java backends. Remote, or hybrid in Warsaw. Skip agencies and body leasing."
            />
          </Field>

          <div className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
            <span>CV or notes (optional) – PDF / TXT / MD, up to 5 MB. Used for the % fit.</span>
            {profile?.fileName && !picked && (
              <p className="m-0 flex items-center gap-1 text-foreground">
                <span className={removeFile ? 'line-through' : undefined}>
                  <PaperclipIcon /> {profile.fileName}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto"
                  onClick={() => setRemoveFile(!removeFile)}
                >
                  {removeFile ? 'will be removed · undo' : 'remove'}
                </Button>
              </p>
            )}
            {removeFile && !picked && <input type="hidden" name="removeFile" value="on" />}
            <Input
              type="file"
              name="file"
              aria-label="CV or notes"
              accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
              onChange={(event) => setPicked(event.target.files?.[0]?.name ?? null)}
              className="h-auto py-1.5 text-foreground"
            />
            {picked && profile?.fileName && <p className="m-0 text-xs">Replaces {profile.fileName}.</p>}
          </div>

          <DialogDescription className="text-xs">
            Changing the text or the file re-checks this profile&apos;s offers on the next run. Renaming or switching
            profiles keeps what&apos;s already been checked.
          </DialogDescription>

          {state?.ok === false && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{state.error}</AlertTitle>
            </Alert>
          )}

          <DialogFooter className="mx-0 mb-0 flex-row flex-wrap items-center rounded-none border-0 bg-transparent p-0">
            {profile && (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                disabled={busy || saving}
                aria-busy={busy || undefined}
                onClick={() => void remove(profile)}
              >
                Delete
              </Button>
            )}
            {profile && profile.id !== activeId && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || saving}
                aria-busy={busy || undefined}
                onClick={() => runAndClose(() => selectProfileAction({ id: profile.id }))}
              >
                Use without changes
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || busy} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : profile ? 'Save & use' : 'Create & use'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
