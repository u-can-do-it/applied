'use client';

import {
  createFormHook,
  revalidateLogic,
  standardSchemaValidators,
  useSelector,
  type AnyFormApi,
  type StandardSchemaV1,
} from '@tanstack/react-form';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type * as z from 'zod/mini';
import { toast } from 'sonner';
import { ActionError } from '@/components/use-action';
import { LOAD_FAILED } from './lazy-form';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';
import { fieldContext, formContext } from './form-context';
import { CheckboxField, NumberField, SelectField, TextareaField, TextField } from './form-fields';

// The app's forms are TanStack Form (`useAppForm`), checked with the same Zod schema (zod/mini) as the
// server action they call: `validators: { onDynamic: schema }` with `validationLogic: checkOnSubmit`.
// Nothing is said while you first fill a form in; after the first Save, each change is checked again.
// What the server says is wrong comes back as the action's Result and shows by the button (FormError).

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextareaField, NumberField, SelectField, CheckboxField },
  formComponents: {},
});

/** Checked on Save, then on every change. */
export const checkOnSubmit = revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' });

/**
 * An action's schema as its form's validator. TanStack wants the schema's input to be the form's values;
 * a form sends every field, also those the schema has a default for (a request that leaves one out).
 * `Values`: the form's values where they aren't simply that (e.g. a file that may not be picked).
 */
export function formSchema<S extends z.core.$ZodType>(schema: S): StandardSchemaV1<Required<z.input<S>>, z.output<S>>;
export function formSchema<S extends z.core.$ZodType, Values extends z.input<S>>(
  schema: S,
): StandardSchemaV1<Values, z.output<S>>;
export function formSchema(schema: z.core.$ZodType): StandardSchemaV1 {
  return schema;
}

/**
 * The schema of a form that's on the page from the start, loaded when it's first wanted (the first Save):
 * the page doesn't carry zod until then. `validators: { onDynamicAsync: lazySchema(() => import(…)) }`.
 * If it can't be loaded (a new deploy, the network), the form says so instead of saving unchecked.
 */
export const lazySchema =
  <Values,>(load: () => Promise<StandardSchemaV1<Values, unknown>>) =>
  async ({ value }: { value: Values }) => {
    let schema: StandardSchemaV1<Values, unknown>;
    try {
      schema = await load();
    } catch {
      return LOAD_FAILED;
    }
    return standardSchemaValidators.validateAsync({ value, validationSource: 'form' }, schema);
  };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A form over server data (Settings): when the refreshed page brings other values and the form still
 * shows the ones it had, it shows the new ones; what you typed stays. (TanStack's own update stops at the
 * first focus and blur, which counts as touched.)
 */
export function useFollowServer(form: AnyFormApi, server: unknown) {
  const last = useRef(server);
  useEffect(() => {
    if (same(server, last.current)) return;
    if (same(form.state.values, last.current)) form.reset(server);
    last.current = server;
  });
}

/**
 * For a long form in a window (a Sheet): Enter in a text box doesn't save it (and close the window); Save
 * is a click. `<form onKeyDown={noImplicitSubmit}>`; a box that does something on Enter handles it itself.
 */
export function noImplicitSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
}

/** Shows what the server said is wrong by the form's button (<FormError>), until the next try or a change. */
export function showServerError(form: AnyFormApi, error: string) {
  form.setErrorMap({ onServer: error });
}

/**
 * What a form does with its action's answer: on success, the toast `success` words from it (e.g. the
 * action's "Saved."), if any; what went wrong as the form's server error, by the button (<FormError>)
 * until the next try or a change.
 */
export async function answered<T>(
  form: AnyFormApi,
  call: Promise<Result<T>>,
  { success }: { success?: (data: T) => string } = {},
): Promise<Result<T>> {
  form.setErrorMap({ onServer: undefined });
  const answer = await call.catch((failure: unknown) => fail(message(failure)));
  if (!answer.ok) showServerError(form, answer.error);
  else if (success) toast.success(success(answer.data));
  return answer;
}

/** What's wrong with the form as a whole: the server's answer (see `answered`), or a check about no one field. */
export function FormError({ form, className }: { form: AnyFormApi; className?: string }) {
  // a schema's problems are per field (objects here); the form's own are strings
  const error = useSelector(form.store, (state) =>
    (state.errors as unknown[]).find((problem): problem is string => typeof problem === 'string' && problem !== ''),
  );
  return <ActionError error={error} className={className} />;
}
