'use server';

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { after } from 'next/server';
import {
  FIELDS, INTERVALS, JSON_SOURCES, KINDS, SRC_RE, isGeneric, isKind, splitList,
  type FieldId, type KindId, type ScraperConfig,
} from '@/lib/scraping/kinds';
import { flushQueue, runAll, scrape, type PageResult, type RunSummary } from '@/lib/scraping/run';
import { appOrigin, cronSecret } from '@/lib/scraping/schedule';
import * as store from '@/lib/scraping/store';
import { requireLogin } from '@/lib/session';
import { connectWebhook, disconnectWebhook, sendMessage, telegramReady } from '@/lib/telegram';

export type ActionState = { ok?: boolean; error?: string; message?: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function origin() {
  const h = await headers();
  return appOrigin(h.get('x-forwarded-host') ?? h.get('host'), h.get('x-forwarded-proto'));
}

// ---- runs -------------------------------------------------------------------------------

/** The "Scrape now" button: a full run, whatever the schedule says. */
export async function scrapeNowAction(): Promise<RunSummary> {
  await requireLogin();
  const r = await runAll('manual');
  refresh();
  return r;
}

// ---- settings -----------------------------------------------------------------------------

export async function saveScheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireLogin();
  const every = Number(form.get('everyMinutes'));
  const from = Number(form.get('fromHour'));
  const to = Number(form.get('toHour'));
  if (!INTERVALS.includes(every as (typeof INTERVALS)[number])) return { error: 'Pick an interval from the list.' };
  if (![from, to].every((h) => Number.isInteger(h) && h >= 0 && h <= 24)) return { error: 'Hours are 0–24.' };
  const s = await store.getSettings();
  await store.saveSettings({ ...s, enabled: form.get('enabled') === 'on', everyMinutes: every, fromHour: from, toHour: to });
  refresh();
  return { ok: true, message: 'Saved.' };
}

export async function saveFiltersAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireLogin();
  const list = (name: string) => splitList(String(form.get(name) ?? '')).slice(0, 50).map((w) => w.slice(0, 60));
  const keywords = list('keywords');
  if (!keywords.length) {
    const uses = (await store.listScrapers()).find((x) => x.enabled && /\{keyword(_slug)?\}/.test(x.config.url));
    if (uses) return { error: `Add at least one keyword: ${uses.name}'s link has {keyword} in it.` };
  }
  const s = await store.getSettings();
  await store.saveSettings({
    ...s,
    keywords,
    cities: list('cities'),
    remoteOk: form.get('remoteOk') === 'on',
    ignore: list('ignore'),
    mute: list('mute'),
  });
  refresh();
  return { ok: true, message: 'Saved. The next run uses them.' };
}

export async function setNotifyAction(notify: boolean): Promise<ActionState> {
  await requireLogin();
  await store.saveSettings({ ...(await store.getSettings()), notify });
  refresh();
  return { ok: true };
}

// ---- scrapers -----------------------------------------------------------------------------

export type ScraperForm = { id?: string; name: string; src: string; kind: string; enabled: boolean; config: ScraperConfig };
const BUILTIN_SRCS = new Set(Object.values(KINDS).flatMap((k) => (k.src ? [k.src] : [])));

/** The browser sends anything; keep what makes sense, or say what's wrong. */
function checkScraper(input: ScraperForm): { value?: store.ScraperInput; error?: string } {
  if (!isKind(input?.kind)) return { error: 'Pick a type.' };
  const kind: KindId = input.kind;
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) return { error: 'Give it a name.' };
  const src = KINDS[kind].src ?? String(input.src ?? '').trim().toLowerCase();
  if (!SRC_RE.test(src)) return { error: 'Source id: lowercase letters, digits, - or _, e.g. "linkedin".' };
  if (isGeneric(kind) && BUILTIN_SRCS.has(src)) return { error: `"${src}" belongs to a built-in board; pick another source id.` };

  const c = (input.config ?? {}) as Record<string, unknown>;
  const url = String(c.url ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return { error: 'The link must start with https://' };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((c.headers ?? {}) as Record<string, unknown>).slice(0, 20)) {
    if (!/^[A-Za-z0-9-]{1,60}$/.test(k)) return { error: `Bad header name "${k.slice(0, 40)}".` };
    headers[k] = String(v).slice(0, 500);
  }
  const config: ScraperConfig = { url, headers, checkKeyword: Boolean(c.checkKeyword), checkLocation: Boolean(c.checkLocation) };

  if (kind === 'json' || kind === 'html') {
    const fields: Partial<Record<FieldId, string>> = {};
    const given = (c.fields ?? {}) as Record<string, unknown>;
    for (const f of FIELDS) {
      const v = String(given[f.id] ?? '').trim().slice(0, 300);
      if (v) fields[f.id] = v;
    }
    config.items = String(c.items ?? '').trim().slice(0, 300);
    config.fields = fields;
    if (kind === 'html' && !config.items) return { error: 'Give the CSS selector of one offer.' };
    if (!fields.title || !fields.url) return { error: 'Title and Link are needed.' };
    if (kind === 'json') {
      const from = JSON_SOURCES.find((s) => s.id === c.from)?.id ?? 'body';
      config.from = from;
      if (from === 'script') {
        config.scriptId = String(c.scriptId ?? '').trim().slice(0, 100);
        if (!config.scriptId) return { error: 'Give the id of the <script> with the JSON.' };
      }
    }
  }
  return { value: { name, src, kind, enabled: input.enabled !== false, config } };
}

