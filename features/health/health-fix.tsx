'use client';

import Link from 'next/link';
import { Code } from '@/components/field';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import type { HealthFix as Fix } from '@/lib/health/checks';
import { cronConnectAction, setScrapingPausedAction } from '@/features/scraping/actions';
import { telegramConnectAction } from '@/features/telegram/actions';

const ACTIONS = {
  connectCron: cronConnectAction,
  connectTelegram: telegramConnectAction,
  resumeScraping: () => setScrapingPausedAction({ paused: false }),
} satisfies Record<Extract<Fix, { type: 'action' }>['action'], unknown>;

/** The one thing that fixes a Health row: a link, a button (the panel's own action), or what to run or set. */
export function HealthFix({ fix }: { fix: Fix }) {
  const act = useAction();
  if (fix.type === 'link')
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={fix.href}>{fix.label}</Link>
      </Button>
    );
  if (fix.type === 'hint')
    return (
      <span className="text-xs text-muted-foreground">
        {fix.text} <Code>{fix.code}</Code>
      </span>
    );
  const action = ACTIONS[fix.action];
  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={act.busy}
        aria-busy={act.busy || undefined}
        onClick={() => act.run(action)}
      >
        {act.busy ? 'Working…' : fix.label}
      </Button>
      <ActionError error={act.error} className="mt-0 basis-full" />
    </>
  );
}
