// Shared by the server and client components.
import * as z from 'zod/mini';
import { isTimeZone } from '../../dates';
import {
  DEFAULT_SETTINGS,
  INTERVALS,
  normalizeList,
  WEEKEND_INTERVALS,
  type ScrapeSettings,
} from '../../listings/settings';
import { string } from './common';

const isInterval = (minutes: number) => (INTERVALS as readonly number[]).includes(minutes);
const isWeekendInterval = (minutes: number) => (WEEKEND_INTERVALS as readonly number[]).includes(minutes);

// ---- as stored ------------------------------------------------------------------------------

const words = (fallback: string[]) =>
  z.catch(
    z.pipe(
      z.array(z.coerce.string()),
      z.transform((list: string[]) =>
        list
          .map((word) => word.trim())
          .filter(Boolean)
          .slice(0, 50)
          .map((word) => word.slice(0, 60)),
      ),
    ),
    fallback,
  );
const hour = (fallback: number) => z.catch(z.int().check(z.minimum(0), z.maximum(24)), fallback);
const flag = (fallback: boolean) => z.catch(z.boolean(), fallback);
const zoneOrNone = z.catch(z.string().check(z.refine(isTimeZone)), '');

const defaults = DEFAULT_SETTINGS;
/** The settings as stored (any shape, maybe from an older version): what's missing or wrong is the default. */
export const storedSettingsSchema: z.ZodMiniType<ScrapeSettings> = z.catch(
  z.object({
    enabled: flag(defaults.enabled),
    everyMinutes: z.catch(z.number().check(z.refine(isInterval)), defaults.everyMinutes),
    weekendEveryMinutes: z.catch(z.number().check(z.refine(isWeekendInterval)), defaults.weekendEveryMinutes),
    fromHour: hour(defaults.fromHour),
    toHour: hour(defaults.toHour),
    keywords: words(defaults.keywords),
    cities: words(defaults.cities),
    remoteOk: flag(defaults.remoteOk),
    ignore: words(defaults.ignore),
    mute: words(defaults.mute),
    notify: flag(defaults.notify),
    aiFilter: flag(defaults.aiFilter),
    telegramEnabled: flag(defaults.telegramEnabled),
    timeZone: zoneOrNone,
    browserTimeZone: zoneOrNone,
  }),
  () => ({ ...defaults }),
);

// ---- what the Settings page sends -------------------------------------------------------------

const HOURS = 'Hours are 0–24.';
const INTERVAL = 'Pick an interval from the list.';
const WEEKEND_INTERVAL = 'Weekends: 30 min or longer.';
const hourOfDay = z.int({ error: HOURS }).check(z.minimum(0, HOURS), z.maximum(24, HOURS));

export const scheduleSchema = z.object({
  everyMinutes: z.number({ error: INTERVAL }).check(z.refine(isInterval, INTERVAL)),
  weekendEveryMinutes: z.number({ error: WEEKEND_INTERVAL }).check(z.refine(isWeekendInterval, WEEKEND_INTERVAL)),
  fromHour: hourOfDay,
  toHour: hourOfDay,
});

/** The app's time zone, picked in Settings (the browser's is only offered there). */
export const timeZoneSchema = z.object({
  tz: z.string({ error: 'Unknown time zone.' }).check(z.refine(isTimeZone, 'Unknown time zone.')),
});

/** The lists come as typed ("React, Vue"); normalizeList is what's kept, on both sides. */
const list = z.pipe(string(), z.transform(normalizeList));
export const filtersSchema = z.object({
  keywords: list,
  cities: list,
  remoteOk: z.boolean(),
  ignore: list,
  mute: list,
});

export const pausedSchema = z.object({ paused: z.boolean() });
export const switchSchema = z.object({ on: z.boolean() });
export const mutedSchema = z.object({ muted: z.boolean() });
