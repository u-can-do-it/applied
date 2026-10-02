import 'server-only';
import { cache } from 'react';
import { zone } from './dates';
import { effectiveTimeZone } from './scraping/kinds';
import { getSettings } from './scraping/store';

// The app's time zone on the server, read once per request (React.cache). Without the scraping
// tables yet (or with Supabase down) it's DEFAULT_TZ, as it always was.

export const appSettings = cache(() => getSettings().catch(() => null));

export const appTimeZone = cache(async () => effectiveTimeZone(await appSettings()));

/** The date helpers in the app's time zone. */
export const appZone = async () => zone(await appTimeZone());
