'use client';

import { startTransition, useOptimistic, useState, useTransition } from 'react';
import { zone } from '@/lib/dates';
import { applyAction, unapplyAction } from './actions';

/** "Mark applied" / "✓ Applied 02.10.2026" - flips on the click frame, the server catches up. */
export function ApplyButton({
  jobKey,
  src,
  id,
  appliedAt,
  tz,
}: {
  jobKey: string;
  src: string;
  id: string;
  appliedAt: string | null;
  tz: string; // the app's time zone, for the day
}) {
  const [applied, setApplied] = useOptimistic(appliedAt);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    if (applied && !confirm('Unmark as applied? The saved ad text is deleted too.')) return;
    setError(null);
    start(async () => {
      setApplied(applied ? null : new Date().toISOString());
      const res = applied ? await unapplyAction(jobKey) : await applyAction({ key: jobKey, src, id });
      const failed = res.error;
      if (failed) startTransition(() => setError(failed));
    });
  };

  return (
    <>
      <button
        type="button"
        className={`apply${applied ? ' applied' : ''}`}
        onClick={toggle}
        aria-pressed={Boolean(applied)}
        aria-busy={pending || undefined}
        title={applied ? 'Click to unmark' : 'Saves that you applied, with the complete ad text'}
      >
        {applied ? `✓ Applied ${zone(tz).formatDayOf(applied)}` : 'Mark applied'}
      </button>
      {error && <span className="form-error small">{error}</span>}
    </>
  );
}
