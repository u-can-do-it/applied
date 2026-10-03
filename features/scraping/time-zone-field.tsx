'use client';

import { useMemo, useOptimistic, useSyncExternalStore } from 'react';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { deviceTimeZone, timeZones, zoneName } from '@/lib/dates';
import { setTimeZoneAction } from './actions';

const noSubscribe = () => () => {};

/**
 * The app's time zone. Only a pick here changes it (and Supabase Cron's hours with it): the browser's
 * zone is offered, never saved on its own, so two browsers in different zones don't take turns.
 * `value`: the zone picked ('' = none yet); `effective`: the one the app uses meanwhile.
 */
export function TimeZoneField({ value, effective }: { value: string; effective: string }) {
  const save = useAction();
  const [shown, show] = useOptimistic(value);
  // only the browser knows its zone: none in the server's HTML, then this one's
  const device = useSyncExternalStore(noSubscribe, deviceTimeZone, () => null);
  const zones = useMemo(() => timeZones(), []);
  const pick = (tz: string) =>
    save.run(
      () => setTimeZoneAction({ tz }),
      () => show(tz),
    );
  const current = shown || effective;
  const suggest = device && (device !== current || !shown);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="inline-flex max-w-full min-w-0 flex-1 items-center gap-1.5 text-sm whitespace-nowrap">
        Time zone
        <NativeSelect
          className="max-w-[340px] min-w-0 flex-1"
          value={shown}
          aria-busy={save.busy || undefined}
          onChange={(event) => event.target.value && pick(event.target.value)}
        >
          {!shown && (
            <NativeSelectOption value="" disabled>
              Not picked yet ({zoneName(effective)} for now)
            </NativeSelectOption>
          )}
          {zones.map((tz) => (
            <NativeSelectOption key={tz} value={tz}>
              {zoneName(tz)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {suggest && (
        <p className="m-0 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          Your browser is in {zoneName(device)}
          {device === current ? ', the zone the app uses' : ''}.
          <Button type="button" variant="outline" size="xs" disabled={save.busy} onClick={() => pick(device)}>
            Use {zoneName(device)}
          </Button>
        </p>
      )}
      <ActionError error={save.error} className="mt-1 basis-full" />
    </div>
  );
}
