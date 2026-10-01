'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useNav } from './nav';

export function ResultsBoundary({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const actual = useSearchParams().toString(); // the URL the server-rendered list belongs to
  const { query } = useNav(); // what the user just asked for (optimistic, set on click)

  // Clicked but the new list isn't here yet: drop the old rows right away.
  if (query.toString() !== actual) return fallback;

  // Keyed by URL so a new filter mounts a fresh boundary (React keeps an already-revealed
  // boundary on screen during transitions). router.refresh() keeps the key -> swaps in place.
  return (
    <Suspense key={actual} fallback={fallback}>
      {children}
    </Suspense>
  );
}
