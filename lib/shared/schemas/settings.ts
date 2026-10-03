// Shared by the server and client components.
import { z } from 'zod';
import { isTimeZone } from '../../dates';
import { DEFAULT_SETTINGS, INTERVALS, normalizeList, type ScrapeSettings } from '../../listings/settings';

const isInterval = (minutes: number) => (INTERVALS as readonly number[]).includes(minutes);

// ---- as stored ------------------------------------------------------------------------------

const words = (fallback: string[]) =>
  z
    .array(z.coerce.string())
    .transform((list) =>
      list
        .map((word) => word.trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((word) => word.slice(0, 60)),
    )
    .catch(fallback);
const hour = (fallback: number) => z.int().min(0).max(24).catch(fallback);
const flag = (fallback: boolean) => z.boolean().catch(fallback);
const zoneOrNone = z.string().refine(isTimeZone).catch('');

const defaults = DEFAULT_SETTINGS;
/** The settings as stored (any shape, maybe from an older version): what's missing or wrong is the default. */
export const storedSettingsSchema: z.ZodType<ScrapeSettings> = z
  .object({
    enabled: flag(defaults.enabled),
    everyMinutes: z.number().refine(isInterval).catch(defaults.everyMinutes),
    fromHour: hour(defaults.fromHour),
    toHour: hour(defaults.toHour),
    keywords: words(defaults.keywords),
    cities: words(defaults.cities),
    remoteOk: flag(defaults.remoteOk),
    ignore: words(defaults.ignore),
    mute: words(defaults.mute),
    notify: flag(defaults.notify),
    aiFilter: flag(defaults.aiFilter),
    timeZone: zoneOrNone,
    browserTimeZone: zoneOrNone,
  })
  .catch(() => ({ ...defaults }));

// ---- what the Settings page sends -------------------------------------------------------------

const HOURS = 'Hours are 0–24.';
const INTERVAL = 'Pick an interval from the list.';

export const scheduleSchema = z.object({
  everyMinutes: z.number({ error: INTERVAL }).refine(isInterval, INTERVAL),
  fromHour: z.int({ error: HOURS }).min(0, HOURS).max(24, HOURS),
  toHour: z.int({ error: HOURS }).min(0, HOURS).max(24, HOURS),
});

/** '' = the browser's; `browser` is the zone the browser is in now (kept only if it is one). */
export const timeZoneSchema = z.object({
  tz: z.string({ error: 'Unknown time zone.' }).refine((tz) => tz === '' || isTimeZone(tz), 'Unknown time zone.'),
  browser: z
    .string()
    .default('')
    .transform((tz) => (isTimeZone(tz) ? tz : undefined)),
});

export const browserTimeZoneSchema = z.object({ tz: z.string() });

/** The lists come as typed ("React, Vue"); normalizeList is what's kept, on both sides. */
const list = z.string().default('').transform(normalizeList);
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
