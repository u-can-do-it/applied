'use client';

import { lazy, useImperativeHandle, useState, type Ref } from 'react';
import { LazyForm } from '@/components/lazy-form';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

export type ProfileOption = { id: string; name: string; prompt: string; fileName: string | null; version: number };

export const NEW = '__new__';

/** Under the form (profile-form.tsx), and for screen readers while it loads. */
export const PROFILE_NOTE =
  'Changing the text or the file re-checks this profile’s offers on the next run, unless you keep what it has checked. Renaming or switching profiles keeps what’s already been checked.';

// The form loads when it's first wanted: it brings the form library and the action's schema (zod), which
// the offers page doesn't need until then. Pointing at the profile button starts the download.
export const loadProfileForm = () => import('./profile-form');
const ProfileForm = lazy(() => loadProfileForm().then((module) => ({ default: module.ProfileForm })));

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
  const focus = useReturnFocus();
  const [selected, setSelected] = useState<string>(activeId ?? NEW);
  const [formKey, setFormKey] = useState(0); // a fresh form with the chosen profile's values

  const choose = (id: string) => {
    setSelected(id);
    setFormKey((previous) => previous + 1);
  };

  useImperativeHandle(ref, () => ({
    open() {
      choose(activeId ?? (profiles.length ? profiles[0].id : NEW));
      focus.remember();
      setOpen(true);
    },
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-[560px]"
        showCloseButton={false}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        onInteractOutside={keepOpenOnToast}
      >
        <LazyForm
          header={
            <DialogHeader className="flex-row items-center justify-between gap-3 px-5 pt-5">
              <DialogTitle className="text-lg font-semibold">AI profile</DialogTitle>
              <Skeleton className="h-8 w-40" />
              <DialogDescription className="sr-only">{PROFILE_NOTE}</DialogDescription>
            </DialogHeader>
          }
          // name, what to keep, the file
          fields={['h-8', 'h-[146px]', 'h-9']}
        >
          <ProfileForm
            key={formKey}
            profiles={profiles}
            activeId={activeId}
            selected={selected}
            onChoose={choose}
            onClose={() => setOpen(false)}
          />
        </LazyForm>
      </DialogContent>
    </Dialog>
  );
}
