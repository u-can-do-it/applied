import { connection } from 'next/server';
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { checkDbHealth } from '@/lib/db/health';
import { DEFAULT_TZ, zoneOf, type Zone } from '@/lib/dates';
import { env } from '@/lib/env';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import {
  cronCheck,
  lastRunCheck,
  migrationsCheck,
  openAiCheck,
  overall,
  profileCheck,
  pushCheck,
  runChecks,
  scrapingCheck,
  telegramCheck,
  type HealthCheck,
  type HealthLevel,
} from '@/lib/health/checks';
import { botAnswer, cronInfo, profileList } from '@/lib/health/reads';
import { requestOrigin } from '@/lib/listings/schedule';
import { effectiveTimeZone } from '@/lib/listings/settings';
import * as pushRepo from '@/lib/db/repos/push-subscriptions';
import { pushConfigured, pushProblem } from '@/lib/push';
import { telegramReady } from '@/lib/telegram';
import { appSettings } from '@/lib/time-zone';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/shared/cn';
import { HealthFix } from './health-fix';

// Settings' first card: is everything connected and working? Each row is checked on its own: one
// that fails to check is a red row, and the card still shows. Closed, it's its heading and the summary
// line; the rows open underneath.

const LEVEL: Record<HealthLevel, { icon: typeof CircleCheckIcon; text: string; className: string }> = {
  ok: { icon: CircleCheckIcon, text: 'OK', className: 'text-success' },
  warn: { icon: CircleAlertIcon, text: 'Needs attention', className: 'text-warning' },
  error: { icon: CircleXIcon, text: 'Problem', className: 'text-destructive' },
};

const SUMMARY: Record<HealthLevel, string> = {
  ok: 'Everything is connected and working.',
  warn: 'Working, with something to set up or look at.',
  error: 'Something is broken.',
};

/**
 * How long the card waits for the bot. Telegram can be slow (its own limit is 15 s); the card doesn't
 * wait for it beyond this, and the Telegram panel below, in a Suspense of its own, gets the answer.
 */
const TELEGRAM_WAIT_MS = 3000;

/** The answer, or "didn't answer" after `ms` (the call goes on, for whoever else waits for it). */
async function withinTime<T>(answer: Promise<T>, ms: number): Promise<T | { error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ error: string }>((resolve) => {
    timer = setTimeout(() => resolve({ error: `no answer within ${ms / 1000} s` }), ms);
  });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A time today as "14:35", another day's with its date. */
const timeIn = (zone: Zone, now: number) => (iso: string) =>
  zone.day(iso) === zone.day(now) ? zone.formatTime(iso) : zone.formatDateTime(iso);

export async function HealthCard() {
  await connection();
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request: "now" is that request's time
  const now = Date.now();
  const origin = await requestOrigin();
  const when = appSettings()
    .then((settings) => timeIn(zoneOf(effectiveTimeZone(settings)), now))
    .catch(() => timeIn(zoneOf(DEFAULT_TZ), now));
  // subscribed devices: asked once for both rows; not migrated yet (a new table) is the push row's error
  const devices = pushConfigured() ? pushRepo.size() : Promise.resolve(0);
  devices.catch(() => {}); // the push row reports it; the Telegram row reads it as no devices
  // Telegram set up and not switched off in Settings (unreadable settings: as it was, on)
  const telegramEnabled = appSettings()
    .then((settings) => settings.telegramEnabled)
    .catch(() => true);
  const checks: HealthCheck[] = [
    { id: 'db', label: 'Database', check: async () => migrationsCheck(await checkDbHealth()) },
    { id: 'scraping', label: 'Scraping', check: async () => scrapingCheck(await appSettings()) },
    {
      id: 'cron',
      label: 'Supabase Cron',
      check: async () => cronCheck(await cronInfo(), await appSettings(), `${origin}/api/cron/scrape`, await when),
    },
    {
      id: 'last-run',
      label: 'Last scrape run',
      check: async () => lastRunCheck((await runsRepo.list(1)).at(0) ?? null, now, await when),
    },
    {
      id: 'telegram',
      label: 'Telegram',
      check: async () => {
        const enabled = await telegramEnabled;
        return telegramCheck({
          ready: telegramReady(),
          enabled,
          // switched off: the row doesn't wait for the bot
          bot: enabled ? await withinTime(botAnswer(), TELEGRAM_WAIT_MS) : null,
          webhookUrl: `${origin}/api/telegram`,
          notify: (await appSettings()).notify,
          pushOn: (await devices.catch(() => 0)) > 0,
        });
      },
    },
    {
      id: 'push',
      label: 'Push',
      check: async () =>
        pushCheck({
          problem: pushProblem(),
          devices: await devices,
          notify: (await appSettings()).notify,
          telegram: telegramReady() && (await telegramEnabled),
        }),
    },
    { id: 'openai', label: 'OpenAI', check: () => openAiCheck(Boolean(env.OPENAI_API_KEY)) },
    { id: 'profile', label: 'AI profile', check: async () => profileCheck(await profileList()) },
  ];
  const rows = await runChecks(checks);
  const level = overall(rows);

  return (
    <Card className="mb-3.5 py-3.5" role="region" aria-labelledby="health-h">
      <Collapsible className="flex flex-col gap-2">
        <CardHeader className="px-4">
          <h2 className="m-0 text-base font-semibold">
            <CollapsibleTrigger className="group flex w-full cursor-pointer flex-wrap items-center gap-x-3 text-left">
              <HealthHeading />
              <span className={cn('text-xs font-normal', LEVEL[level].className)}>{SUMMARY[level]}</span>
            </CollapsibleTrigger>
          </h2>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="px-4">
            <ul className="m-0 list-none border-t p-0">
              {rows.map((row) => {
                const { icon: Icon, text, className } = LEVEL[row.level];
                return (
                  <li
                    key={row.id}
                    data-level={row.level}
                    className="grid grid-cols-[auto_9rem_1fr_auto] items-center gap-x-2.5 gap-y-1 border-b py-2 text-sm max-[640px]:grid-cols-[auto_1fr]"
                  >
                    <Icon className={cn('size-4', className)} role="img" aria-label={text} />
                    <span className="font-medium">{row.label}</span>
                    <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere] max-[640px]:col-start-2">
                      {row.reason}
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-2 max-[640px]:col-start-2 max-[640px]:justify-start">
                      {row.fix && <HealthFix fix={row.fix} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** The chevron (turned down while open) and the name, which labels the card's region. */
function HealthHeading() {
  return (
    <span className="flex items-center gap-1.5">
      <ChevronRightIcon
        aria-hidden="true"
        className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
      />
      <span id="health-h">Health</span>
    </span>
  );
}

export function HealthCardFallback() {
  // the closed card's height, so the rows coming in don't move the panels below
  return (
    <Card className="mb-3.5 py-3.5" aria-busy="true" aria-label="Checking health">
      <CardHeader className="px-4">
        <h2 className="m-0 flex flex-wrap items-center gap-x-3 text-base font-semibold">
          <HealthHeading />
          <span className="text-xs font-normal text-muted-foreground">Checking…</span>
        </h2>
      </CardHeader>
    </Card>
  );
}
