'use client';

import { startTransition, useId, useState, useTransition } from 'react';
import { useSelector, type StandardSchemaV1 } from '@tanstack/react-form';
import { SparklesIcon } from 'lucide-react';
import type { ApplicationWithContent } from '@/lib/applications';
import { WORK_MODE_LABELS, WORK_MODES } from '@/lib/ads/details';
import { BOARD_SUGGESTIONS, boardOf, isLink } from '@/lib/boards';
import { addApplicationSchema, applicationFieldsSchema } from '@/lib/shared/schemas/applications';
import type { Result } from '@/lib/shared/result';
import {
  addApplicationAction,
  fillFromLinkAction,
  fillFromTextAction,
  updateApplicationAction,
  type JobDraft,
} from './actions';
import { DateInput } from '@/components/date-input';
import { FieldError } from '@/components/field';
import { answered, checkOnSubmit, FormError, formSchema, noImplicitSubmit, useAppForm } from '@/components/form';
import { firstError } from '@/components/form-fields';
import { useZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import { NativeSelectOption } from '@/components/ui/native-select';
import { SheetFooter } from '@/components/ui/sheet';
import { draftOf, empty, withFilled, type Draft, type Field as DraftField } from './application-draft';
import { ApplicationFormHeader } from './application-form-header';
import { StatusFields } from './status-fields';

// The "Add application" form, also editing an application in its own window ("Edit"), without the
// status and the note there: the window has those. Checked with the action's schema as you save
// (Edit, with the schema of the fields it shows).

export type FormProps =
  | { app?: undefined; onCancel: () => void; onSaved: () => void }
  | { app: ApplicationWithContent; onCancel: () => void; onSaved: (saved: ApplicationWithContent) => void };

/** The form without a window around it: a new application, or `app` to edit. */
export function ApplicationForm(props: FormProps) {
  const editing = props.app !== undefined;
  const zone = useZone();
  const [initial] = useState<Draft>(() => (props.app ? draftOf(props.app, zone) : empty(zone)));
  const [readingLink, startReadingLink] = useTransition();
  const [readingText, startReadingText] = useTransition();
  const filling = readingLink || readingText;
  const [saving, startSave] = useTransition();
  const [info, setInfo] = useState<{ warning?: string; known?: string | null } | null>(null);
  const dayError = useId();

  // Edit checks only the fields it shows: an old application's status (the window's) doesn't stop its edit
  const schema: StandardSchemaV1<Draft, unknown> = props.app
    ? formSchema<typeof applicationFieldsSchema, Draft>(applicationFieldsSchema)
    : formSchema(addApplicationSchema);
  const form = useAppForm({
    defaultValues: initial,
    validationLogic: checkOnSubmit,
    validators: { onDynamic: schema },
    // the window stays open (Saving…) until the server answers, then closes together with the refreshed list
    onSubmit: ({ value, formApi }) =>
      startSave(async () => {
        if (props.app) {
          // not the status, not the note
          const { url, title, company, board, day, salary, contract, location, workMode, officeDays, content } = value;
          const input = { url, title, company, board, day, salary, contract, location, workMode, officeDays, content };
          const answer = await answered(formApi, updateApplicationAction({ jobId: props.app.jobId, input }));
          const onSaved = props.onSaved;
          if (answer.ok) startTransition(() => onSaved(answer.data));
        } else {
          const answer = await answered(formApi, addApplicationAction(value));
          const onSaved = props.onSaved;
          if (answer.ok) startTransition(() => onSaved());
        }
      }),
  });
  const url = useSelector(form.store, (state) => state.values.url);
  const noContent = useSelector(form.store, (state) => !state.values.content.trim());
  const hybrid = useSelector(form.store, (state) => state.values.workMode === 'hybrid');

  // what the link's page or the pasted ad text says, into the form
  const fillWith = async (call: Promise<Result<JobDraft>>) => {
    const answer = await answered(form, call);
    if (!answer.ok) return;
    const filled = answer.data;
    startTransition(() => {
      const current = form.state.values;
      // what you typed in stays (the link is what's read: it doesn't count); what's filled in can be filled in again
      const fields = Object.keys(current) as DraftField[];
      const typed = new Set(fields.filter((field) => field !== 'url' && form.getFieldMeta(field)?.isDirty));
      const next = withFilled(current, filled, typed, editing);
      for (const field of fields)
        if (next[field] !== current[field])
          form.setFieldValue(field, next[field], { dontUpdateMeta: true, dontRunListeners: true });
      // editing one that's this scraped offer already: nothing to say
      setInfo({
        warning: filled.warning,
        known: filled.knownJobId && filled.knownJobId === props.app?.jobId ? null : filled.known,
      });
    });
  };
  const fill = () => {
    setInfo(null);
    startReadingLink(() => fillWith(fillFromLinkAction({ link: url })));
  };
  // for a page that can't be read: the ad text you pasted, which stays as it is
  const fillFromText = () => {
    setInfo(null);
    startReadingText(() => fillWith(fillFromTextAction({ text: form.state.values.content, link: url })));
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onKeyDown={noImplicitSubmit}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <ApplicationFormHeader editing={editing} />

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
        <div className="flex items-end gap-2 max-[560px]:flex-col max-[560px]:items-stretch">
          <form.AppField
            name="url"
            listeners={{
              // the board follows the link until you pick one yourself
              onChange: ({ value }) => {
                if (isLink(value) && !form.getFieldMeta('board')?.isDirty)
                  form.setFieldValue('board', boardOf(value), { dontUpdateMeta: true });
              },
            }}
          >
            {(field) => (
              <field.TextField
                label="Link to the offer"
                className="flex-1"
                placeholder="https://…"
                inputMode="url"
                spellCheck={false}
                autoFocus
                // Enter reads the page, as the button does
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (isLink(event.currentTarget.value) && !filling) fill();
                }}
              />
            )}
          </form.AppField>
          <Button type="button" onClick={fill} disabled={!isLink(url) || filling} aria-busy={readingLink || undefined}>
            {readingLink ? (
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
          <form.AppField name="title">
            {(field) => <field.TextField label="Title *" placeholder="Senior Frontend Developer" />}
          </form.AppField>
          <form.AppField name="company">{(field) => <field.TextField label="Company" />}</form.AppField>
        </div>
        <div className={ROW}>
          <form.AppField name="board">
            {(field) => <field.TextField label="Board" list="boards" spellCheck={false} />}
          </form.AppField>
          <datalist id="boards">
            {BOARD_SUGGESTIONS.map((board) => (
              <option key={board} value={board} />
            ))}
          </datalist>
          <form.Field name="day">
            {(field) => {
              const error = firstError(field.state.meta.errors);
              return (
                <div className="flex flex-col justify-end gap-1 text-[13px] text-muted-foreground">
                  <DateInput
                    label="Applied on"
                    value={field.state.value}
                    max={zone.day()}
                    error={{ message: error, id: dayError }}
                    onCommit={field.handleChange}
                  />
                  <FieldError id={dayError} error={error} />
                </div>
              );
            }}
          </form.Field>
        </div>
        {!editing && (
          <div className={ROW}>
            <StatusFields form={form} />
          </div>
        )}
        {/* "e.g.": an empty field mustn't read as one filled in */}
        <div className={ROW}>
          <form.AppField name="salary">
            {(field) => <field.TextField label="Salary" placeholder="e.g. 20 000–25 000 PLN / month (B2B)" />}
          </form.AppField>
          <form.AppField name="contract">
            {(field) => <field.TextField label="Contract" placeholder="e.g. B2B" />}
          </form.AppField>
          <form.AppField name="location">
            {(field) => <field.TextField label="Location" placeholder="e.g. Warszawa" />}
          </form.AppField>
        </div>
        <div className={ROW}>
          <form.AppField name="workMode">
            {(field) => (
              <field.SelectField label="Work mode" controlClassName="w-full">
                <NativeSelectOption value="">Not given</NativeSelectOption>
                {WORK_MODES.map((mode) => (
                  <NativeSelectOption key={mode} value={mode}>
                    {WORK_MODE_LABELS[mode]}
                  </NativeSelectOption>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          {/* the days in the office are a hybrid job's */}
          {hybrid && (
            <form.AppField name="officeDays">
              {(field) => <field.TextField label="Office / home days" placeholder="e.g. 2 office / 3 home" />}
            </form.AppField>
          )}
        </div>
        <form.AppField name="content">
          {(field) => (
            <field.TextareaField
              label="Ad text"
              hint={
                <>
                  Kept with the application, so you can read it after the board takes the ad down.
                  {noContent && url && ' Left empty, it’s fetched from the link after saving.'}
                </>
              }
              rows={8}
              placeholder="Filled in from the link, or paste it"
              controlClassName={TEXTAREA}
            />
          )}
        </form.AppField>
        {/* when the link's page can't be read (a login wall): paste the ad and fill in from it */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-end"
          onClick={fillFromText}
          disabled={noContent || filling}
          aria-busy={readingText || undefined}
        >
          {readingText ? (
            'Reading the text…'
          ) : (
            <>
              <SparklesIcon /> Fill in from the ad text
            </>
          )}
        </Button>
        {!editing && (
          <form.AppField name="note">
            {(field) => (
              <field.TextareaField
                label="Note"
                rows={3}
                maxLength={10_000}
                placeholder="Recruiter, the salary you asked for, next steps…"
                controlClassName={TEXTAREA}
              />
            )}
          </form.AppField>
        )}
      </div>

      <SheetFooter className="mt-0 gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
        <FormError form={form} className="mt-0" />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}

const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-2.5';
const TEXTAREA = 'field-sizing-fixed resize-y font-mono text-[13px] md:text-[13px]';
