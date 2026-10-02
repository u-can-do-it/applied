'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { formatDay, todayInWarsaw } from '@/lib/dates';
import type { Application, ApplicationWithContent } from '@/lib/applications';
import { SOURCES } from '@/lib/sources';
import { refetchContentAction, unapplyAction } from '../actions';
import { SearchIcon } from '../search-box';

const day = (iso: string | null | undefined) => (iso ? formatDay(todayInWarsaw(Date.parse(iso))) : '');
const facts = (d: Application['details']) =>
  [d?.salary, d?.contract, d?.remote ? 'Remote' : null, d?.location].filter(Boolean).join(' · ');

const STATUS: Record<Application['content_status'], string> = {
  pending: 'saving the ad…',
  ok: '📄 ad saved',
  empty: 'no ad text',
  failed: 'couldn’t fetch the ad',
};

export function AppliedList({ apps }: { apps: Application[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const pending = apps.some((a) => a.content_status === 'pending');

  // ad texts are scraped in the background right after marking: refresh until they're in
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(t);
  }, [pending, apps, router]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return apps.filter((a) => words.every((w) => `${a.title} ${a.company ?? ''}`.toLowerCase().includes(w)));
  }, [apps, q]);

  if (!apps.length) {
    return (
      <p className="empty">
        Nothing here yet. Use <strong>Mark applied</strong> on an offer: it shows up here with its complete ad text.
      </p>
    );
  }

  return (
    <>
      <div className="search">
        <SearchIcon />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search applied offers…" aria-label="Search applied offers" />
      </div>
      <p className="count">
        <strong>{shown.length}</strong>
        {shown.length !== apps.length && <> of {apps.length}</>} applied
      </p>

      <ol className="applied-list">
        {shown.map((a) => (
          <li key={a.dup_key}>
            <button type="button" className="applied-row" onClick={() => setOpenKey(a.dup_key)}>
              <time dateTime={a.applied_at}>{day(a.applied_at)}</time>
              <span className="body">
                <span className="title">{a.title}</span>
                <span className="meta">
                  {a.company && <span>{a.company}</span>}
                  {facts(a.details) && <span>{facts(a.details)}</span>}
                </span>
              </span>
              <span className="side">
                <span className="src">{SOURCES[a.src] ?? a.src}</span>
                <span className={`status status-${a.content_status}`}>{STATUS[a.content_status]}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <AdModal appKey={openKey} onClose={() => setOpenKey(null)} />
    </>
  );
}

function AdModal({ appKey, onClose }: { appKey: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [app, setApp] = useState<ApplicationWithContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // open / close follows appKey
  useEffect(() => {
    if (appKey) dialog.current?.showModal();
    else dialog.current?.close();
  }, [appKey]);

  // load the text; while it's still being scraped, look again every 3 s
  useEffect(() => {
    if (!appKey) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`/api/application?key=${encodeURIComponent(appKey)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        const data = (await res.json()) as ApplicationWithContent;
        if (stop) return;
        setApp(data);
        setError(null);
        if (data.content_status === 'pending') timer = setTimeout(load, 3000);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    setApp(null);
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [appKey]);

  const d = app?.details;
  const rows: [string, string | undefined][] = [
    ['Salary', d?.salary],
    ['Contract', d?.contract],
    ['Location', [d?.remote ? 'Remote' : null, d?.location].filter(Boolean).join(' · ') || undefined],
    ['Posted', d?.posted ? formatDay(d.posted) : undefined],
    ['Valid until', d?.validUntil ? formatDay(d.validUntil) : undefined],
  ];

  return (
    <dialog ref={dialog} className="modal modal-wide" onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
      <div className="modal-body">
        {!app && !error && <p className="muted">Loading…</p>}
        {error && <p className="form-error">{error}</p>}
        {app && (
          <>
            <div className="ad-head">
              <h2>{app.title}</h2>
              <p className="muted">
                {app.company && <>{app.company} · </>}
                {SOURCES[app.src] ?? app.src} · applied {day(app.applied_at)}
              </p>
            </div>

            {rows.some(([, v]) => v) && (
              <dl className="ad-facts">
                {rows.filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className={k === 'Salary' && v!.includes('; ') ? 'wide' : undefined}>
                    <dt>{k}</dt>
                    {/* one line per contract type: "14 000–18 000 PLN / month (B2B)" */}
                    <dd>{v!.split('; ').map((line, i) => <span key={i} className="fact-line">{line}</span>)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {app.content_status === 'ok' && app.content ? (
              <div className="ad-text">{app.content}</div>
            ) : app.content_status === 'pending' ? (
              <p className="muted">Saving the ad text…</p>
            ) : (
              <p className="form-error">
                {app.content_status === 'empty' ? 'The board page had no ad text.' : 'Couldn’t fetch the ad.'} {app.content_error}
              </p>
            )}

            {app.scraped_at && app.content_status === 'ok' && <p className="muted small">Saved {day(app.scraped_at)}.</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary danger"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => {
                  if (!confirm('Unmark as applied? The saved ad text is deleted too.')) return;
                  start(async () => {
                    await unapplyAction(app.dup_key);
                    dialog.current?.close();
                  });
                }}
              >
                Unmark applied
              </button>
              <span className="spacer" />
              {app.content_status !== 'ok' && app.content_status !== 'pending' && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() =>
                    start(async () => {
                      await refetchContentAction(app.dup_key);
                      const res = await fetch(`/api/application?key=${encodeURIComponent(app.dup_key)}`, { cache: 'no-store' });
                      if (res.ok) setApp(await res.json());
                    })
                  }
                >
                  Fetch again
                </button>
              )}
              <a className="button-link" href={app.url} target="_blank" rel="noopener noreferrer">
                Open original ↗
              </a>
              <button type="button" onClick={() => dialog.current?.close()}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
