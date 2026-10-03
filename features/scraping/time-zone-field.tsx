'use client';

import { useMemo, useOptimistic, useSyncExternalStore } from 'react';
import { ActionError, useAction } from '@/components/use-action';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { deviceTimeZone, timeZones, zoneName } from '@/lib/dates';
import { setTimeZoneAction } from './actions';

const noSubscribe = () => () => {};

/** The app's time zone: this browser's (the default: it follows the browser you open the app in), or a fixed one. */
export function TimeZoneField({ value }: { value: string }) {
  const save = useAction();
  const [shown, show] = useOptimistic(value);
  // only the browser knows its zone: none in the server's HTML, then this one's
  const device = useSyncExternalStore(noSubscribe, deviceTimeZone, () => null);
  const zones = useMemo(() => timeZones(), []);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="inline-flex max-w-full min-w-0 flex-1 items-center gap-1.5 text-sm whitespace-nowrap">
        Time zone
        <NativeSelect
          className="max-w-[340px] min-w-0 flex-1"
          value={shown}
          aria-busy={save.busy || undefined}
          onChange={(event) => {
            const next = event.target.value;
            save.run(
              () => setTimeZoneAction({ tz: next, browser: device ?? '' }),
              () => show(next),
            );
          }}
        >
          <NativeSelectOption value="">This browser’s{device ? ` (${zoneName(device)})` : ''}</NativeSelectOption>
          {zones.map((tz) => (
            <NativeSelectOption key={tz} value={tz}>
              {zoneName(tz)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <p className="m-0 basis-full text-xs text-muted-foreground">
        For the hours above, and every day and time the app shows (lists, date filters, Telegram).
      </p>
      <ActionError error={save.error} className="mt-1 basis-full" />
    </div>
  );
}