export async function saveScraperAction(input: ScraperForm): Promise<ActionState & { id?: string }> {
  await requireLogin();
  const { value, error } = checkScraper(input);
  if (!value) return { error };
  try {
    if (input.id) {
      const old = await store.getScraper(input.id);
      if (!old) return { error: 'This scraper no longer exists.' };
      // a different search: its first run only saves, so Telegram isn't flooded with "new" old offers
      const changed = old.kind !== value.kind || old.src !== value.src || old.config.url !== value.config.url;
      await store.updateScraper(input.id, value, changed);
      refresh();
      return { ok: true, id: input.id };
    }
    const all = await store.listScrapers();
    const id = await store.insertScraper({ ...value, position: Math.max(0, ...all.map((s) => s.position)) + 1 });
    refresh();
    return { ok: true, id };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function toggleScraperAction(id: string, enabled: boolean): Promise<ActionState> {
  await requireLogin();
  await store.updateScraper(String(id), { enabled: Boolean(enabled) });
  refresh();
  return { ok: true };
}

export async function deleteScraperAction(id: string): Promise<ActionState> {
  await requireLogin();
  await store.deleteScraper(String(id));
  refresh();
  return { ok: true };
}

export type TestOffer = {
  id: string;
  title: string;
  company: string | null;
  url: string;
  remote: boolean;
  locations: string[];
  seniority: string | null;
  known: boolean;
};
export type TestResult = {
  ok: boolean;
  error: string | null;
  found: number;
  kept: number;
  fresh: number;
  skipped: { keyword: number; area: number; ignored: number };
  pages: PageResult[];
  offers: TestOffer[];
  sample?: string;
  ms: number;
};

/** Fetches with the form's current values; nothing is saved. */
export async function testScraperAction(input: ScraperForm): Promise<TestResult | { error: string }> {
  await requireLogin();
  const { value, error } = checkScraper(input);
  if (!value) return { error: error! };
  const r = await scrape(value, await store.getSettings());
  const known = await store.knownIds(value.src, r.kept.slice(0, 200).map((o) => o.id)).catch(() => new Set<string>());
  return {
    ok: r.ok,
    error: r.error,
    found: r.found,
    kept: r.kept.length,
    fresh: r.kept.slice(0, 200).filter((o) => !known.has(o.id)).length,
    skipped: r.skipped,
    pages: r.pages,
    offers: r.kept.slice(0, 25).map((o) => ({
      id: o.id, title: o.title, company: o.company, url: o.url, remote: o.remote, locations: o.locations.slice(0, 3), seniority: o.seniority, known: known.has(o.id),
    })),
    sample: r.sample,
    ms: r.ms,
  };
}

// ---- Telegram -------------------------------------------------------------------------------

export async function setMutedAction(muted: boolean): Promise<ActionState> {
  await requireLogin();
  await store.setMuted(Boolean(muted));
  if (!muted && telegramReady()) after(() => flushQueue(true).catch(() => {}));
  refresh();
  return { ok: true };
}

export async function sendQueueAction(): Promise<ActionState> {
  await requireLogin();
  try {
    const n = await flushQueue(true);
    refresh();
    return { ok: true, message: n ? `Sent ${n}.` : 'Nothing queued.' };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function telegramTestAction(): Promise<ActionState> {
  await requireLogin();
  try {
    await sendMessage('✅ Jobwatch can write to this chat.');
    return { ok: true, message: 'Sent – check Telegram.' };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function telegramConnectAction(): Promise<ActionState> {
  await requireLogin();
  try {
    await connectWebhook(`${await origin()}/api/telegram`);
    refresh();
    return { ok: true, message: 'Connected. Try /status in the chat.' };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function telegramDisconnectAction(): Promise<ActionState> {
  await requireLogin();
  try {
    await disconnectWebhook();
    refresh();
    return { ok: true, message: 'Disconnected.' };
  } catch (e) {
    return { error: message(e) };
  }
}

// ---- Supabase Cron ------------------------------------------------------------------------

export async function cronConnectAction(): Promise<ActionState> {
  await requireLogin();
  const secret = await cronSecret();
  if (!secret) return { error: 'Set APP_PASSWORD (or CRON_SECRET) first: the endpoint needs a secret.' };
  try {
    const r = await store.cronConnect(`${await origin()}/api/cron/scrape`, secret);
    refresh();
    return r === 'ok' ? { ok: true, message: 'Supabase now calls the app every 5 minutes.' } : { error: r };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function cronDisconnectAction(): Promise<ActionState> {
  await requireLogin();
  try {
    const r = await store.cronDisconnect();
    refresh();
    return r === 'ok' ? { ok: true, message: 'Stopped.' } : { error: r };
  } catch (e) {
    return { error: message(e) };
  }
}
