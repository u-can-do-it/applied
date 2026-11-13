'use client';

import { useEffect } from 'react';
import { clearNotifications, pushSupported, registerServiceWorker } from '@/features/notifications/push-browser';

/**
 * Registers public/sw.js on every page: an installed app (the PWA) needs one, and it's what shows push
 * notifications. It caches nothing. Opening the app, or coming back to it, takes down the notifications
 * still showing: what they said is on the screen now. One that arrives while you're looking at the app
 * stays (a test notification, say) until the next time you come back. Renders nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!pushSupported()) return;
    registerServiceWorker().catch(() => {}); // a browser that refuses it just has no push
    const clear = () => {
      if (document.visibilityState !== 'visible') return;
      clearNotifications().catch(() => {}); // they stay until they're tapped or swiped away, as before
    };
    clear();
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  }, []);
  return null;
}
