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
  /** titles with these words are saved but not notified */
  mute: string[];
  /** send new offers (every notification channel) */
  notify: boolean;
  /** check new offers against the active AI profile first; the channels get only the matches */
  aiFilter: boolean;
  /** Telegram gets new offers and answers commands; off keeps the bot and its webhook, silent */
  telegramEnabled: boolean;
  /** the app's time zone (days, times, date filters, the hours above), as picked in Settings; '' = none picked yet */
  timeZone: string;
  /**
   * The zone of the browser the app was opened in, kept by installs that never picked one in
   * Settings; they keep using it. Never written.
   */
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
  telegramEnabled: true,
  timeZone: '',
  browserTimeZone: '',
};

export const INTERVALS = [5, 10, 15, 30, 60, 120] as const;

/** The zone the app runs in: the one picked, else the browser's as last reported before that (older installs), else DEFAULT_TZ. */
export const effectiveTimeZone = (settings: Pick<ScrapeSettings, 'timeZone' | 'browserTimeZone'> | null | undefined) =>
  settings?.timeZone || settings?.browserTimeZone || DEFAULT_TZ;

/** from..to in whole hours; 22..6 runs over night; equal = all day */
export const inHours = (hour: number, from: number, to: number) =>
  from === to || (from < to ? hour >= from && hour < to : hour >= from || hour < to);

/** "a, b ,c" -> ['a', 'b', 'c'] */
export const splitList = (text: string) =>
  text
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
/** what a typed list is saved as: at most 50 words of 60 characters */
export const normalizeList = (text: string) =>
  splitList(text)
    .slice(0, 50)
    .map((word) => word.slice(0, 60));
