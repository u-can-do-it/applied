import { Label } from '@/components/ui/label';
import { cn } from '@/lib/shared/cn';

/** A form control with its label above it and, optionally, a hint under it. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Label
      className={cn(
        'min-w-0 flex-col items-stretch gap-1.5 text-[13px] leading-normal font-normal text-muted-foreground select-auto',
        className,
      )}
    >
      <span>{label}</span>
      {children}
      {hint && <small className="text-xs">{hint}</small>}
    </Label>
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
