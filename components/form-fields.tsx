'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { CheckField, Field } from './field';
import { useFieldContext } from './form-context';

// The controls of a TanStack form's field (`<form.AppField name="title">{(field) => <field.TextField … />}`):
// the value, its changes and its first error, with the label, hint and aria attributes of a Field.

/** The Field's label, hint and classes, and the control's classes. */
type Labelled = { label: ReactNode; hint?: ReactNode; className?: string; controlClassName?: string };
/** The control's own props, but those the field sets. */
type Control<C extends React.ElementType> = Omit<ComponentProps<C>, 'value' | 'onChange' | 'id' | 'name'>;

/** A field's first error: the schema's message (a Standard Schema issue) or what a validator said. */
export function firstError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string' && error) return error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
      return error.message;
  }
  return undefined;
}

/** A text box; `normalize` changes what's typed as it's typed (e.g. lowercase). */
export function TextField({
  label,
  hint,
  className,
  controlClassName,
  normalize = (text) => text,
  ...input
}: Labelled & Control<typeof Input> & { normalize?: (text: string) => string }) {
  const field = useFieldContext<string>();
  return (
    <Field label={label} hint={hint} error={firstError(field.state.meta.errors)} className={className}>
      {(control) => (
        <Input
          {...input}
          {...control}
          className={controlClassName}
          name={field.name}
          value={field.state.value}
          onChange={(event) => field.handleChange(normalize(event.target.value))}
          onBlur={field.handleBlur}
        />
      )}
    </Field>
  );
}

export function TextareaField({
  label,
  hint,
  className,
  controlClassName,
  ...textarea
}: Labelled & Control<typeof Textarea>) {
  const field = useFieldContext<string>();
  return (
    <Field label={label} hint={hint} error={firstError(field.state.meta.errors)} className={className}>
      {(control) => (
        <Textarea
          {...textarea}
          {...control}
          className={controlClassName}
          name={field.name}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        />
      )}
    </Field>
  );
}

/** A number; an empty box is NaN, which the schema words ("Hours are 0–24."). `clamp` keeps it in range as you type. */
export function NumberField({
  label,
  hint,
  className,
  controlClassName,
  clamp,
  ...input
}: Labelled & Control<typeof Input> & { clamp?: (value: number) => number }) {
  const field = useFieldContext<number>();
  return (
    <Field label={label} hint={hint} error={firstError(field.state.meta.errors)} className={className}>
      {(control) => (
        <Input
          {...input}
          {...control}
          type="number"
          name={field.name}
          value={Number.isNaN(field.state.value) ? '' : field.state.value}
          onChange={(event) =>
            field.handleChange(clamp ? clamp(event.target.valueAsNumber) : event.target.valueAsNumber)
          }
          onBlur={field.handleBlur}
        />
      )}
    </Field>
  );
}

/**
 * A native select (its <NativeSelectOption>s as children). `toValue` turns the option's text into the
 * field's value (Number for minutes); `onPick` instead of the change, for a pick that asks first.
 */
export function SelectField<T extends string | number>({
  label,
  hint,
  className,
  controlClassName,
  toValue = (option) => option as T,
  onPick,
  ...select
}: Labelled & Control<typeof NativeSelect> & { toValue?: (option: string) => T; onPick?: (value: T) => void }) {
  const field = useFieldContext<T>();
  return (
    <Field label={label} hint={hint} error={firstError(field.state.meta.errors)} className={className}>
      {(control) => (
        <NativeSelect
          {...select}
          {...control}
          className={controlClassName}
          name={field.name}
          value={field.state.value}
          onChange={(event) => {
            const value = toValue(event.target.value);
            if (onPick) onPick(value);
            else field.handleChange(value);
          }}
          onBlur={field.handleBlur}
        />
      )}
    </Field>
  );
}

/** A checkbox with its label to the right. */
export function CheckboxField({ label, className }: { label: ReactNode; className?: string }) {
  const field = useFieldContext<boolean>();
  return (
    <CheckField className={className}>
      <Checkbox
        name={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked === true)}
        onBlur={field.handleBlur}
      />
      {label}
    </CheckField>
  );
}
