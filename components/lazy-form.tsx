'use client';

import { Component, Suspense, type ReactNode } from 'react';
import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// A form that loads when it's first opened (React.lazy): grey fields under its window's header while
// it loads, and if its code can't be loaded (a new deploy, the network), a message in the window
// instead of the page's error screen.

export const LOAD_FAILED = 'Couldn’t load the form; reload the page.';

/**
 * `header`: the window's header as the form has it (title and description: Radix wants both).
 * `fields`: the height of each grey field, in the form's order. `frame`: the window, when the lazy
 * component brings its own (the scraper editor's Sheet).
 */
export function LazyForm({
  header,
  fields = ['h-8', 'h-8', 'h-8', 'h-8'],
  frame = (content) => content,
  children,
}: {
  header: ReactNode;
  fields?: string[];
  frame?: (content: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  return (
    <LoadBoundary fallback={frame(<LoadFailed header={header} />)}>
      <Suspense fallback={frame(<Loading header={header} fields={fields} />)}>{children}</Suspense>
    </LoadBoundary>
  );
}

function Loading({ header, fields }: { header: ReactNode; fields: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      {header}
      <div className="flex flex-col gap-3.5 px-3.5 py-3 sm:px-5 sm:py-3.5">
        {fields.map((height, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className={height} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadFailed({ header }: { header: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex flex-col items-start gap-3 px-3.5 py-3 sm:px-5 sm:py-3.5">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle className="font-normal">{LOAD_FAILED}</AlertTitle>
        </Alert>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          <RotateCwIcon /> Reload
        </Button>
      </div>
    </div>
  );
}

class LoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
