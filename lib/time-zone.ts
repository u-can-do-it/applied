import 'server-only';
import { cache } from 'react';
import { zone } from './dates';
import { effectiveTimeZone } from './scraping/kinds';
import * as settingsRepo from './db/repos/scrape-settings';

// The app's time zone on the server, read once per request (React.cache).

export const appSettings = cache(() => settingsRepo.get());

export const appTimeZone = cache(async () => effectiveTimeZone(await appSettings()));

/** The date helpers in the app's time zone. */
export const appZone = async () => zone(await appTimeZone());
