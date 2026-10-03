'use client';

import { startTransition, useEffect, useEffectEvent, useOptimistic, useRef, useState, useTransition } from 'react';
import { byId } from '@/lib/boards';
import { FIELDS, JSON_SOURCES, type FieldId, type JsonSource } from '@/lib/listings/config';
import { KIND_IDS, isGeneric, kindOf, type KindId } from '@/lib/listings/kinds';
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

const headerText = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
const parseHeaders = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2]]),
  );

function toDraft(scraper: Scraper): Draft {
  return {
    id: scraper.id,
    name: scraper.name,
    src: scraper.src,
    kind: scraper.kind,
    enabled: scraper.enabled,
    url: scraper.config.url,
    pages: scraper.config.pages ?? 1,
    headers: headerText(scraper.config.headers),
    checkKeyword: Boolean(scraper.config.checkKeyword),
    checkLocation: Boolean(scraper.config.checkLocation),
    from: scraper.config.from ?? 'body',
    scriptId: scraper.config.scriptId ?? '',
    items: scraper.config.items ?? '',
    fields: { ...(scraper.config.fields ?? {}) },
  };
}

/** A new scraper of a kind: the built-in boards start with their usual search. */
function blank(kind: KindId, keep?: Partial<Draft>): Draft {
  const { src, defaults } = kindOf(kind);
  return {
    name: keep?.name || (src ? (byId(src)?.label ?? '') : ''),
    src: src ?? keep?.src ?? '',
    kind,
    enabled: true,
    url: defaults?.url ?? keep?.url ?? '',
    pages: defaults?.pages ?? 1,
    headers: headerText(defaults?.headers),
    checkKeyword: defaults?.checkKeyword ?? true,
    checkLocation: defaults?.checkLocation ?? true,
    from: 'body',
    scriptId: '',
    items: '',
    fields: {},
  };
}

