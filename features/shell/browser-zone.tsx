'use client';

import { startTransition, useEffect } from 'react';
import { deviceTimeZone } from '@/lib/dates';
import { reportBrowserTimeZoneAction } from './actions';

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
