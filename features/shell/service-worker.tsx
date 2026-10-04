'use client';

import { useEffect } from 'react';
import { pushSupported, registerServiceWorker } from '@/features/notifications/push-browser';

/**
 * Registers public/sw.js on every page: an installed app (the PWA) needs one, and it's what shows push
 * notifications. It caches nothing. Renders nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!pushSupported()) return;
    registerServiceWorker().catch(() => {}); // a browser that refuses it just has no push
  }, []);
  return null;
}
