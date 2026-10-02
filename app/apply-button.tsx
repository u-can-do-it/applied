'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { formatDay, todayInWarsaw } from '@/lib/dates';
import { applyAction, unapplyAction } from './actions';

const warsawDay = (iso: string) => todayInWarsaw(Date.parse(iso)); // YYYY-MM-DD in Warsaw

/** "Mark applied" / "✓ Applied 02.10.2026" - flips on the click frame, the server catches up. */
export function ApplyButton({ jobKey, src, id, appliedAt }: { jobKey: string; src: string; id: string; appliedAt: string | null }) {
  const [applied, setApplied] = useOptimistic(appliedAt);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    if (applied && !confirm('Unmark as applied? The saved ad text is deleted too.')) return;
    start(async () => {
      setError(null);
      setApplied(applied ? null : new Date().toISOString());
      const res = applied ? await unapplyAction(jobKey) : await applyAction({ key: jobKey, src, id });
      if (res.error) setError(res.error);
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
        {applied ? `✓ Applied ${formatDay(warsawDay(applied))}` : 'Mark applied'}
      </button>
      {error && <span className="form-error small">{error}</span>}
    </>
  );
}
