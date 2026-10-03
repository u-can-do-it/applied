'use client';

import { startTransition, useEffect, useEffectEvent, useOptimistic, useState, useTransition } from 'react';
import { CheckIcon, ExternalLinkIcon, PlusIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { CheckField, Code, Field } from '@/components/field';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { ActionError, useAction } from '@/components/use-action';
import { useZone } from '@/components/time-zone';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/shared/cn';
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
    <Card className={PANEL} role="region" aria-labelledby="scrapers-h">
      <CardHeader className="flex items-center justify-between gap-3 px-4">
        <h2 id="scrapers-h" className="m-0 text-base font-semibold">
          Scrapers
        </h2>
        <Button type="button" onClick={() => edit(blank('html'))}>
          <PlusIcon /> Add scraper
        </Button>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="m-0 list-none border-t p-0">
          {list.map((scraper) => (
            <li
              key={scraper.id}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-b py-2.5 max-[560px]:grid-cols-[auto_1fr]"
            >
              <Switch
                className="mt-0.5"
                checked={scraper.enabled}
                aria-label={`${scraper.name} on`}
                onCheckedChange={(enabled) => {
                  act.run(
                    () => toggleScraperAction({ id: scraper.id, enabled }),
                    () => toggle({ id: scraper.id, enabled }),
                  );
                }}
              />
              <div className={cn('min-w-0 text-sm', !scraper.enabled && 'opacity-55')}>
                <div>
                  <strong>{scraper.name}</strong> <Badge variant="quiet">{kindOf(scraper.kind).label}</Badge>{' '}
                  <span className="text-xs text-muted-foreground">
                    {scraper.src}
                    {counts[scraper.src] ? ` · ${counts[scraper.src]?.offers} saved` : ''}
                  </span>
                </div>
                <ScraperStatus scraper={scraper} />
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 max-[560px]:col-start-2 max-[560px]:justify-start">
                <Button type="button" variant="outline" size="sm" onClick={() => edit(toDraft(scraper), true)}>
                  Test
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => edit(toDraft(scraper))}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="A copy, e.g. for another search on the same board"
                  onClick={() => edit({ ...toDraft(scraper), id: undefined, name: `${scraper.name} (copy)` })}
                >
                  Copy
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <ActionError error={act.error} />
      </CardContent>
      {open && (
        <ScraperEditor
          key={open.n}
          initial={open.draft}
          autoTest={open.test}
          keywords={keywords}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  );
}

/** a Settings panel (panels.tsx has the same) */
const PANEL = 'mb-3.5 gap-2.5 py-3.5';

function ScraperStatus({ scraper }: { scraper: Scraper }) {
  const { formatTime } = useZone();
  if (!scraper.lastRunAt)
    return (
      <p className="m-0 mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        Not run yet{scraper.mark === null ? ' · its first run only saves (no Telegram)' : ''}
      </p>
    );
  const when = formatTime(scraper.lastRunAt);
  if (scraper.lastStatus === 'error' && !scraper.lastFound) {
    return (
      <p className="m-0 mt-0.5 text-xs [overflow-wrap:anywhere]">
        <span className="text-warning">
          <XIcon role="img" aria-label="Failed" /> {when} · {scraper.lastError}
        </span>
      </p>
    );
  }
  return (
    <p className="m-0 mt-0.5 text-xs [overflow-wrap:anywhere]">
      <CheckIcon className="text-success" role="img" aria-label="OK" /> {when} · {scraper.lastFound} on the page ·{' '}
      {scraper.lastKept} kept · {scraper.lastNew} new
      {scraper.lastMs !== null && <span className="text-muted-foreground"> · {seconds(scraper.lastMs, 1)}</span>}
      {scraper.lastError && (
        <span className="text-warning">
          {' · '}
          <TriangleAlertIcon /> {scraper.lastError}
        </span>
      )}
      {scraper.mark === null && <span className="text-muted-foreground"> · next run only saves</span>}
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
  const [open, setOpen] = useState(true);
  const confirm = useConfirm();
  const focus = useReturnFocus();
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
    if (autoTest) runTest();
  });
  useEffect(() => opened(), []);

  // the dialog stays open (Saving…) until the server answers, then closes together with the
  // refreshed list, so the list never shows the old values after it closed
  const commit = (fn: () => Promise<Result<unknown>>) => {
    setError(null);
    startSave(async () => {
      const answer = await fn().catch((failure: unknown) => fail(message(failure)));
      startTransition(() => (answer.ok ? setOpen(false) : setError(answer.error)));
    });
  };
  const save = () => commit(() => saveScraperAction(toForm(draft)));
  const remove = async () => {
    const id = draft.id;
    if (
      !id ||
      !(await confirm({
        title: `Delete “${draft.name}”?`,
        description: 'Offers it already saved stay.',
        action: 'Delete',
        destructive: true,
      }))
    )
      return;
    commit(() => deleteScraperAction({ id }));
  };
  const changeKind = async (kind: KindId) => {
    // a built-in board brings its own link and board id; between generic kinds keep what's typed
    if (
      draft.id &&
      !(await confirm({
        title: 'Change the type?',
        description: 'The link and fields may not fit the new type.',
        action: 'Change',
      }))
    )
      return;
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

  // A side panel: a long form whose test result (the offers it found, a sample) reads best at full height,
  // with the list of scrapers still in view beside it on a wide screen
  return (
    // Escape, a click outside and Cancel close it
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]"
        onInteractOutside={keepOpenOnToast}
        onCloseAutoFocus={(event) => {
          focus.onCloseAutoFocus(event);
          onClose();
        }}
      >
        <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
          <SheetTitle className="text-lg font-semibold">{draft.id ? initial.name : 'New scraper'}</SheetTitle>
          <SheetDescription className="text-[13px]">{kindOf(draft.kind).hint}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
          <div className={ROW}>
            <Field label="Type">
              <NativeSelect
                className="w-full"
                value={draft.kind}
                onChange={(event) => void changeKind(event.target.value as KindId)}
              >
                {KIND_IDS.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {kindOf(kind).label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="LinkedIn – React"
              />
            </Field>
            <Field label="Source id">
              {generic ? (
                <Input
                  value={draft.src}
                  onChange={(event) => set({ src: event.target.value.toLowerCase() })}
                  placeholder="linkedin"
                />
              ) : (
                <Input value={draft.src} readOnly aria-readonly="true" className="text-muted-foreground" />
              )}
            </Field>
          </div>
          <p className="-mt-1.5 mb-0 text-xs text-muted-foreground">
            {generic
              ? 'The source id is saved with each offer and shows as its board (lowercase, e.g. linkedin). Searches on one site share it.'
              : 'Fixed for this board, so its offers keep matching the ones already saved.'}
          </p>

          <Field
            label="Link"
            hint={
              <>
                <Code>{'{keyword}'}</Code> and <Code>{'{keyword_slug}'}</Code> become each keyword from Filters (
                {keywords.join(', ') || 'none set'}): one search per keyword.
                {!usesKeyword && ' Without them the link is fetched as it is.'} <Code>{'{start}'}</Code> (0, 10, 20…) or{' '}
                <Code>{'{page}'}</Code> (1, 2, 3…) fetch several pages.
              </>
            }
          >
            <Textarea
              rows={2}
              className={TEXTAREA}
              value={draft.url}
              onChange={(event) => set({ url: event.target.value })}
              placeholder="https://…"
              spellCheck={false}
            />
          </Field>
          {paged && (
            <Field label="Pages" hint="per keyword, per run">
              <Input
                type="number"
                min={1}
                max={5}
                className="w-24"
                value={draft.pages}
                onChange={(event) => set({ pages: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })}
              />
            </Field>
          )}
          <Field label="Headers" hint="One per line, “Name: value”. A browser User-Agent is sent unless you set one.">
            <Textarea
              rows={2}
              className={TEXTAREA}
              value={draft.headers}
              onChange={(event) => set({ headers: event.target.value })}
              placeholder="X-Api-Version: 1.0"
              spellCheck={false}
            />
          </Field>
          <CheckField>
            <Checkbox
              checked={draft.checkKeyword}
              onCheckedChange={(checked) => set({ checkKeyword: checked === true })}
            />
            The offer must mention a keyword (title or skills)
          </CheckField>
          <CheckField>
            <Checkbox
              checked={draft.checkLocation}
              onCheckedChange={(checked) => set({ checkLocation: checked === true })}
            />
            Only remote or in the cities from Filters
          </CheckField>
          <CheckField>
            <Checkbox checked={draft.enabled} onCheckedChange={(checked) => set({ enabled: checked === true })} />
            On
          </CheckField>

          {draft.kind === 'json' && (
            <div className={ROW}>
              <Field label="Where the JSON is">
                <NativeSelect
                  className="w-full"
                  value={draft.from}
                  onChange={(event) => set({ from: event.target.value as JsonSource })}
                >
                  {JSON_SOURCES.map((source) => (
                    <NativeSelectOption key={source.id} value={source.id}>
                      {source.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {draft.from === 'script' && (
                <Field label="Script id">
                  <Input
                    value={draft.scriptId}
                    onChange={(event) => set({ scriptId: event.target.value })}
                    placeholder="serverApp-state"
                  />
                </Field>
              )}
            </div>
          )}
          {mapped && (
            <Field
              label={draft.kind === 'json' ? 'Path to the list of offers' : 'One offer (CSS selector)'}
              hint={
                draft.kind === 'json'
                  ? 'Keys with dots between them; [] = each item of a list, e.g. results[].job. Test shows the first offer’s JSON to find the paths.'
                  : 'Test shows the first one’s HTML, to find the selectors for the fields.'
              }
            >
              <Input
                value={draft.items}
                onChange={(event) => set({ items: event.target.value })}
                placeholder={draft.kind === 'json' ? 'data, or props.pageProps.jobs' : 'li.job-card'}
                spellCheck={false}
              />
            </Field>
          )}
          {mapped && (
            <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-3 gap-y-2.5 rounded-lg border px-3 py-2.5">
              <legend className="px-1 text-[13px] text-muted-foreground">
                {draft.kind === 'json' ? 'Fields: a path inside one offer' : 'Fields: a CSS selector inside one offer'}
              </legend>
              {FIELDS.map((field) => (
                <Field
                  key={field.id}
                  label={
                    <>
                      {field.label}
                      {'required' in field && ' *'}
                      {'hint' in field && <span className="text-muted-foreground"> · {field.hint}</span>}
                    </>
                  }
                >
                  <Input
                    value={draft.fields[field.id] ?? ''}
                    onChange={(event) => setField(field.id, event.target.value)}
                    placeholder={PLACEHOLDERS[draft.kind as 'json' | 'html'][field.id]}
                    spellCheck={false}
                  />
                </Field>
              ))}
              <small className="col-span-full text-xs text-muted-foreground">
                {draft.kind === 'json'
                  ? 'The link can be a template filled from the offer: https://site.com/job/{slug}. Relative links are fine.'
                  : '“h3 a” = its text, “h3 a@href” = an attribute, “@data-id” = the offer element’s own attribute. Relative links are fine.'}
              </small>
            </fieldset>
          )}

          {test && <TestView test={test} />}
        </div>

        <SheetFooter className="mt-0 gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle className="font-normal">{error}</AlertTitle>
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {draft.id && (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                onClick={() => void remove()}
                disabled={saving}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={runTest}
              disabled={testing}
              aria-busy={testing || undefined}
            >
              {testing ? 'Testing…' : 'Test'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-2.5';
const TEXTAREA = 'field-sizing-fixed resize-y font-mono text-[13px] md:text-[13px]';

function TestView({ test }: { test: Result<TestResult> }) {
  if (!test.ok) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle className="font-normal">{test.error}</AlertTitle>
      </Alert>
    );
  }
  const result = test.data;
  const skipped = [
    result.skipped.keyword && `${result.skipped.keyword} without a keyword`,
    result.skipped.area && `${result.skipped.area} not remote / not in the cities`,
    result.skipped.ignored && `${result.skipped.ignored} by title`,
  ].filter(Boolean);
  return (
    <section
      className="rounded-lg border bg-background px-3 py-2.5 text-sm [&_a]:text-foreground"
      aria-label="Test result"
      aria-live="polite"
    >
      <p className="mt-0 mb-1.5">
        {result.ok ? (
          <CheckIcon className="text-success" role="img" aria-label="OK" />
        ) : (
          <XIcon className="text-warning" role="img" aria-label="Failed" />
        )}{' '}
        {result.found} on the page
        {result.pages.length > 1 ? 's' : ''} → <strong>{result.kept} kept</strong>, {result.fresh} of them not saved yet
        · {seconds(result.ms, 1)}
        {skipped.length > 0 && <span className="text-muted-foreground"> · skipped: {skipped.join(', ')}</span>}
      </p>
      {result.pages.length > 1 || !result.ok ? (
        <ul className="my-1.5 list-disc pl-5 text-[13px]">
          {result.pages.map((page) => (
            <li key={page.url}>
              {[page.keyword, result.pages.some((other) => other.page > 1) && `page ${page.page}`]
                .filter(Boolean)
                .join(', ') || 'page'}
              : {page.ok ? `${page.total} → ${page.kept}` : <span className="text-warning">{page.error}</span>}{' '}
              <a href={page.url} target="_blank" rel="noopener noreferrer" className="underline">
                open <ExternalLinkIcon />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {result.offers.length > 0 && (
        <ol className="my-1.5 list-decimal pl-5 text-[13px]">
          {result.offers.map((offer) => (
            <li key={offer.id} className="my-[3px] [overflow-wrap:anywhere]">
              <a href={offer.url} target="_blank" rel="noopener noreferrer" className="underline">
                {offer.title}
              </a>{' '}
              {!offer.known && <Badge variant="success">new</Badge>}
              <span className="text-xs text-muted-foreground">
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
        <details>
          <summary className="cursor-pointer text-[13px] text-muted-foreground">
            The first offer as the scraper sees it
          </summary>
          <pre className="mt-1.5 mb-0 max-h-80 overflow-auto rounded-md bg-card p-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
            {result.sample}
          </pre>
        </details>
      )}
    </section>
  );
}
