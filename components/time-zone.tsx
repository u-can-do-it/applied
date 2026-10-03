'use client';

import { createContext, use } from 'react';
import { DEFAULT_TZ, zoneOf } from '@/lib/dates';

// The app's time zone in client components. The server knows it (picked in Settings, where the
// browser's own zone is offered) and passes it down, so a day shows the same in the list and in a window.

const Tz = createContext(DEFAULT_TZ);

export function TimeZone({ tz, children }: { tz: string; children: React.ReactNode }) {
  return <Tz value={tz}>{children}</Tz>;
}

/** The date helpers in the app's time zone. */
export const useZone = () => zoneOf(use(Tz));
