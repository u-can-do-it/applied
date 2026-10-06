import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/** The add/edit form's header: the form's own, and the one shown while it loads (lazy-application-form.tsx). */
export function ApplicationFormHeader({ editing }: { editing: boolean }) {
  return (
    <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
      <SheetTitle className="text-lg font-semibold">
        {editing ? 'Edit the application' : 'Add an application'}
      </SheetTitle>
      <SheetDescription className="text-[13px]">
        {editing
          ? 'Its status and note stay as they are: they’re set in the window itself.'
          : 'One you sent outside the lists here. Paste its link, or its ad text, to fill in the rest.'}
      </SheetDescription>
    </SheetHeader>
  );
}
