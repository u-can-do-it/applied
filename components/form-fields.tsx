'use client';

import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { splitList } from '@/lib/listings/settings';
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

// the tags field's box, drawn as an Input with the badges and the text box inside it
const TAGS_BOX =
  'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:bg-input/30';

/**
 * A list typed a word at a time: a comma (or ;) or Enter turns what's typed into a badge, its × takes it
 * out, and Backspace in the empty box the last one. A space doesn't: "Zielona Góra" and "React Native"
 * stay one. The field's value is the list as text ("React, Node", what the schema reads), what's still
 * being typed last, so Save takes it too.
 */
export function TagsField({ label, hint, className, placeholder }: Labelled & { placeholder?: string }) {
  const field = useFieldContext<string>();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const all = splitList(field.state.value);
  const typing = draft.trim();
  // the value came from elsewhere (the saved one, a refreshed page): what was typed isn't in it any more
  if (typing && all.at(-1) !== typing) setDraft('');
  const tags = typing && all.at(-1) === typing ? all.slice(0, -1) : all;

  const write = (next: string[], text: string) => {
    setDraft(text);
    field.handleChange([...next, text.trim()].filter(Boolean).join(', '));
  };
  /** the words added to the badges, the ones already there (in any case) left out */
  const withWords = (words: string[]) => {
    const next = [...tags];
    for (const word of words.map((each) => each.trim()))
      if (word && !next.some((tag) => tag.toLowerCase() === word.toLowerCase())) next.push(word);
    return next;
  };

  return (
    <Field label={label} hint={hint} error={firstError(field.state.meta.errors)} className={className}>
      {(control) => (
        <div className={TAGS_BOX} onClick={() => input.current?.focus()}>
          {tags.map((tag, i) => (
            <Badge key={tag} variant="secondary" className="h-6 gap-0.5 pr-0.5 text-[13px] font-normal">
              {tag}
              <button
                type="button"
                aria-label={`Remove “${tag}”`}
                className="inline-flex size-4.5 items-center justify-center rounded-full hover:bg-foreground/15"
                onClick={(event) => {
                  event.stopPropagation();
                  write(
                    tags.filter((_, j) => j !== i),
                    draft,
                  );
                }}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
          <input
            {...control}
            ref={input}
            name={field.name}
            value={draft}
            placeholder={tags.length ? undefined : placeholder}
            className="h-6 min-w-[8ch] flex-1 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            onChange={(event) => {
              const parts = event.target.value.split(/[,;\n]/);
              const text = parts.pop() ?? '';
              write(parts.length ? withWords(parts) : tags, text);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && typing) {
                event.preventDefault(); // a badge, not the form's submit
                write(withWords([typing]), '');
              } else if (event.key === 'Backspace' && !draft && tags.length) {
                write(tags.slice(0, -1), '');
              }
            }}
            onBlur={() => {
              if (typing) write(withWords([typing]), '');
              field.handleBlur();
            }}
          />
        </div>
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
          className={controlClassName}
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
