'use client';

import { createContext, startTransition, use, useEffect } from 'react';
import { DEFAULT_TZ, deviceTimeZone, zoneOf } from '@/lib/dates';
import { reportBrowserTimeZoneAction } from './actions';

// The app's time zone in client components. The server knows it (Settings; by default the
// browser's) and passes it down, so a day shows the same in the list and in a window.

const Tz = createContext(DEFAULT_TZ);

export function TimeZone({ tz, children }: { tz: string; children: React.ReactNode }) {
  return <Tz value={tz}>{children}</Tz>;
}

/** The date helpers in the app's time zone. */
export const useZone = () => zoneOf(use(Tz));

/** Tells the server this browser's zone when it isn't the one it has ("the browser's" follows it). */
export function BrowserZone({ known }: { known: string }) {
  useEffect(() => {
    const mine = deviceTimeZone();
    if (mine === known) return;
    startTransition(async () => {
      // the answer doesn't matter: if it didn't get through, the next page load tells it again
      await reportBrowserTimeZoneAction({ tz: mine }).catch(() => null);
    });
  }, [known]);
  return null;
}
