'use client';

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, useTransition, type Ref } from 'react';
import { CheckIcon, SparklesIcon } from 'lucide-react';
import { isLink } from '@/lib/boards';
import type { OfferAd } from '@/lib/offer-window';
import { cn } from '@/lib/shared/cn';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { useAutosave, type AutosaveSave, type AutosaveStatus } from '@/components/use-autosave';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { setJobAdAction, setJobAdFromLinkAction } from './actions';

export const AD_PLACEHOLDER = 'Paste the ad as the board shows it: what the role is, the stack, the requirements…';
export const LINK_PLACEHOLDER = 'Or paste a link to the ad (the company’s page, say): the AI fills it in';

export type AdEditorHandle = {
  /** saves what's left; resolves with why it wasn't saved, or null once it is */
  settle: () => Promise<string | null>;
};

const STATUS: Record<AutosaveStatus, string> = {
  idle: '',
  typing: '…',
  saving: 'saving…',
  saved: 'saved',
  error: 'not saved',
};

/**
 * The ad in an offer's window as you edit it, in the place and size of its text (AdText). It saves
 * itself as the job's ad: at once when you paste, else when you stop typing or leave the box. A link
 * pasted (or Enter) reads the ad from its page, with what the board didn't say besides. `onSaved`: each
 * save's ad, as the window now shows it; `onDone`: you're done editing, everything saved.
 */
export function AdEditor({
  jobId,
  initial,
  onSaved,
  onDone,
  ref,
}: {
  jobId: string;
  initial: string;
  onSaved: (ad: OfferAd) => void;
  onDone: () => void;
  ref: Ref<AdEditorHandle>;
}) {
  const [text, setText] = useState(initial);
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [finishing, startFinishing] = useTransition();
  const pasted = useRef(false);
  const failed = useRef<string | null>(null);

  const save: AutosaveSave<string> = async (content) => {
    try {
      onSaved(unwrap(await setJobAdAction({ jobId, content })));
      failed.current = null;
      setProblem(null);
      return true;
    } catch (failure) {
      failed.current = message(failure);
      setProblem(failed.current);
      return false;
    }
  };
  // what's saved is the text without the blank around it; an empty box isn't an ad: nothing is saved
  const ad = text.trim();
  const autosave = useAutosave(ad, save, { delay: 1000, saved: initial.trim(), blocked: () => !ad });
  const settle = async () => {
    await autosave.flush();
    return autosave.stored() === ad || !ad ? null : (failed.current ?? 'The ad isn’t saved yet.');
  };
  useImperativeHandle(ref, () => ({ settle }));

  // pasted: saved at once (once the text is in, for flush() to send it)
  const flushPasted = useEffectEvent(() => {
    if (!pasted.current) return;
    pasted.current = false;
    void autosave.flush();
  });
  useEffect(() => flushPasted(), [ad]);

  const readLink = (value: string) => {
    if (!isLink(value) || reading) return;
    setProblem(null);
    setWarning(null);
    startReading(async () => {
      try {
        await autosave.flush(); // what you typed goes first: the page's ad is saved over it
        const { warning, ...read } = unwrap(await setJobAdFromLinkAction({ jobId, link: value.trim() }));
        const content = read.content ?? '';
        setText(content);
        autosave.reset(content.trim(), 'saved');
        setLink('');
        setWarning(warning ?? null);
        onSaved(read);
      } catch (failure) {
        setProblem(message(failure));
      }
    });
  };

  const done = () =>
    startFinishing(async () => {
      const why = await settle();
      if (why) setProblem(why);
      else onDone();
    });

  const status = ad ? STATUS[autosave.status] : '';
  return (
    <>
      <div className="flex gap-2 max-[560px]:flex-col max-[560px]:items-stretch">
        <Input
          aria-label="Link to the ad"
          className="flex-1 bg-background"
          placeholder={LINK_PLACEHOLDER}
          inputMode="url"
          spellCheck={false}
          value={link}
          disabled={reading}
          onChange={(event) => setLink(event.target.value)}
          // a link pasted is read at once, as Enter or the button do
          onPaste={(event) => {
            const pastedLink = event.clipboardData.getData('text');
            if (!isLink(pastedLink)) return;
            event.preventDefault();
            setLink(pastedLink.trim());
            readLink(pastedLink);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            readLink(link);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!isLink(link) || reading}
          aria-busy={reading || undefined}
          onClick={() => readLink(link)}
        >
          {reading ? (
            'Reading the page…'
          ) : (
            <>
              <SparklesIcon /> Fill in from the link
            </>
          )}
        </Button>
      </div>
      {warning && <p className="m-0 -mt-1.5 text-xs text-warning">{warning}</p>}
      <Textarea
        aria-label="The ad text"
        className="min-h-[180px] flex-[1_0_auto]! rounded-lg bg-background px-3.5 py-3 leading-[1.55] md:text-sm"
        placeholder={AD_PLACEHOLDER}
        value={text}
        disabled={reading}
        autoFocus
        onPaste={() => {
          pasted.current = true;
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void autosave.flush()}
      />
      {problem && (
        <p className="m-0 -mt-1.5 text-[13px] text-destructive" role="alert">
          {problem}
        </p>
      )}
      <div className="-mt-1.5 flex items-center justify-end gap-2">
        <span
          className={cn('mr-auto text-xs text-muted-foreground', autosave.status === 'error' && 'text-warning')}
          aria-live="polite"
        >
          {status && (
            <>
              The ad · {status}
              {autosave.status === 'saved' && (
                <>
                  {' '}
                  <CheckIcon className="inline size-3.5" />
                </>
              )}
            </>
          )}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={reading || finishing}
          aria-busy={finishing || undefined}
          title="Saves what’s left, and asks the AI again from the ad if you changed it"
          onClick={done}
        >
          Done
        </Button>
      </div>
    </>
  );
}
