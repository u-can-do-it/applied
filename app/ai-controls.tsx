'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { startRunAction } from './actions';
import { ProfileDialog, type ProfileOption } from './profile-dialog';

type RunInfo = {
  id: string;
  label: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  phase: 'dedup' | 'assess';
  pairsChecked: number;
  merged: number;
  total: number;
  done: number;
  error: string | null;
  finishedAt: string | null;
  stale: boolean; // belongs to an older version of the profile
};

const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export function AiControls({ profiles, activeId, run, todayNew, range, aiConfigured, models }: {
  profiles: ProfileOption[];
  activeId: string | null;
  run: RunInfo | null;
  todayNew: number;
  range: { days: string; from: string; to: string; label: string; newCount: number } | null;
  aiConfigured: boolean;
  models: { assess: { model: string; effort: string }; dedup: { model: string; effort: string } };
}) {
  const router = useRouter();
  const dialog = useRef<{ open: () => void }>(null);
  const [starting, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const active = profiles.find((p) => p.id === activeId) ?? null;
  const usable = Boolean(active && (active.prompt.trim() || active.fileName));
  const running = run?.status === 'running' && !run.stale;

  // while a run is open, refresh so new verdicts show up and the next slice gets started
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(t);
  }, [running, run?.done, run?.pairsChecked, run?.phase, router]);

  const runFor = (input: { days?: string; from?: string; to?: string }) =>
    start(async () => {
      setMessage(null);
      const res = await startRunAction({ profileId: activeId!, ...input });
      setMessage(res.error ?? (res.message?.startsWith('Nothing') ? res.message : null));
    });

  const disabled = !usable || !aiConfigured || running || starting;
  const doneShown = run ? Math.min(run.done, run.total) : 0;
  const pct = run && run.total ? Math.round((doneShown / run.total) * 100) : 0;

  return (
    <div className="ai-bar">
      <div className="ai-row">
        <button type="button" className="ai-button" onClick={() => dialog.current?.open()}>
          ✦ {active ? active.name : 'Profile'} <span aria-hidden="true">▾</span>
        </button>

        {usable && (
        <button type="button" className="secondary" disabled={disabled || todayNew === 0} onClick={() => runFor({ days: '1' })}>
          {todayNew === 0 ? '✓ Today checked' : `Check today · ${todayNew} new`}
        </button>
        )}

        {usable && range && (
          <button
            type="button"
            className="secondary"
            disabled={disabled || range.newCount === 0}
            onClick={() => runFor({ days: range.days || undefined, from: range.from || undefined, to: range.to || undefined })}
            title="Uses the dates picked in the filter below"
          >
            {range.newCount === 0 ? `✓ ${range.label} checked` : `Check ${range.label} · ${range.newCount} new`}
          </button>
        )}
      </div>

      {!aiConfigured && <p className="form-error">OPENAI_API_KEY is not set on the server.</p>}
      {!active && <p className="muted small">Create a profile: what you&apos;re looking for, plus your CV.</p>}

      {running && run ? (
        run.phase === 'dedup' ? (
          <div className="ai-progress" role="status">
            <span className="dot busy" aria-hidden="true" />
            Looking for duplicates in {run.label}… {run.pairsChecked} pair{run.pairsChecked === 1 ? '' : 's'} checked
            {run.merged > 0 && <> · {run.merged} merged</>}
            <span className="muted small">
              {models.dedup.model} · {models.dedup.effort}
            </span>
          </div>
        ) : (
          <div className="ai-progress" role="status">
            <span className="dot busy" aria-hidden="true" />
            Checking {run.label}: {doneShown}/{run.total}
            {run.merged > 0 && <span className="muted small"> · {run.merged} duplicates merged</span>}
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="muted small">
              {models.assess.model} · {models.assess.effort}
            </span>
          </div>
        )
      ) : run && !run.stale && run.finishedAt ? (
        <p className={`muted small${run.status === 'failed' ? ' form-error' : ''}`}>
          Last run: {run.label} · {doneShown} checked
          {run.merged > 0 && <> · {run.merged} duplicate{run.merged === 1 ? '' : 's'} merged</>} ·{' '}
          {/* "3 min ago" depends on the clock: server and browser may differ by a minute, the browser wins */}
          <time dateTime={run.finishedAt} suppressHydrationWarning>
            {ago(run.finishedAt)}
          </time>
          {run.status === 'failed' && <> · failed: {run.error}</>}
          {run.status === 'cancelled' && <> · {run.error}</>}
          {run.status === 'done' && run.error && <> · {run.error}</>}
        </p>
      ) : null}
      {message && !running && <p className="muted small">{message}</p>}

      <ProfileDialog ref={dialog} profiles={profiles} activeId={activeId} />
    </div>
  );
}
