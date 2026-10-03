// What the scraping settings hold. Shared by the server and the Settings page (no secrets here).

import { DEFAULT_TZ } from '../dates';

export type ScrapeSettings = {
  /** scheduled runs (the endpoint skips while off); "Scrape now" works either way */
  enabled: boolean;
  everyMinutes: number;
  /** in the app's time zone (timeZone): runs from fromHour:00 until toHour:00 */
  fromHour: number;
  toHour: number;
  keywords: string[];
  /** part of a city name ("warszaw" matches Warszawa and Warszawie); empty = anywhere */
  cities: string[];
  /** remote offers pass the city filter */
  remoteOk: boolean;
  /** titles with these words are not saved at all */
  ignore: string[];
  /** titles with these words are saved but not sent to Telegram */
  mute: string[];
  /** send new offers to Telegram */
  notify: boolean;
  /** check new offers against the active AI profile first; Telegram gets only the matches */
  aiFilter: boolean;
  /** the app's time zone (days, times, date filters, the hours above): '' = the browser's, else a fixed one */
  timeZone: string;
  /** the zone of the browser the app was last opened in (what '' follows) */
  browserTimeZone: string;
};

export const DEFAULT_SETTINGS: ScrapeSettings = {
  enabled: true,
  everyMinutes: 5,
  fromHour: 7,
  toHour: 22,
  keywords: ['React'],
  cities: ['warszaw', 'warsaw'],
  remoteOk: true,
  ignore: [],
  mute: ['.net', 'dotnet', 'go', 'golang', 'java'],
  notify: true,
  aiFilter: true,
  timeZone: '',
  browserTimeZone: '',
};

export const INTERVALS = [5, 10, 15, 30, 60, 120] as const;

/** The zone the app runs in: the one picked, else the browser's (as last reported), else DEFAULT_TZ. */
export const effectiveTimeZone = (s: Pick<ScrapeSettings, 'timeZone' | 'browserTimeZone'> | null | undefined) =>
  s?.timeZone || s?.browserTimeZone || DEFAULT_TZ;

/** "a, b ,c" -> ['a', 'b', 'c'] */
export const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
/** what a typed list is saved as: at most 50 words of 60 characters */
export const normalizeList = (s: string) =>
  splitList(s)
    .slice(0, 50)
    .map((w) => w.slice(0, 60));