const toForm = (draft: Draft): ScraperForm => ({
  id: draft.id,
  name: draft.name,
  src: draft.src,
  kind: draft.kind,
  enabled: draft.enabled,
  config: {
    url: draft.url.trim(),
    pages: draft.pages,
    headers: parseHeaders(draft.headers),
    checkKeyword: draft.checkKeyword,
    checkLocation: draft.checkLocation,
    ...(draft.kind === 'json'
      ? { from: draft.from, scriptId: draft.scriptId, items: draft.items, fields: draft.fields }
      : {}),
    ...(draft.kind === 'html' ? { items: draft.items, fields: draft.fields } : {}),
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
  const edit = (draft: Draft, test = false) => setOpen((previous) => ({ draft, test, n: (previous?.n ?? 0) + 1 }));
  // a switched checkbox shows at once; the refreshed page brings the real list
  const [list, toggle] = useOptimistic(scrapers, (cur, change: { id: string; enabled: boolean }) =>
    cur.map((scraper) => (scraper.id === change.id ? { ...scraper, enabled: change.enabled } : scraper)),
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
        {list.map((scraper) => (
          <li key={scraper.id} className={scraper.enabled ? undefined : 'off'}>
            <input
              type="checkbox"
              checked={scraper.enabled}
              aria-label={`${scraper.name} on`}
              onChange={(event) => {
                const enabled = event.target.checked;
                act.run(
                  () => toggleScraperAction({ id: scraper.id, enabled }),
                  () => toggle({ id: scraper.id, enabled }),
                );
              }}
            />
            <div className="scraper-main">
              <div>
                <strong>{scraper.name}</strong> <span className="badge">{kindOf(scraper.kind).label}</span>{' '}
                <span className="muted small">
                  {scraper.src}
                  {counts[scraper.src] ? ` · ${counts[scraper.src]?.offers} saved` : ''}
                </span>
              </div>
              <ScraperStatus scraper={scraper} />
            </div>
            <div className="scraper-actions">
              <button type="button" className="secondary" onClick={() => edit(toDraft(scraper), true)}>
                Test
              </button>
              <button type="button" className="secondary" onClick={() => edit(toDraft(scraper))}>
                Edit
              </button>
              <button
                type="button"
                className="secondary"
                title="A copy, e.g. for another search on the same board"
                onClick={() => edit({ ...toDraft(scraper), id: undefined, name: `${scraper.name} (copy)` })}
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

function ScraperStatus({ scraper }: { scraper: Scraper }) {
  const { formatTime } = useZone();
  if (!scraper.lastRunAt)
    return (
      <p className="muted small">
        Not run yet{scraper.mark === null ? ' · its first run only saves (no Telegram)' : ''}
      </p>
    );
  const when = formatTime(scraper.lastRunAt);
  if (scraper.lastStatus === 'error' && !scraper.lastFound) {
    return (
      <p className="small">
        <span className="warn">
          ✗ {when} · {scraper.lastError}
        </span>
      </p>
    );
  }
  return (
    <p className="small">
      <span className="ok-text">✓</span> {when} · {scraper.lastFound} on the page · {scraper.lastKept} kept ·{' '}
      {scraper.lastNew} new
      {scraper.lastMs !== null && <span className="muted"> · {seconds(scraper.lastMs, 1)}</span>}
      {scraper.lastError && <span className="warn"> · ⚠ {scraper.lastError}</span>}
      {scraper.mark === null && <span className="muted"> · next run only saves</span>}
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
  const [draft, setDraft] = useState(initial);
  const [test, setTest] = useState<Result<TestResult> | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setField = (field: FieldId, value: string) =>
    setDraft((current) => ({ ...current, fields: { ...current.fields, [field]: value } }));

  const runTest = () =>
    startTest(async () => {
      setTest(null);
      setTest(await testScraperAction(toForm(draft)).catch((failure: unknown) => fail(message(failure))));
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
      const answer = await fn().catch((failure: unknown) => fail(message(failure)));
      startTransition(() => (answer.ok ? onClose() : setError(answer.error)));
    });
  };
  const save = () => commit(() => saveScraperAction(toForm(draft)));
  const remove = () => {
    const id = draft.id;
    if (!id || !confirm(`Delete “${draft.name}”? Offers it already saved stay.`)) return;
    commit(() => deleteScraperAction({ id }));
  };
  const changeKind = (kind: KindId) => {
    // a built-in board brings its own link and board id; between generic kinds keep what's typed
    if (draft.id && !confirm('Change the type? The link and fields may not fit the new type.')) return;
    setDraft((current) =>
      isGeneric(kind) && isGeneric(current.kind)
        ? { ...current, kind }
        : { ...blank(kind, current), id: current.id, enabled: current.enabled },
    );
    setTest(null);
  };

  const generic = isGeneric(draft.kind);
  const mapped = draft.kind === 'json' || draft.kind === 'html';
  const usesKeyword = /\{keyword(_slug)?\}/.test(draft.url);
  const paged = /\{(start|page)\}/.test(draft.url);

  return (
    <dialog
      ref={dialog}
      className="modal modal-wide modal-sheet"
      aria-labelledby="scraper-title"
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current.close()}
    >
      <div className="modal-body">
        <div className="sheet-head">
          <h2 id="scraper-title">{draft.id ? initial.name : 'New scraper'}</h2>
          <p className="muted">{kindOf(draft.kind).hint}</p>
        </div>

        <div className="sheet-scroll">
          <div className="field-row">
            <label className="field">
              <span>Type</span>
              <select value={draft.kind} onChange={(event) => changeKind(event.target.value as KindId)}>
                {KIND_IDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindOf(kind).label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="LinkedIn – React"
              />
            </label>
            <label className="field">
              <span>Source id</span>
              {generic ? (
                <input
                  value={draft.src}
                  onChange={(event) => set({ src: event.target.value.toLowerCase() })}
                  placeholder="linkedin"
                />
              ) : (
                <input value={draft.src} readOnly aria-readonly="true" />
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
              value={draft.url}
              onChange={(event) => set({ url: event.target.value })}
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
                value={draft.pages}
                onChange={(event) => set({ pages: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })}
              />
              <small>per keyword, per run</small>
            </label>
          )}
          <label className="field">
            <span>Headers</span>
            <textarea
              rows={2}
              value={draft.headers}
              onChange={(event) => set({ headers: event.target.value })}
              placeholder="X-Api-Version: 1.0"
              spellCheck={false}
            />
            <small>One per line, “Name: value”. A browser User-Agent is sent unless you set one.</small>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.checkKeyword}
              onChange={(event) => set({ checkKeyword: event.target.checked })}
            />{' '}
            The offer must mention a keyword (title or skills)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.checkLocation}
              onChange={(event) => set({ checkLocation: event.target.checked })}
            />{' '}
            Only remote or in the cities from Filters
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => set({ enabled: event.target.checked })}
            />{' '}
            On
          </label>

          {draft.kind === 'json' && (
            <div className="field-row">
              <label className="field">
                <span>Where the JSON is</span>
                <select value={draft.from} onChange={(event) => set({ from: event.target.value as JsonSource })}>
                  {JSON_SOURCES.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              {draft.from === 'script' && (
                <label className="field">
                  <span>Script id</span>
                  <input
                    value={draft.scriptId}
                    onChange={(event) => set({ scriptId: event.target.value })}
                    placeholder="serverApp-state"
                  />
                </label>
              )}
            </div>
          )}
          {mapped && (
            <label className="field">
              <span>{draft.kind === 'json' ? 'Path to the list of offers' : 'One offer (CSS selector)'}</span>
              <input
                value={draft.items}
                onChange={(event) => set({ items: event.target.value })}
                placeholder={draft.kind === 'json' ? 'data, or props.pageProps.jobs' : 'li.job-card'}
                spellCheck={false}
              />
              <small>
                {draft.kind === 'json'
                  ? 'Keys with dots between them; [] = each item of a list, e.g. results[].job. Test shows the first offer’s JSON to find the paths.'
                  : 'Test shows the first one’s HTML, to find the selectors for the fields.'}
              </small>
            </label>
          )}
          {mapped && (
            <fieldset className="fields">
              <legend>
                {draft.kind === 'json' ? 'Fields: a path inside one offer' : 'Fields: a CSS selector inside one offer'}
              </legend>
              {FIELDS.map((field) => (
                <label key={field.id} className="field">
                  <span>
                    {field.label}
                    {'required' in field && ' *'}
                    {'hint' in field && <em className="muted"> · {field.hint}</em>}
                  </span>
                  <input
                    value={draft.fields[field.id] ?? ''}
                    onChange={(event) => setField(field.id, event.target.value)}
                    placeholder={PLACEHOLDERS[draft.kind as 'json' | 'html'][field.id]}
                    spellCheck={false}
                  />
                </label>
              ))}
              <small>
                {draft.kind === 'json'
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
            {draft.id && (
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
  const result = test.data;
  const skipped = [
    result.skipped.keyword && `${result.skipped.keyword} without a keyword`,
    result.skipped.area && `${result.skipped.area} not remote / not in the cities`,
    result.skipped.ignored && `${result.skipped.ignored} by title`,
  ].filter(Boolean);
  return (
    <section className="test-view" aria-label="Test result" aria-live="polite">
      <p>
        {result.ok ? <span className="ok-text">✓</span> : <span className="warn">✗</span>} {result.found} on the page
        {result.pages.length > 1 ? 's' : ''} → <strong>{result.kept} kept</strong>, {result.fresh} of them not saved yet
        · {seconds(result.ms, 1)}
        {skipped.length > 0 && <span className="muted"> · skipped: {skipped.join(', ')}</span>}
      </p>
      {result.pages.length > 1 || !result.ok ? (
        <ul className="test-pages">
          {result.pages.map((page) => (
            <li key={page.url}>
              {[page.keyword, result.pages.some((other) => other.page > 1) && `page ${page.page}`]
                .filter(Boolean)
                .join(', ') || 'page'}
              : {page.ok ? `${page.total} → ${page.kept}` : <span className="warn">{page.error}</span>}{' '}
              <a href={page.url} target="_blank" rel="noopener noreferrer">
                open ↗
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {result.offers.length > 0 && (
        <ol className="test-offers">
          {result.offers.map((offer) => (
            <li key={offer.id}>
              <a href={offer.url} target="_blank" rel="noopener noreferrer">
                {offer.title}
              </a>{' '}
              {!offer.known && <span className="badge new">new</span>}
              <span className="muted small">
                {' '}
                {[offer.company, offer.remote ? 'remote' : offer.locations.join(', '), offer.seniority]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                · id {offer.id}
              </span>
            </li>
          ))}
        </ol>
      )}
      {result.sample && (
        <details className="sample">
          <summary>The first offer as the scraper sees it</summary>
          <pre>{result.sample}</pre>
        </details>
      )}
    </section>
  );
}
