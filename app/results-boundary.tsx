'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// A navigation is a transition, and React keeps an already-revealed boundary on screen
// during transitions instead of showing its fallback again. Keying the boundary by the
// query makes every new filter / page / search mount a fresh boundary -> skeleton at once.
export function ResultsBoundary({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const key = useSearchParams().toString();
  return (
    <Suspense key={key} fallback={fallback}>
      {children}
    </Suspense>
  );
}
