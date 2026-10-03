// Shared by the server and client components.
import * as z from 'zod/mini';
import { BOARD_RE, SCRAPED_BOARDS } from '../../boards';
import { FIELDS, JSON_SOURCES, type FieldId, type JsonSource, type ScraperConfig } from '../../listings/config';
import { KIND_IDS, isGeneric, kindOf } from '../../listings/kinds';
import { MAX_PAGES } from '../../listings/match';
import { problem, string, text } from './common';

const SCRAPED_SRCS = new Set<string>(SCRAPED_BOARDS.map((board) => board.id));
const JSON_SOURCE_IDS = JSON_SOURCES.map((source) => source.id) as [JsonSource, ...JsonSource[]];
const HEADER_NAME = /^[A-Za-z0-9-]{1,60}$/;
const LINK = 'The link must start with https://';

const strings = () => z._default(z.record(z.string(), z.string()), {});

const configSchema = z.object({
  url: z.string({ error: LINK }).check(z.trim(), z.regex(/^https?:\/\/\S+$/i, LINK)),
  // the first 20; their names checked, their values cut to 500 characters
  headers: z.pipe(
    strings(),
    z.transform((headers: Record<string, string>, ctx) => {
      const entries = Object.entries(headers).slice(0, 20);
      const bad = entries.find(([name]) => !HEADER_NAME.test(name));
      if (bad) return problem(ctx, `Bad header name "${bad[0].slice(0, 40)}".`);
      return Object.fromEntries(entries.map(([name, value]) => [name, value.slice(0, 500)]));
    }),
  ),
  checkKeyword: z._default(z.boolean(), false),
  checkLocation: z._default(z.boolean(), false),
  pages: z.optional(z.number()),
  from: z.catch(z._default(z.enum(JSON_SOURCE_IDS), 'body'), 'body'),
  scriptId: text(100),
  items: text(300),
  // a path / selector per field, the empty ones left out
  fields: z.pipe(
    strings(),
    z.transform((given: Record<string, string>) => {
      const fields: Partial<Record<FieldId, string>> = {};
      for (const field of FIELDS) {
        const value = given[field.id] as string | undefined;
        if (value?.trim()) fields[field.id] = value.trim().slice(0, 300);
      }
      return fields;
    }),
  ),
});

/**
 * A scraper as the editor sends it (Save and Test): what makes sense is kept, else what's wrong
 * (at the field it's about, for the editor to show it there).
 */
export const scraperSchema = z.pipe(
  z.object({
    id: z.optional(z.string()),
    kind: z.enum(KIND_IDS, { error: 'Pick a type.' }),
    name: text(60).check(z.refine(Boolean, 'Give it a name.')),
    src: string(),
    enabled: z._default(z.boolean(), true),
    config: configSchema,
  }),
  z.transform(({ id, kind, name, enabled, ...input }, ctx) => {
    // a built-in board's id is fixed, so its offers keep matching the ones already saved
    const src = kindOf(kind).src ?? input.src.trim().toLowerCase();
    if (!BOARD_RE.test(src))
      return problem(ctx, 'Board id: lowercase letters, digits, - or _, e.g. "linkedin".', ['src']);
    if (isGeneric(kind) && SCRAPED_SRCS.has(src))
      return problem(ctx, `"${src}" belongs to a built-in board; pick another board id.`, ['src']);

    const given = input.config;
    const config: ScraperConfig = {
      url: given.url,
      headers: given.headers,
      checkKeyword: given.checkKeyword,
      checkLocation: given.checkLocation,
    };
    if (/\{(start|page)\}/.test(given.url))
      config.pages = Math.max(1, Math.min(MAX_PAGES, Math.floor(given.pages ?? 1) || 1));
    if (kind === 'json' || kind === 'html') {
      config.items = given.items;
      config.fields = given.fields;
      if (kind === 'html' && !config.items)
        return problem(ctx, 'Give the CSS selector of one offer.', ['config', 'items']);
      if (!given.fields.title || !given.fields.url)
        return problem(ctx, 'Title and Link are needed.', ['config', 'fields', given.fields.title ? 'url' : 'title']);
      if (kind === 'json') {
        config.from = given.from;
        if (given.from === 'script') {
          config.scriptId = given.scriptId;
          if (!config.scriptId)
            return problem(ctx, 'Give the id of the <script> with the JSON.', ['config', 'scriptId']);
        }
      }
    }
    return { id, scraper: { name, src, kind, enabled, config } };
  }),
);

export type ScraperForm = z.input<typeof scraperSchema>;

export const scraperIdSchema = z.object({ id: z.string().check(z.minLength(1)) });
export const toggleScraperSchema = z.object({ id: z.string().check(z.minLength(1)), enabled: z.boolean() });
