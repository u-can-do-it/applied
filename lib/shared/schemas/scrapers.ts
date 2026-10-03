// Shared by the server and client components.
import { z } from 'zod';
import { BOARD_RE, SCRAPED_BOARDS } from '../../boards';
import { FIELDS, JSON_SOURCES, type FieldId, type JsonSource, type ScraperConfig } from '../../listings/config';
import { KIND_IDS, isGeneric, kindOf } from '../../listings/kinds';
import { MAX_PAGES } from '../../listings/match';
import { text } from './common';

const SCRAPED_SRCS = new Set<string>(SCRAPED_BOARDS.map((board) => board.id));
const JSON_SOURCE_IDS = JSON_SOURCES.map((source) => source.id) as [JsonSource, ...JsonSource[]];
const HEADER_NAME = /^[A-Za-z0-9-]{1,60}$/;
const LINK = 'The link must start with https://';

const configSchema = z.object({
  url: z
    .string({ error: LINK })
    .trim()
    .regex(/^https?:\/\/\S+$/i, LINK),
  // the first 20; their names checked, their values cut to 500 characters
  headers: z
    .record(z.string(), z.string())
    .default({})
    .transform((headers, ctx) => {
      const entries = Object.entries(headers).slice(0, 20);
      const bad = entries.find(([name]) => !HEADER_NAME.test(name));
      if (bad) {
        ctx.addIssue({ code: 'custom', message: `Bad header name "${bad[0].slice(0, 40)}".` });
        return z.NEVER;
      }
      return Object.fromEntries(entries.map(([name, value]) => [name, value.slice(0, 500)]));
    }),
  checkKeyword: z.boolean().default(false),
  checkLocation: z.boolean().default(false),
  pages: z.number().optional(),
  from: z.enum(JSON_SOURCE_IDS).default('body').catch('body'),
  scriptId: text(100),
  items: text(300),
  // a path / selector per field, the empty ones left out
  fields: z
    .record(z.string(), z.string())
    .default({})
    .transform((given: Partial<Record<string, string>>) => {
      const fields: Partial<Record<FieldId, string>> = {};
      for (const field of FIELDS) {
        const value = given[field.id]?.trim().slice(0, 300);
        if (value) fields[field.id] = value;
      }
      return fields;
    }),
});

/** A scraper as the editor sends it (Save and Test): what makes sense is kept, else what's wrong. */
export const scraperSchema = z
  .object({
    id: z.string().optional(),
    kind: z.enum(KIND_IDS, { error: 'Pick a type.' }),
    name: text(60).refine(Boolean, 'Give it a name.'),
    src: z.string().default(''),
    enabled: z.boolean().default(true),
    config: configSchema,
  })
  .transform(({ id, kind, name, enabled, ...input }, ctx) => {
    const problem = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    };
    // a built-in board's id is fixed, so its offers keep matching the ones already saved
    const src = kindOf(kind).src ?? input.src.trim().toLowerCase();
    if (!BOARD_RE.test(src)) return problem('Source id: lowercase letters, digits, - or _, e.g. "linkedin".');
    if (isGeneric(kind) && SCRAPED_SRCS.has(src))
      return problem(`"${src}" belongs to a built-in board; pick another source id.`);

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
      if (kind === 'html' && !config.items) return problem('Give the CSS selector of one offer.');
      if (!given.fields.title || !given.fields.url) return problem('Title and Link are needed.');
      if (kind === 'json') {
        config.from = given.from;
        if (given.from === 'script') {
          config.scriptId = given.scriptId;
          if (!config.scriptId) return problem('Give the id of the <script> with the JSON.');
        }
      }
    }
    return { id, scraper: { name, src, kind, enabled, config } };
  });

export type ScraperForm = z.input<typeof scraperSchema>;

export const scraperIdSchema = z.object({ id: z.string().min(1) });
export const toggleScraperSchema = z.object({ id: z.string().min(1), enabled: z.boolean() });
