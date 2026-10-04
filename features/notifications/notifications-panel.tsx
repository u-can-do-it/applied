'use client';

import { useOptimistic } from 'react';
import { BellIcon, BellOffIcon, SparklesIcon } from 'lucide-react';
import { CheckField } from '@/components/field';
import { PanelHeading } from '@/components/help';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { BUTTONS, PANEL, SMALL, SUBHEAD } from '@/features/scraping/panel-styles';
import { ScrapeButton } from '@/features/scraping/scrape-button';
import { sendQueueAction, setAiFilterAction, setMutedAction, setNotifyAction } from './actions';
import { NotificationsHelp } from './notifications-help';
import { PushDevice } from './push-device';

// Settings → Notifications: where new offers go and what holds them, for every channel (Telegram and
// push), and push on this device. The toggles behave like the other panels': the new value shows at
// once (useOptimistic), "Saved." is a toast, what went wrong shows next to the control (useAction).

/** "Telegram and push (2 devices)", or null when nothing can send */
function channelsLine(telegram: boolean, devices: number) {
  const push = devices ? `push (${devices} device${devices === 1 ? '' : 's'})` : null;
  const names = [telegram ? 'Telegram' : null, push].filter(Boolean);
  return names.length ? names.join(' and ') : null;
}

export function NotificationsPanel({
  notify,
  muted,
  queued,
  ai,
  telegram,
  push,
}: {
  notify: boolean;
  muted: boolean;
  queued: number;
  /** the AI filter: on in settings, the active profile (if usable), whether OPENAI_API_KEY is set */
  ai: { on: boolean; profile: string | null; keySet: boolean };
  /** TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set */
  telegram: boolean;
  /** the VAPID public key (null: push isn't set up), and the subscribed devices' endpoints */
  push: { publicKey: string | null; endpoints: string[] };
}) {
  const act = useAction();
  // what the buttons show right away; the refreshed page brings the real values
  type View = { notify: boolean; muted: boolean; queued: number; aiOn: boolean };
  const [view, show] = useOptimistic<View, Partial<View>>({ notify, muted, queued, aiOn: ai.on }, (cur, patch) => ({
    ...cur,
    ...patch,
  }));
  const channels = channelsLine(telegram, push.endpoints.length);
  return (
    <Card className={PANEL} role="region" aria-labelledby="notifications-h">
      <CardHeader className="px-4">
        <PanelHeading id="notifications-h" title="Notifications" help={<NotificationsHelp />} />
      </CardHeader>
      <CardContent className="px-4">
        <p className={SMALL}>
          {channels ? (
            <>New offers go to {channels}.</>
          ) : (
            <span className="text-warning">
              Nothing sends new offers yet: enable this device below, or set up Telegram.
            </span>
          )}{' '}
          <a href="#health-h" className="text-brand underline-offset-4 hover:underline">
            Health
          </a>{' '}
          says whether each one works.
        </p>

        <h3 className={SUBHEAD}>This device</h3>
        <PushDevice publicKey={push.publicKey} endpoints={push.endpoints} />

        <h3 className={SUBHEAD}>New offers</h3>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm">
          <CheckField>
            <Switch
              checked={view.notify}
              onCheckedChange={(on) => {
                act.run(
                  () => setNotifyAction({ on }),
                  () => show({ notify: on }),
                );
              }}
            />
            Send new offers
          </CheckField>
          <span className="text-xs">
            {view.muted ? (
              <>
                <BellOffIcon /> Muted, {view.queued} waiting
              </>
            ) : (
              <>
                <BellIcon /> On{view.queued ? `, ${view.queued} waiting` : ''}
              </>
            )}
          </span>
        </div>
        <div className={BUTTONS}>
          <Button
            type="button"
            variant="outline"
            aria-busy={act.busy || undefined}
            onClick={() => {
              const mute = !view.muted;
              act.run(
                () => setMutedAction({ muted: mute }),
                () => show(mute ? { muted: true } : { muted: false, queued: 0 }),
              );
            }}
          >
            {view.muted ? 'Unmute and send' : 'Mute'}
          </Button>
          {view.queued > 0 && (
            <Button
              type="button"
              variant="outline"
              aria-busy={act.busy || undefined}
              onClick={() => act.run(sendQueueAction, () => show({ queued: 0 }))}
            >
              Send the {view.queued} now
            </Button>
          )}
          <ScrapeButton />
        </div>
        <CheckField className="mt-2.5">
          <Switch
            checked={view.aiOn}
            onCheckedChange={(on) => {
              act.run(
                () => setAiFilterAction({ on }),
                () => show({ aiOn: on }),
              );
            }}
          />
          <span>
            <SparklesIcon /> Only offers the AI profile matches{ai.profile ? ` (“${ai.profile}”)` : ''}
          </span>
        </CheckField>
        <p className="mt-0.5 mb-0 ml-10 text-xs text-muted-foreground">
          {!view.aiOn
            ? 'Off: every new offer is sent.'
            : !ai.keySet
              ? 'OPENAI_API_KEY isn’t set: until it is, every new offer is sent.'
              : !ai.profile
                ? 'No AI profile yet (AI filter tab → Profile): until then, every new offer is sent.'
                : 'On: only the matches are sent, with their fit.'}
        </p>
        <ActionError error={act.error} />
      </CardContent>
    </Card>
  );
}
