'use client';

import { startTransition, useEffect, useEffectEvent, useOptimistic, useRef, useState, useTransition } from 'react';
import {
  FIELDS,
  JSON_SOURCES,
  KIND_IDS,
  KINDS,
  isGeneric,
  type FieldId,
  type JsonSource,
  type KindId,
} from '@/lib/scraping/kinds';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { message } from '@/lib/shared/errors';
import { seconds } from '@/lib/shared/format';
import { fail, type Result } from '@/lib/shared/result';
import type { ScraperForm } from '@/lib/shared/schemas/scrapers';
import {
  deleteScraperAction,
  saveScraperAction,
  testScraperAction,
  toggleScraperAction,
  type TestResult,
} from './actions';
import { useZone } from '../time-zone';
import { Feedback, useAction } from './panels';

// The scrapers: the built-in boards, plus your own (JSON / HTML / RSS) set up here.

type Draft = {
  id?: string;
  name: string;
  src: string;
  kind: KindId;
  enabled: boolean;
  url: string;
  pages: number;
  headers: string; // "Name: value" per line
  checkKeyword: boolean;
  checkLocation: boolean;
  from: JsonSource;
  scriptId: string;
  items: string;
  fields: Partial<Record<FieldId, string>>;
};

const headerText = (h: Record<string, string> | undefined) =>
  Object.entries(h ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
const parseHeaders = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => [m[1], m[2]]),
  );

function toDraft(s: Scraper): Draft {
  return {
    id: s.id,
    name: s.name,
    src: s.src,
    kind: s.kind,
    enabled: s.enabled,
    url: s.config.url,
    pages: s.config.pages ?? 1,
    headers: headerText(s.config.headers),
    checkKeyword: Boolean(s.config.checkKeyword),
    checkLocation: Boolean(s.config.checkLocation),
    from: s.config.from ?? 'body',
    scriptId: s.config.scriptId ?? '',
    items: s.config.items ?? '',
    fields: { ...(s.config.fields ?? {}) },
  };
}

/** A new scraper of a kind: the built-in boards start with their usual search. */
function blank(kind: KindId, keep?: Partial<Draft>): Draft {
  const d = KINDS[kind].defaults;
  return {
    name: keep?.name || (KINDS[kind].src ? KINDS[kind].label.split(' ')[0] : ''),
    src: KINDS[kind].src ?? keep?.src ?? '',
    kind,
    enabled: true,
    url: d?.url ?? keep?.url ?? '',
    pages: d?.pages ?? 1,
    headers: headerText(d?.headers),
    checkKeyword: d?.checkKeyword ?? true,
    checkLocation: d?.checkLocation ?? true,
    from: 'body',
    scriptId: '',
    items: '',
    fields: {},
  };
}

const toForm = (d: Draft): ScraperForm => ({
  id: d.id,
  name: d.name,
  src: d.src,
  kind: d.kind,
  enabled: d.enabled,
  config: {
    url: d.url.trim(),
    pages: d.pages,
    headers: parseHeaders(d.headers),
    checkKeyword: d.checkKeyword,
    checkLocation: d.checkLocation,
    ...(d.kind === 'json' ? { from: d.from, scriptId: d.scriptId, items: d.items, fields: d.fields } : {}),
    ...(d.kind === 'html' ? { items: d.items, fields: d.fields } : {}),
  },
});

