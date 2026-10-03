import { byId } from '@/lib/boards';
import { FIELDS, type FieldId, type JsonSource } from '@/lib/listings/config';
import { kindOf, type KindId } from '@/lib/listings/kinds';
import type { Scraper } from '@/lib/db/repos/scrapers';
import type { ScraperForm } from '@/lib/shared/schemas/scrapers';

// A scraper as its editor's form holds it, from and to what's saved.

export type Draft = {
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
  fields: Record<FieldId, string>; // '' = not mapped
};

const headerText = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
const mapping = (fields: Partial<Record<FieldId, string>> = {}) =>
  Object.fromEntries(FIELDS.map((field) => [field.id, fields[field.id] ?? ''])) as Record<FieldId, string>;
const parseHeaders = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2]]),
  );

export function toDraft(scraper: Scraper): Draft {
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
    fields: mapping(scraper.config.fields),
  };
}

/** A new scraper of a kind: the built-in boards start with their usual search. */
export function blank(kind: KindId, keep?: Partial<Draft>): Draft {
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
    fields: mapping(),
  };
}

export const toForm = (draft: Draft): ScraperForm => ({
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
