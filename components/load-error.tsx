import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** A part of the page that couldn't load ("Can’t load offers.") and why; it stays until the page loads again. */
export function LoadError({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive" className="mt-6">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      {(detail || children) && (
        <AlertDescription className="[overflow-wrap:anywhere]">
          {detail && <code className="font-mono text-[13px]">{detail}</code>}
          {children}
        </AlertDescription>
      )}
    </Alert>
  );
}