export function ScrapersPanel({
  scrapers,
  counts,
  keywords,
}: {
  scrapers: Scraper[];
  counts: Partial<Record<string, { offers: number }>>;
  keywords: string[];
}) {
  const [open, setOpen] = useState<{ draft: Draft; test: boolean; n: number } | null>(null);
  const act = useAction();
  const edit = (draft: Draft, test = false) => setOpen((o) => ({ draft, test, n: (o?.n ?? 0) + 1 }));
  // a switched checkbox shows at once; the refreshed page brings the real list
  const [list, toggle] = useOptimistic(scrapers, (cur, t: { id: string; enabled: boolean }) =>
    cur.map((s) => (s.id === t.id ? { ...s, enabled: t.enabled } : s)),
  );

  return (
    <section className="panel" aria-labelledby="scrapers-h">
      <div className="panel-head">
        <h2 id="scrapers-h">Scrapers</h2>
        <button type="button" onClick={() => edit(blank('html'))}>
          + Add scraper
        </button>
      </div>
      <ul className="scrapers">
        {list.map((s) => (
          <li key={s.id} className={s.enabled ? undefined : 'off'}>
            <input
              type="checkbox"
              checked={s.enabled}
              aria-label={`${s.name} on`}
              onChange={(e) => {
                const enabled = e.target.checked;
                act.run(
                  () => toggleScraperAction({ id: s.id, enabled }),
                  () => toggle({ id: s.id, enabled }),
                );
              }}
            />
            <div className="scraper-main">
              <div>
                <strong>{s.name}</strong> <span className="badge">{KINDS[s.kind].label}</span>{' '}
                <span className="muted small">
                  {s.src}
                  {counts[s.src] ? ` · ${counts[s.src]?.offers} saved` : ''}
                </span>
              </div>
              <ScraperStatus s={s} />
            </div>
            <div className="scraper-actions">
              <button type="button" className="secondary" onClick={() => edit(toDraft(s), true)}>
                Test
              </button>
              <button type="button" className="secondary" onClick={() => edit(toDraft(s))}>
                Edit
              </button>
              <button
                type="button"
                className="secondary"
                title="A copy, e.g. for another search on the same board"
                onClick={() => edit({ ...toDraft(s), id: undefined, name: `${s.name} (copy)` })}
              >
                Copy
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Feedback state={act.state} />
      {open && (
        <ScraperEditor
          key={open.n}
          initial={open.draft}
          autoTest={open.test}
          keywords={keywords}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function ScraperStatus({ s }: { s: Scraper }) {
  const { formatTime } = useZone();
  if (!s.lastRunAt)
    return (
      <p className="muted small">Not run yet{s.mark === null ? ' · its first run only saves (no Telegram)' : ''}</p>
    );
  const when = formatTime(s.lastRunAt);
  if (s.lastStatus === 'error' && !s.lastFound) {
    return (
      <p className="small">
        <span className="warn">
          ✗ {when} · {s.lastError}
        </span>
      </p>
    );
  }
  return (
    <p className="small">
      <span className="ok-text">✓</span> {when} · {s.lastFound} on the page · {s.lastKept} kept · {s.lastNew} new
      {s.lastMs !== null && <span className="muted"> · {seconds(s.lastMs, 1)}</span>}
      {s.lastError && <span className="warn"> · ⚠ {s.lastError}</span>}
      {s.mark === null && <span className="muted"> · next run only saves</span>}
    </p>
  );
}

const PLACEHOLDERS: Record<'json' | 'html', Partial<Record<FieldId, string>>> = {
  json: {
    title: 'title',
    url: 'url, or https://site.com/job/{slug}',
    id: 'id',
    company: 'company.name',
    date: 'publishedAt',
    location: 'locations[].city',
    remote: 'remote',
    skills: 'skills[].name',
    seniority: 'level',
  },
  html: {
    title: 'h3 a',
    url: 'h3 a@href',
    id: '@data-id',
    company: '.company',
    date: 'time@datetime',
    location: '.location',
    remote: '.tags',
    skills: '.skills li',
    seniority: '.level',
  },
};

function ScraperEditor({
  initial,
  autoTest,
  keywords,
  onClose,
}: {
  initial: Draft;
  autoTest: boolean;
  keywords: string[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [d, setD] = useState(initial);
  const [test, setTest] = useState<Result<TestResult> | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setField = (f: FieldId, v: string) => setD((x) => ({ ...x, fields: { ...x.fields, [f]: v } }));

  const runTest = () =>
    startTest(async () => {
      setTest(null);
      setTest(await testScraperAction(toForm(d)).catch((e: unknown) => fail(message(e))));
    });

  const opened = useEffectEvent(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    if (autoTest) runTest();
  });
  useEffect(() => opened(), []);

  // the dialog stays open (Saving…) until the server answers, then closes together with the
  // refreshed list, so the list never shows the old values after it closed
  const commit = (fn: () => Promise<Result<unknown>>) => {
    setError(null);
    startSave(async () => {
      const answer = await fn().catch((e: unknown) => fail(message(e)));
      startTransition(() => (answer.ok ? onClose() : setError(answer.error)));
    });
  };
  const save = () => commit(() => saveScraperAction(toForm(d)));
  const remove = () => {
    const id = d.id;
    if (!id || !confirm(`Delete “${d.name}”? Offers it already saved stay.`)) return;
    commit(() => deleteScraperAction({ id }));
  };
  const changeKind = (kind: KindId) => {
    // a built-in board brings its own link and source id; between generic kinds keep what's typed
    if (d.id && !confirm('Change the type? The link and fields may not fit the new type.')) return;
    setD((x) =>
      isGeneric(kind) && isGeneric(x.kind) ? { ...x, kind } : { ...blank(kind, x), id: x.id, enabled: x.enabled },
    );
    setTest(null);
  };

  const generic = isGeneric(d.kind);
  const mapped = d.kind === 'json' || d.kind === 'html';
  const usesKeyword = /\{keyword(_slug)?\}/.test(d.url);
  const paged = /\{(start|page)\}/.test(d.url);

  return (
    <dialog
      ref={dialog}
      className="modal modal-wide modal-sheet"
      aria-labelledby="scraper-title"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="modal-body">
        <div className="sheet-head">
          <h2 id="scraper-title">{d.id ? initial.name : 'New scraper'}</h2>
          <p className="muted">{KINDS[d.kind].hint}</p>
        </div>

        <div className="sheet-scroll">
          <div className="field-row">
            <label className="field">
              <span>Type</span>
              <select value={d.kind} onChange={(e) => changeKind(e.target.value as KindId)}>
                {KIND_IDS.map((k) => (
                  <option key={k} value={k}>
                    {KINDS[k].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name</span>
              <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="LinkedIn – React" />
            </label>
            <label className="field">
              <span>Source id</span>
              {generic ? (
                <input
                  value={d.src}
                  onChange={(e) => set({ src: e.target.value.toLowerCase() })}
                  placeholder="linkedin"
                />
              ) : (
                <input value={d.src} readOnly aria-readonly="true" />
              )}
            </label>
          </div>
          <p className="muted small field-note">
            {generic
              ? 'The source id is saved with each offer and shows as its board (lowercase, e.g. linkedin). Searches on one site share it.'
              : 'Fixed for this board, so its offers keep matching the ones already saved.'}
          </p>

          <label className="field">
            <span>Link</span>
            <textarea
              rows={2}
              value={d.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://…"
              spellCheck={false}
            />
            <small>
              <code className="inline">{'{keyword}'}</code> and <code className="inline">{'{keyword_slug}'}</code>{' '}
              become each keyword from Filters ({keywords.join(', ') || 'none set'}): one search per keyword.
              {!usesKeyword && ' Without them the link is fetched as it is.'}{' '}
              <code className="inline">{'{start}'}</code> (0, 10, 20…) or <code className="inline">{'{page}'}</code> (1,
              2, 3…) fetch several pages.
            </small>
          </label>
          {paged && (
            <label className="field pages-field">
              <span>Pages</span>
              <input
                type="number"
                min={1}
                max={5}
                value={d.pages}
                onChange={(e) => set({ pages: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
              />
              <small>per keyword, per run</small>
            </label>
          )}
          <label className="field">
            <span>Headers</span>
            <textarea
              rows={2}
              value={d.headers}
              onChange={(e) => set({ headers: e.target.value })}
              placeholder="X-Api-Version: 1.0"
              spellCheck={false}
            />
            <small>One per line, “Name: value”. A browser User-Agent is sent unless you set one.</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={d.checkKeyword} onChange={(e) => set({ checkKeyword: e.target.checked })} />{' '}
            The offer must mention a keyword (title or skills)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={d.checkLocation}
              onChange={(e) => set({ checkLocation: e.target.checked })}
            />{' '}
            Only remote or in the cities from Filters
          </label>
          <label className="check">
            <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On
          </label>

          {d.kind === 'json' && (
            <div className="field-row">
              <label className="field">
                <span>Where the JSON is</span>
                <select value={d.from} onChange={(e) => set({ from: e.target.value as JsonSource })}>
                  {JSON_SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {d.from === 'script' && (
                <label className="field">
                  <span>Script id</span>
                  <input
                    value={d.scriptId}
                    onChange={(e) => set({ scriptId: e.target.value })}
                    placeholder="serverApp-state"
                  />
                </label>
              )}
            </div>
          )}
          {mapped && (
            <label className="field">
              <span>{d.kind === 'json' ? 'Path to the list of offers' : 'One offer (CSS selector)'}</span>
              <input
                value={d.items}
                onChange={(e) => set({ items: e.target.value })}
                placeholder={d.kind === 'json' ? 'data, or props.pageProps.jobs' : 'li.job-card'}
                spellCheck={false}
              />
              <small>
                {d.kind === 'json'
                  ? 'Keys with dots between them; [] = each item of a list, e.g. results[].job. Test shows the first offer’s JSON to find the paths.'
                  : 'Test shows the first one’s HTML, to find the selectors for the fields.'}
              </small>
            </label>
          )}
          {mapped && (
            <fieldset className="fields">
              <legend>
                {d.kind === 'json' ? 'Fields: a path inside one offer' : 'Fields: a CSS selector inside one offer'}
              </legend>
              {FIELDS.map((f) => (
                <label key={f.id} className="field">
                  <span>
                    {f.label}
                    {'required' in f && ' *'}
                    {'hint' in f && <em className="muted"> · {f.hint}</em>}
                  </span>
                  <input
                    value={d.fields[f.id] ?? ''}
                    onChange={(e) => setField(f.id, e.target.value)}
                    placeholder={PLACEHOLDERS[d.kind as 'json' | 'html'][f.id]}
                    spellCheck={false}
                  />
                </label>
              ))}
              <small>
                {d.kind === 'json'
                  ? 'The link can be a template filled from the offer: https://site.com/job/{slug}. Relative links are fine.'
                  : '“h3 a” = its text, “h3 a@href” = an attribute, “@data-id” = the offer element’s own attribute. Relative links are fine.'}
              </small>
            </fieldset>
          )}

          {test && <TestView test={test} />}
        </div>

        <div className="sheet-foot">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            {d.id && (
              <button type="button" className="secondary danger" onClick={remove} disabled={saving}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="secondary"
              onClick={runTest}
              disabled={testing}
              aria-busy={testing || undefined}
            >
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function TestView({ test }: { test: Result<TestResult> }) {
  if (!test.ok) {
    return (
      <p className="form-error" role="alert">
        {test.error}
      </p>
    );
  }
  const t = test.data;
  const skipped = [
    t.skipped.keyword && `${t.skipped.keyword} without a keyword`,
    t.skipped.area && `${t.skipped.area} not remote / not in the cities`,
    t.skipped.ignored && `${t.skipped.ignored} by title`,
  ].filter(Boolean);
  return (
    <section className="test-view" aria-label="Test result" aria-live="polite">
      <p>
        {t.ok ? <span className="ok-text">✓</span> : <span className="warn">✗</span>} {t.found} on the page
        {t.pages.length > 1 ? 's' : ''} → <strong>{t.kept} kept</strong>, {t.fresh} of them not saved yet ·{' '}
        {seconds(t.ms, 1)}
        {skipped.length > 0 && <span className="muted"> · skipped: {skipped.join(', ')}</span>}
      </p>
      {t.pages.length > 1 || !t.ok ? (
        <ul className="test-pages">
          {t.pages.map((p) => (
            <li key={p.url}>
              {[p.keyword, t.pages.some((x) => x.page > 1) && `page ${p.page}`].filter(Boolean).join(', ') || 'page'}:{' '}
              {p.ok ? `${p.total} → ${p.kept}` : <span className="warn">{p.error}</span>}{' '}
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                open ↗
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {t.offers.length > 0 && (
        <ol className="test-offers">
          {t.offers.map((o) => (
            <li key={o.id}>
              <a href={o.url} target="_blank" rel="noopener noreferrer">
                {o.title}
              </a>{' '}
              {!o.known && <span className="badge new">new</span>}
              <span className="muted small">
                {' '}
                {[o.company, o.remote ? 'remote' : o.locations.join(', '), o.seniority].filter(Boolean).join(' · ')} ·
                id {o.id}
              </span>
            </li>
          ))}
        </ol>
      )}
      {t.sample && (
        <details className="sample">
          <summary>The first offer as the scraper sees it</summary>
          <pre>{t.sample}</pre>
        </details>
      )}
    </section>
  );
}
