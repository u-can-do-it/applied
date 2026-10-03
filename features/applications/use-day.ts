'use client';

import { useZone } from '@/components/time-zone';

/** "02.10.2026" of an instant, in the app's time zone */
export const useDay = () => {
  const zone = useZone();
  return (iso: string | null | undefined) => (iso ? zone.formatDayOf(iso) : '');
};
