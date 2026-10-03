'use client';

import { startTransition, useEffect, useEffectEvent, useState, useTransition } from 'react';
import { useSelector } from '@tanstack/react-form';
import { useConfirm } from '@/components/confirm';
import { answered, checkOnSubmit, FormError, noImplicitSubmit, useAppForm } from '@/components/form';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isGeneric, kindOf, type KindId } from '@/lib/listings/kinds';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';
import { deleteScraperAction, saveScraperAction, testScraperAction, type TestResult } from './actions';
import { blank, toForm, type Draft } from './scraper-draft';
import { scraperErrors } from './scraper-errors';
import { MappingFields } from './mapping-fields';
import { ScraperFields } from './scraper-fields';
import { TestView } from './test-view';

export function ScraperEditor({
  initial,
  autoTest,
  keywords,
  onClose,
}: {
  initial: Draft;
  autoTest: boolean;
  keywords: string[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const confirm = useConfirm();
  const focus = useReturnFocus();
  const [test, setTest] = useState<Result<TestResult> | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();

  // Save and Test both send the form, checked first with the action's schema
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: checkOnSubmit,
    validators: { onDynamic: ({ value }) => scraperErrors(value) },
    onSubmitMeta: { test: false },
    onSubmit: ({ value, meta, formApi }) => {
      if (meta.test)
        startTest(async () => {
          setTest(await testScraperAction(toForm(value)).catch((failure: unknown) => fail(message(failure))));
        });
      // the window stays open (Saving…) until the server answers, then closes together with the
      // refreshed list, so the list never shows the old values after it closed
      else
        startSave(async () => {
          const answer = await answered(formApi, saveScraperAction(toForm(value)));
          if (answer.ok) startTransition(() => setOpen(false));
        });
    },
  });
  const kind = useSelector(form.store, (state) => state.values.kind);
  const runTest = () => {
    setTest(null); // the last result isn't this one's, even when the check stops it
    void form.handleSubmit({ test: true });
  };

  const opened = useEffectEvent(() => {
    if (autoTest) void form.handleSubmit({ test: true }); // nothing tested yet: no result to clear
  });
  useEffect(() => opened(), []);

  const remove = async () => {
    const id = initial.id;
    if (
      !id ||
      !(await confirm({
        title: `Delete “${form.state.values.name}”?`,
        description: 'Offers it already saved stay.',
        action: 'Delete',
        destructive: true,
      }))
    )
      return;
    startSave(async () => {
      const answer = await answered(form, deleteScraperAction({ id }));
      if (answer.ok) startTransition(() => setOpen(false));
    });
  };
  const changeKind = async (next: KindId) => {
    // a built-in board brings its own link and board id; between generic kinds keep what's typed
    if (
      initial.id &&
      !(await confirm({
        title: 'Change the type?',
        description: 'The link and fields may not fit the new type.',
        action: 'Change',
      }))
    )
      return;
    const current = form.state.values;
    const changed: Draft =
      isGeneric(next) && isGeneric(current.kind)
        ? { ...current, kind: next }
        : { ...blank(next, current), id: current.id, enabled: current.enabled };
    for (const field of Object.keys(changed) as (keyof Draft)[])
      if (changed[field] !== current[field]) form.setFieldValue(field, changed[field]);
    setTest(null);
  };

  // A side panel: a long form whose test result (the offers it found, a sample) reads best at full height,
  // with the list of scrapers still in view beside it on a wide screen
  return (
    // Escape, a click outside and Cancel close it
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]"
        onInteractOutside={keepOpenOnToast}
        onCloseAutoFocus={(event) => {
          focus.onCloseAutoFocus(event);
          onClose();
        }}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onKeyDown={noImplicitSubmit}
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
            <SheetTitle className="text-lg font-semibold">{initial.id ? initial.name : 'New scraper'}</SheetTitle>
            <SheetDescription className="text-[13px]">{kindOf(kind).hint}</SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
            <ScraperFields form={form} keywords={keywords} onKind={(picked) => void changeKind(picked)} />
            <MappingFields form={form} />
            {test && <TestView test={test} />}
          </div>

          <SheetFooter className="mt-0 gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
            <FormError form={form} className="mt-0" />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {initial.id && (
                <Button
                  type="button"
                  variant="destructive"
                  className="mr-auto"
                  onClick={() => void remove()}
                  disabled={saving}
                >
                  Delete
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={runTest}
                disabled={testing}
                aria-busy={testing || undefined}
              >
                {testing ? 'Testing…' : 'Test'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
