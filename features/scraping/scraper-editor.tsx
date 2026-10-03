'use client';

import { startTransition, useEffect, useEffectEvent, useState, useTransition } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { FieldId } from '@/lib/listings/config';
import { isGeneric, kindOf, type KindId } from '@/lib/listings/kinds';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';
import { deleteScraperAction, saveScraperAction, testScraperAction, type TestResult } from './actions';
import { blank, toForm, type Draft } from './scraper-draft';
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
  const [draft, setDraft] = useState(initial);
  const [test, setTest] = useState<Result<TestResult> | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setField = (field: FieldId, value: string) =>
    setDraft((current) => ({ ...current, fields: { ...current.fields, [field]: value } }));

  const runTest = () =>
    startTest(async () => {
      setTest(null);
      setTest(await testScraperAction(toForm(draft)).catch((failure: unknown) => fail(message(failure))));
    });

  const opened = useEffectEvent(() => {
    if (autoTest) runTest();
  });
  useEffect(() => opened(), []);

  // the dialog stays open (Saving…) until the server answers, then closes together with the
  // refreshed list, so the list never shows the old values after it closed
  const commit = (fn: () => Promise<Result<unknown>>) => {
    setError(null);
    startSave(async () => {
      const answer = await fn().catch((failure: unknown) => fail(message(failure)));
      startTransition(() => (answer.ok ? setOpen(false) : setError(answer.error)));
    });
  };
  const save = () => commit(() => saveScraperAction(toForm(draft)));
  const remove = async () => {
    const id = draft.id;
    if (
      !id ||
      !(await confirm({
        title: `Delete “${draft.name}”?`,
        description: 'Offers it already saved stay.',
        action: 'Delete',
        destructive: true,
      }))
    )
      return;
    commit(() => deleteScraperAction({ id }));
  };
  const changeKind = async (kind: KindId) => {
    // a built-in board brings its own link and board id; between generic kinds keep what's typed
    if (
      draft.id &&
      !(await confirm({
        title: 'Change the type?',
        description: 'The link and fields may not fit the new type.',
        action: 'Change',
      }))
    )
      return;
    setDraft((current) =>
      isGeneric(kind) && isGeneric(current.kind)
        ? { ...current, kind }
        : { ...blank(kind, current), id: current.id, enabled: current.enabled },
    );
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
        <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
          <SheetTitle className="text-lg font-semibold">{draft.id ? initial.name : 'New scraper'}</SheetTitle>
          <SheetDescription className="text-[13px]">{kindOf(draft.kind).hint}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
          <ScraperFields draft={draft} set={set} keywords={keywords} onKind={(kind) => void changeKind(kind)} />
          <MappingFields draft={draft} set={set} setField={setField} />
          {test && <TestView test={test} />}
        </div>

        <SheetFooter className="mt-0 gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle className="font-normal">{error}</AlertTitle>
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {draft.id && (
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
            <Button type="button" onClick={save} disabled={saving} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
