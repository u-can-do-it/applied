'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Where the browser refuses the clipboard API (an embedded browser, no permission): the old way, a hidden
 * field's text selected and copied. Whether it worked.
 */
function copyBySelection(text: string) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the fallback is the point
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

/**
 * After the title (and its link's icon): copies the job's title to the clipboard, a check mark saying so
 * for a moment. Shown with the row under the pointer or the button focused; always on a touch screen.
 */
export function CopyTitle({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      title="Copy the title"
      aria-label={copied ? 'Title copied' : 'Copy the title'}
      onClick={() =>
        void navigator.clipboard.writeText(title).then(
          () => setCopied(true),
          () => (copyBySelection(title) ? setCopied(true) : toast.error('The browser didn’t let the title be copied.')),
        )
      }
      className="ml-1 inline-flex cursor-pointer align-[-2px] text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}
