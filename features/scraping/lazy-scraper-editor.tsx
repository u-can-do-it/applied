'use client';

import { lazy, type ComponentProps } from 'react';
import { LazyForm } from '@/components/lazy-form';
import { keepOpenOnToast } from '@/components/toasts';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { kindOf } from '@/lib/listings/kinds';

// The editor loads when it's first wanted: it brings the form library and the action's schema (zod),
// which Settings doesn't need until then. Pointing at the panel starts the download (scrapers-panel.tsx).
export const loadEditor = () => import('./scraper-editor');
const ScraperEditor = lazy(() => loadEditor().then((module) => ({ default: module.ScraperEditor })));

/** The editor, in a window of the same shape (header, grey fields) while it loads. */
export function LazyScraperEditor(props: ComponentProps<typeof ScraperEditor>) {
  const { initial, onClose } = props;
  return (
    <LazyForm
      frame={(content) => (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
          <SheetContent
            className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]"
            onInteractOutside={keepOpenOnToast}
          >
            {content}
          </SheetContent>
        </Sheet>
      )}
      header={
        <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
          <SheetTitle className="text-lg font-semibold">{initial.id ? initial.name : 'New scraper'}</SheetTitle>
          <SheetDescription className="text-[13px]">{kindOf(initial.kind).hint}</SheetDescription>
        </SheetHeader>
      }
      // type / name / board id, link, headers, the mapping
      fields={['h-8', 'h-14', 'h-14', 'h-40']}
    >
      <ScraperEditor {...props} />
    </LazyForm>
  );
}
