'use client';

import { startTransition, useRef, useState, useTransition } from 'react';
import { PlusIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react';
import type { ApplicationWithContent } from '@/lib/applications';
import { BOARD_SUGGESTIONS, boardOf, isLink } from '@/lib/boards';
import type { Zone } from '@/lib/dates';
import { message } from '@/lib/shared/errors';
import { fail } from '@/lib/shared/result';
import type { ApplicationInput } from '@/lib/shared/schemas/applications';
import { STAGES, outcomesFor, type StageId, type OutcomeId } from '@/lib/stages';
import { addApplicationAction, fillFromLinkAction, updateApplicationAction } from './actions';
import { DateInput } from '@/components/date-input';
import { CheckField, Field } from '@/components/field';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { useZone } from '@/components/time-zone';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

// "+ Add application": an application you sent somewhere the scrapers don't see (or before they
// did). Paste the link and "Fill in" reads the page (with the AI, if there's a key); everything
// stays editable. The window is a side panel like the applied offer's: the middle scrolls.
// The same form edits an application in its own window ("Edit"), without the status and the
// note: the window has those.

type Draft = ApplicationInput; // what the form sends
type Field = keyof Draft;

const empty = (zone: Zone): Draft => ({
  url: '',
  title: '',
  company: '',
  board: 'unknown',
  day: zone.day(),
  stage: 'submitted',
  outcome: 'pending',
  salary: '',
  contract: '',
  location: '',
  remote: false,
  content: '',
  note: '',
});

/** An applied offer as the form shows it. */
const draftOf = (application: ApplicationWithContent, zone: Zone): Draft => ({
  url: application.url,
  title: application.title,
  company: application.company ?? '',
  board: application.src,
  day: zone.day(application.appliedAt),
  stage: application.stage,
  outcome: application.outcome,
  salary: application.details?.salary ?? '',
  contract: application.details?.contract ?? '',
  location: application.details?.location ?? '',
  remote: Boolean(application.details?.remote),
  content: application.content ?? '',
  note: '',
});

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
        className={SHEET}
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

const SHEET = 'gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]';

type FormProps =
  | { app?: undefined; onCancel: () => void; onSaved: () => void }
  | { app: ApplicationWithContent; onCancel: () => void; onSaved: (saved: ApplicationWithContent) => void };

/** The form without a window around it: a new application, or `app` to edit. */
export function ApplicationForm(props: FormProps) {
  const editing = props.app !== undefined;
  const zone = useZone();
  const [draft, setDraft] = useState<Draft>(() => (props.app ? draftOf(props.app, zone) : empty(zone)));
  const touched = useRef(new Set<Field>()); // what you typed: "Fill in" doesn't overwrite it
  const [filling, startFill] = useTransition();
  const [saving, startSave] = useTransition();
  const [info, setInfo] = useState<{ warning?: string; known?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<Draft>) => {
    for (const field of Object.keys(patch) as Field[]) touched.current.add(field);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const onLink = (url: string) =>
    setDraft((current) => ({
      ...current,
      url,
      // the board follows the link until you pick one yourself
      board: touched.current.has('board') ? current.board : isLink(url) ? boardOf(url) : current.board,
    }));

  const fill = () => {
    setError(null);
    setInfo(null);
    startFill(async () => {
      const answer = await fillFromLinkAction({ link: draft.url }).catch((failure: unknown) => fail(message(failure)));
      startTransition(() => {
        if (!answer.ok) {
          setError(answer.error);
          return;
        }
        const filled = answer.data;
        setDraft((current) => {
          const next = { ...current };
          // what you typed stays; when editing, so does everything already filled in
          const free = (field: Field) =>
            !touched.current.has(field) &&
            (!editing || next[field] === '' || (field === 'board' && next[field] === 'unknown'));
          const put = <K extends Field>(field: K, value: Draft[K]) => {
            if (free(field) && value !== '') next[field] = value;
          };
          put('url', filled.url);
          put('board', filled.board);
          put('title', filled.title);
          put('company', filled.company);
          put('location', filled.location);
          put('salary', filled.salary);
          put('contract', filled.contract);
          put('content', filled.content);
          if (!touched.current.has('remote') && (!editing || !next.remote)) next.remote = filled.remote;
          return next;
        });
        // editing one that's this scraped offer already: nothing to say
        setInfo({
          warning: filled.warning,
          known: filled.knownJobId && filled.knownJobId === props.app?.jobId ? null : filled.known,
        });
      });
    });
  };

  const save = () => {
    setError(null);
    startSave(async () => {
      const failed = (failure: unknown) => fail(message(failure));
      if (props.app) {
        const { url, title, company, board, day, salary, contract, location, remote, content } = draft; // not the status, not the note
        const answer = await updateApplicationAction({
          jobId: props.app.jobId,
          input: { url, title, company, board, day, salary, contract, location, remote, content },
        }).catch(failed);
        const onSaved = props.onSaved;
        startTransition(() => (answer.ok ? onSaved(answer.data) : setError(answer.error)));
      } else {
        const answer = await addApplicationAction(draft).catch(failed);
        const onSaved = props.onSaved;
        startTransition(() => (answer.ok ? onSaved() : setError(answer.error)));
      }
    });
  };

  const text = (field: Field, extra: Record<string, unknown> = {}) => ({
    value: draft[field] as string,
    // eslint-disable-next-line react-hooks/refs -- an event handler; the compiler can't tell through the spread into props
    onChange: (event: { target: { value: string } }) => edit({ [field]: event.target.value }),
    ...extra,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
        <SheetTitle className="text-lg font-semibold">
          {editing ? 'Edit the application' : 'Add an application'}
        </SheetTitle>
        <SheetDescription className="text-[13px]">
          {editing
            ? 'Its status and note stay as they are: they’re set in the window itself.'
            : 'One you sent outside the lists here. Paste its link to fill in the rest.'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
        <div className="flex items-end gap-2 max-[560px]:flex-col max-[560px]:items-stretch">
          <Field label="Link to the offer" className="flex-1">
            <Input
              value={draft.url}
              onChange={(event) => onLink(event.target.value)}
              placeholder="https://…"
              inputMode="url"
              spellCheck={false}
              autoFocus
            />
          </Field>
          <Button
            type="button"
            onClick={fill}
            disabled={!isLink(draft.url) || filling}
            aria-busy={filling || undefined}
          >
            {filling ? (
              'Reading the page…'
            ) : (
              <>
                <SparklesIcon /> Fill in from the link
              </>
            )}
          </Button>
        </div>
        {editing && (
          <p className="m-0 text-xs text-muted-foreground">
            “Fill in” fills only the empty fields: clear one to have it filled in again.
          </p>
        )}
        {info?.known && (
          <p className="m-0 text-xs text-success">
            {editing
              ? `This link is a scraped offer: ${info.known}. Saving joins the application to it.`
              : `This offer is among the scraped ones: ${info.known}. The application joins it.`}
          </p>
        )}
        {info?.warning && <p className="m-0 text-xs text-warning">{info.warning}</p>}

        <div className={ROW}>
          <Field label="Title *">
            <Input {...text('title', { placeholder: 'Senior Frontend Developer' })} />
          </Field>
          <Field label="Company">
            <Input {...text('company')} />
          </Field>
        </div>
        <div className={ROW}>
          <Field label="Board">
            <Input {...text('board', { list: 'boards', spellCheck: false })} />
            <datalist id="boards">
              {BOARD_SUGGESTIONS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <div className="flex items-end text-[13px] text-muted-foreground">
            <DateInput label="Applied on" value={draft.day} max={zone.day()} onCommit={(day) => edit({ day })} />
          </div>
        </div>
        {!editing && (
          <div className={ROW}>
            <Field label="Stage">
              <NativeSelect
                className="w-full"
                value={draft.stage}
                onChange={(event) => {
                  const stage = event.target.value as StageId;
                  // an offer has no "ghosted" or talent pool
                  edit(
                    outcomesFor(stage).some((outcome) => outcome.id === draft.outcome)
                      ? { stage }
                      : { stage, outcome: 'pending' },
                  );
                }}
              >
                {STAGES.map((stage) => (
                  <NativeSelectOption key={stage.id} value={stage.id}>
                    {stage.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Outcome">
              <NativeSelect
                className="w-full"
                value={draft.outcome}
                onChange={(event) => edit({ outcome: event.target.value as OutcomeId })}
              >
                {outcomesFor(draft.stage).map((outcome) => (
                  <NativeSelectOption key={outcome.id} value={outcome.id}>
                    {outcome.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
        )}
        <div className={ROW}>
          <Field label="Salary">
            <Input {...text('salary', { placeholder: '20 000–25 000 PLN / month (B2B)' })} />
          </Field>
          <Field label="Contract">
            <Input {...text('contract', { placeholder: 'B2B' })} />
          </Field>
          <Field label="Location">
            <Input {...text('location', { placeholder: 'Warszawa' })} />
          </Field>
        </div>
        <CheckField>
          <Checkbox checked={draft.remote} onCheckedChange={(checked) => edit({ remote: checked === true })} />
          Remote
        </CheckField>
        <Field
          label="Ad text"
          hint={
            <>
              Kept with the application, so you can read it after the board takes the ad down.
              {!draft.content.trim() && draft.url && ' Left empty, it’s fetched from the link after saving.'}
            </>
          }
        >
          <Textarea
            {...text('content', { rows: 8, placeholder: 'Filled in from the link, or paste it' })}
            className={TEXTAREA}
          />
        </Field>
        {!editing && (
          <Field label="Note">
            <Textarea
              {...text('note', {
                rows: 3,
                maxLength: 10_000,
                placeholder: 'Recruiter, the salary you asked for, next steps…',
              })}
              className={TEXTAREA}
            />
          </Field>
        )}
      </div>

      <SheetFooter className="mt-0 gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle className="font-normal">{error}</AlertTitle>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving || !draft.title.trim()} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
          </Button>
        </div>
      </SheetFooter>
    </div>
  );
}

const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-2.5';
const TEXTAREA = 'field-sizing-fixed resize-y font-mono text-[13px] md:text-[13px]';
