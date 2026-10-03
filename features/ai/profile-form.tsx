'use client';

import { startTransition, useId, useTransition } from 'react';
import { useSelector } from '@tanstack/react-form';
import { PaperclipIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { answered, checkOnSubmit, FormError, formSchema, useAppForm } from '@/components/form';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { FieldError } from '@/components/field';
import { firstError } from '@/components/form-fields';
import type { Result } from '@/lib/shared/result';
import { profileSchema } from '@/lib/shared/schemas/ai';
import { deleteProfileAction, saveProfileAction, selectProfileAction } from './actions';
import { NEW, PROFILE_NOTE, type ProfileOption } from './profile-dialog';

/** What the form holds: the action's FormData fields (removeFile: 'on' to remove the saved file). */
type ProfileValues = { profileId: string; name: string; prompt: string; file: File | undefined; removeFile: string };

/** The profile picked in the dialog, to edit (or a new one): saved, it becomes the active profile. */
export function ProfileForm({
  profiles,
  activeId,
  selected,
  onChoose,
  onClose,
}: {
  profiles: ProfileOption[];
  activeId: string | null;
  selected: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const fileId = useId();
  const [busy, startBusy] = useTransition();
  const profile = profiles.find((option) => option.id === selected) ?? null;

  const initial: ProfileValues = {
    profileId: profile?.id ?? '',
    name: profile?.name ?? '',
    prompt: profile?.prompt ?? '',
    file: undefined,
    removeFile: '',
  };
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: checkOnSubmit,
    validators: { onDynamic: formSchema<typeof profileSchema, ProfileValues>(profileSchema) },
    onSubmit: async ({ value, formApi }) => {
      // the file is uploaded with the rest: FormData, as a <form action> would send it
      const data = new FormData();
      data.set('profileId', value.profileId);
      data.set('name', value.name);
      data.set('prompt', value.prompt);
      if (value.file) data.set('file', value.file);
      else if (value.removeFile) data.set('removeFile', 'on');
      const answer = await answered(formApi, saveProfileAction(null, data));
      // lands with the refreshed page (the action refreshes it with the new active profile)
      if (answer.ok) startTransition(onClose);
    },
  });
  const picked = useSelector(form.store, (state) => state.values.file);
  const removing = useSelector(form.store, (state) => state.values.removeFile === 'on');
  const saving = useSelector(form.store, (state) => state.isSubmitting);

  // Delete / Use without changes: the dialog closes once done, or says what went wrong
  const runAndClose = (fn: () => Promise<Result<unknown>>) =>
    startBusy(async () => {
      const answer = await answered(form, fn());
      if (answer.ok) onClose();
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
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
      className="flex flex-col gap-3.5 p-5"
    >
      <DialogHeader className="flex-row items-center justify-between gap-3">
        <DialogTitle className="text-lg font-semibold">AI profile</DialogTitle>
        <NativeSelect
          aria-label="Profile"
          value={selected}
          onChange={(event) => onChoose(event.target.value)}
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

      <form.AppField name="name">
        {(field) => <field.TextField label="Name" placeholder="e.g. Frontend React" maxLength={80} />}
      </form.AppField>

      <form.AppField name="prompt">
        {(field) => (
          <field.TextareaField
            label="What should it keep?"
            rows={6}
            controlClassName="field-sizing-fixed resize-y"
            placeholder="e.g. Senior or mid frontend roles with React. No Angular, no .NET or Java backends. Remote, or hybrid in Warsaw. Skip agencies and body leasing."
          />
        )}
      </form.AppField>

      <form.Field name="file">
        {(field) => {
          const error = firstError(field.state.meta.errors);
          return (
            <div className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
              <span id={`${fileId}-label`}>
                CV or notes (optional) – PDF / TXT / MD, up to 5 MB. Used for the % fit.
              </span>
              {profile?.fileName && !picked && (
                <p className="m-0 flex items-center gap-1 text-foreground">
                  <span className={removing ? 'line-through' : undefined}>
                    <PaperclipIcon /> {profile.fileName}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="h-auto"
                    onClick={() => form.setFieldValue('removeFile', removing ? '' : 'on')}
                  >
                    {removing ? 'will be removed · undo' : 'remove'}
                  </Button>
                </p>
              )}
              <Input
                type="file"
                name="file"
                aria-labelledby={`${fileId}-label`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${fileId}-error` : undefined}
                accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                onChange={(event) => field.handleChange(event.target.files?.[0])}
                className="h-auto py-1.5 text-foreground"
              />
              {picked && profile?.fileName && <p className="m-0 text-xs">Replaces {profile.fileName}.</p>}
              <FieldError id={`${fileId}-error`} error={error} />
            </div>
          );
        }}
      </form.Field>

      <DialogDescription className="text-xs">{PROFILE_NOTE}</DialogDescription>

      <FormError form={form} className="mt-0" />

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
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || busy} aria-busy={saving || undefined}>
          {saving ? 'Saving…' : profile ? 'Save & use' : 'Create & use'}
        </Button>
      </DialogFooter>
    </form>
  );
}
