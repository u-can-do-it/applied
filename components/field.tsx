import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/shared/cn';

/** What the control inside a Field gets: the id its label points at, and what describes it. */
export type ControlProps = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

/**
 * A form control with its label above it and, optionally, a hint and what's wrong with it under it
 * (shadcn's Field pattern): the control gets the label's id, `aria-invalid` and `aria-describedby`.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: (control: ControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const describedBy = [error && errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 text-[13px] leading-normal text-muted-foreground', className)}>
      <Label htmlFor={id} className="block text-[13px] leading-normal font-normal text-muted-foreground select-auto">
        {label}
      </Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <small id={hintId} className="text-xs">
          {hint}
        </small>
      )}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

/**
 * What's wrong with a field, under it. Always there (empty when nothing is), so screen readers announce
 * the message when it appears: a live region added together with its text often isn't read.
 */
export function FieldError({ id, error, className }: { id?: string; error?: string; className?: string }) {
  return (
    <p id={id} aria-live="polite" className={cn('m-0 text-xs text-destructive empty:hidden', className)}>
      {error}
    </p>
  );
}

/** A checkbox or switch with its label to the right. */
export function CheckField({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Label className={cn('w-fit text-sm leading-normal font-normal text-foreground select-auto', className)}>
      {children}
    </Label>
  );
}

/** `{keyword}`, an env var's name: code inside a sentence. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-background px-1.5 py-px font-mono text-xs text-foreground [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}
