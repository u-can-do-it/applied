'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const AD_PLACEHOLDER = 'Paste the ad as the board shows it: what the role is, the stack, the requirements…';

/**
 * The ad in an offer's window as you edit it, in the place and size of its text (AdText). Saving keeps
 * it as the job's ad; the AI then judges the job from it.
 */
export function AdEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <>
      <Textarea
        aria-label="The ad text"
        className="min-h-[180px] flex-[1_0_auto]! rounded-lg bg-background px-3.5 py-3 leading-[1.55] md:text-sm"
        placeholder={AD_PLACEHOLDER}
        value={value}
        disabled={saving}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="-mt-1.5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || !value.trim()}
          aria-busy={saving || undefined}
          title="Keeps it as the job's ad, and asks the AI again from it"
          onClick={onSave}
        >
          Save the ad
        </Button>
      </div>
    </>
  );
}
