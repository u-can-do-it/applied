'use client';

import { useEffect, useState } from 'react';
import { BellRingIcon, CheckIcon } from 'lucide-react';
import { Code } from '@/components/field';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { fail } from '@/lib/shared/result';
import type { PushSubscriptionInput } from '@/lib/shared/schemas/push';
import { BUTTONS, SMALL } from '@/features/scraping/panel-styles';
import { pushSubscribeAction, pushTestAction, pushUnsubscribeAction } from './actions';
import { currentSubscription, pushSupported, subscribe } from './push-browser';

// Settings → Notifications → this device: push notifications on or off for the browser you're in.

type DeviceState = 'checking' | 'unsupported' | 'unconfigured' | 'blocked' | 'off' | 'on';

/** Where this browser stands: can it, may it, and is its subscription one the server has. */
async function detect(publicKey: string | null, known: string[]) {
  if (!pushSupported()) return { state: 'unsupported' as const, endpoint: null };
  if (!publicKey) return { state: 'unconfigured' as const, endpoint: null };
  if (Notification.permission === 'denied') return { state: 'blocked' as const, endpoint: null };
  const subscription = await currentSubscription();
  const endpoint = subscription?.endpoint ?? null;
  const on = endpoint !== null && Notification.permission === 'granted' && known.includes(endpoint);
  return { state: on ? ('on' as const) : ('off' as const), endpoint };
}

const plural = (count: number) => `${count} device${count === 1 ? '' : 's'}`;

export function PushDevice({ publicKey, endpoints }: { publicKey: string | null; endpoints: string[] }) {
  const act = useAction();
  const [state, setState] = useState<DeviceState>('checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  // the server's list as one value: the effect runs again when it changes, not on every render
  const known = endpoints.join('\n');

  useEffect(() => {
    let current = true;
    detect(publicKey, known.split('\n'))
      .then((found) => {
        if (!current) return;
        setState(found.state);
        setEndpoint(found.endpoint);
      })
      .catch(() => {
        if (current) setState('unsupported');
      });
    return () => {
      current = false;
    };
  }, [publicKey, known]);

  const enable = (key: string) =>
    act.run(async () => {
      // asked on the click: browsers only ask in answer to one
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState('blocked');
        return fail('Notifications are blocked for this site: allow them in the browser’s site settings.');
      }
      if (permission !== 'granted') return fail('Notifications weren’t allowed.');
      const subscription = await subscribe(key);
      const answer = await pushSubscribeAction(subscription.toJSON() as PushSubscriptionInput);
      if (answer.ok) {
        setState('on');
        setEndpoint(subscription.endpoint);
      }
      return answer;
    });

  const disable = (mine: string) =>
    act.run(async () => {
      await (await currentSubscription())?.unsubscribe();
      setState('off');
      setEndpoint(null);
      return pushUnsubscribeAction({ endpoint: mine });
    });

  const others = endpoints.filter((other) => other !== endpoint).length;
  return (
    <div>
      <p className={SMALL}>
        {state === 'checking' && 'Checking this device…'}
        {state === 'on' && (
          <span className="text-success">
            <CheckIcon /> On for this device
          </span>
        )}
        {state === 'off' && 'Off for this device.'}
        {state === 'blocked' && (
          <span className="text-warning">
            Blocked: notifications are turned off for this site in the browser (site settings → Notifications → Allow),
            then reload.
          </span>
        )}
        {state === 'unsupported' && (
          <span className="text-warning">
            This browser can’t get push notifications. On Android, open the app in Chrome and install it (menu → Add to
            Home screen).
          </span>
        )}
        {state === 'unconfigured' && (
          <span className="text-warning">
            Not set up on the server: set <Code>VAPID_PUBLIC_KEY</Code>, <Code>VAPID_PRIVATE_KEY</Code> and{' '}
            <Code>VAPID_SUBJECT</Code> (the <q>?</q> above says how).
          </span>
        )}
        {state !== 'checking' && others > 0 && ` · also on ${plural(others)}`}
      </p>
      {publicKey && (state === 'off' || state === 'on') && (
        <div className={BUTTONS}>
          {state === 'off' && (
            <Button
              type="button"
              disabled={act.busy}
              aria-busy={act.busy || undefined}
              onClick={() => enable(publicKey)}
            >
              <BellRingIcon /> {act.busy ? 'Enabling…' : 'Enable notifications on this device'}
            </Button>
          )}
          {state === 'on' && endpoint && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={act.busy}
                onClick={() => act.run(() => pushTestAction({ endpoint }))}
              >
                Send a test notification
              </Button>
              <Button type="button" variant="outline" disabled={act.busy} onClick={() => disable(endpoint)}>
                Disable on this device
              </Button>
            </>
          )}
        </div>
      )}
      <ActionError error={act.error} />
    </div>
  );
}
