'use client';

import { useEffect } from 'react';
import { SLOW_AI_MS, slowAfter } from '@/components/slow-requests';

/**
 * The server actions that answer only after OpenAI does (their ids, from the root layout): their
 * "Slow response" toast waits SLOW_AI_MS, not the usual 3 s. Renders nothing.
 */
export function SlowAiActions({ ids }: { ids: string[] }) {
  useEffect(() => slowAfter(ids, SLOW_AI_MS), [ids]);
  return null;
}
