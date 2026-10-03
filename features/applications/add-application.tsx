'use client';

import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApplicationForm } from './application-form';

// "+ Add application": an application you sent somewhere the scrapers don't see (or before they
// did). Paste the link and "Fill in" reads the page (with the AI, if there's a key); everything
// stays editable. The window is a side panel like the applied offer's: the middle scrolls.

export function AddApplication() {
  const [formKey, setFormKey] = useState(0); // a fresh form each time
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-8 bg-card dark:bg-card"
        onClick={() => setFormKey((previous) => previous + 1)}
      >
        <PlusIcon /> Add application
      </Button>
      {formKey > 0 && <AddDialog key={formKey} onClose={() => setFormKey(0)} />}
    </>
  );
}

// A side panel, as the applied offer's window: a long form, and with the ad text it reads like a page.
function AddDialog({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const focus = useReturnFocus();
  return (
    // Escape, a click outside and Cancel close it (what was typed goes with it, as before)
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]"
        onInteractOutside={keepOpenOnToast}
        onCloseAutoFocus={(event) => {
          focus.onCloseAutoFocus(event);
          onClose();
        }}
      >
        {/* saved: closes together with the refreshed list, so the new one is there when it does */}
        <ApplicationForm onCancel={() => setOpen(false)} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
