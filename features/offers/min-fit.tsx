'use client';

import { useId, useOptimistic, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { ActionError, useAction } from '@/components/use-action';
import { cn } from '@/lib/shared/cn';
import { setMinFitAction } from './actions';

// The list's minimum AI fit (lib/listings/settings.ts minFit), next to the AI fit chips: a setting, not
// part of the URL, so it stays while you filter and page, until you clear it here. A number typed is
// saved with Enter, Hide, or by leaving the box.

const BOX = 'flex items-center gap-1.5 text-[13px] text-muted-foreground';
const PILL = 'inline-flex h-7 items-center rounded-full border px-2.5 text-[13px]';

export function MinFit({ minFit }: { minFit: number }) {
  const id = useId();
  const { busy, error, run } = useAction();
  const [shown, setShown] = useOptimistic(minFit);
  const [text, setText] = useState('');
  const sent = useRef<string | null>(null); // the text last saved, so leaving the box again (or Hide) doesn't save it twice
  const save = (value: number) =>
    run(
      () => setMinFitAction({ minFit: value }),
      () => setShown(value),
    );
  const commit = () => {
    if (!text.trim() || text === sent.current) return;
    sent.current = text;
    save(Number(text));
  };

  return (
    <div className={BOX} aria-busy={busy || undefined}>
      {shown > 0 ? (
        // "Under 50% hidden ×"
        <span className={cn(PILL, 'gap-1 border-foreground bg-foreground pr-1 text-background')}>
          Under {shown}% hidden
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-full hover:bg-background/20"
            aria-label={`Show the offers under ${shown}% again`}
            onClick={() => {
              setText('');
              save(0);
            }}
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      ) : (
        <form
          className={BOX}
          noValidate // the action's schema says what's wrong ("A fit is 0–100%."), as the Settings forms do
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <label htmlFor={id}>Hide under</label>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={5}
            placeholder="50"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              sent.current = null;
            }}
            onBlur={commit}
            className={cn(PILL, 'w-16 bg-card text-foreground placeholder:text-muted-foreground/60')}
          />
          %
          {text.trim() && (
            <button type="submit" className={cn(PILL, 'bg-card text-foreground hover:border-foreground')}>
              Hide
            </button>
          )}
        </form>
      )}
      <ActionError error={error} className="mt-0 py-1" />
    </div>
  );
}
