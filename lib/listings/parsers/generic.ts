// The generic scrapers' parsers (JSON, HTML, RSS): they read a page the way the scraper's own config says.
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import { message } from '../../shared/errors';
import type { FieldId, ScraperConfig } from '../config';
import {
  angular,
  isObj,
  json,
  keysOf,
  nameOf,
  num,
  sampleOf,
  scriptById,
  str,
  strip,
  time,
  valuesAt,
} from '../extract';
import type { Found, ListingParser } from '../types';

const textOf = (value: unknown): string =>
  typeof value === 'boolean' ? String(value) : isObj(value) ? nameOf(value) : strip(str(value));
const first = (values: unknown[]) => (values.length ? textOf(values[0]) : '');
const truthy = (values: unknown[]) =>
  values.some((value) => value === true || /^(true|yes|1)$|remote|zdaln/i.test(textOf(value)));
const absolute = (link: string, base: string) => {
  try {
    return link ? new URL(link, base).toString() : '';
  } catch {
    return '';
  }
};

function toFound(
  src: string,
  item: unknown,
  get: (item: unknown, field: FieldId) => unknown[],
  link: (item: unknown) => string,
): Found {
  const url = link(item);
  const date = get(item, 'date')[0];
  return {
    src,
    id: first(get(item, 'id')) || url,
    title: first(get(item, 'title')),
    company: first(get(item, 'company')) || null,
    seniority: first(get(item, 'seniority')) || null,
    remote: truthy(get(item, 'remote')),
    url,
    locations: get(item, 'location').map(textOf).filter(Boolean),
    skills: get(item, 'skills').map(textOf).filter(Boolean),
    sort: num(date) ?? time(date),
  };
}

// ---- JSON ------------------------------------------------------------------------------------

function jsonRoot(body: string, config: ScraperConfig): unknown {
  switch (config.from ?? 'body') {
    case 'next-data': {
      const raw = scriptById(body, '__NEXT_DATA__');
      if (raw === null) throw new Error('No <script id="__NEXT_DATA__"> in the page');
      return json(raw, '__NEXT_DATA__');
    }
    case 'ld-json': {
      const blocks = [...body.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      if (!blocks.length) throw new Error('No <script type="application/ld+json"> in the page');
      return blocks.map((match) => {
        try {
          return JSON.parse(match[1]) as unknown;
        } catch {
          return null;
        }
      });
    }
    case 'script': {
      if (!config.scriptId) throw new Error('Give the id of the <script> that holds the JSON');
      const raw = scriptById(body, config.scriptId);
      if (raw === null) throw new Error(`No <script id="${config.scriptId}"> in the page`);
      try {
        return JSON.parse(raw);
      } catch {
        return json(angular(raw), `<script id="${config.scriptId}">`);
      }
    }
    default:
      return json(body, 'The answer');
  }
}

export const parseJson: ListingParser = (body, { src, url, config }) => {
  const root = jsonRoot(body, config);
  if (!config.items?.trim() && !Array.isArray(root)) {
    throw new Error(`Give the path to the list of offers (the JSON has: ${keysOf(root)})`);
  }
  const at = valuesAt(root, config.items);
  const list = at.length === 1 && Array.isArray(at[0]) ? (at[0] as unknown[]) : at; // "data" and "data[]" both work
  if (!list.length) throw new Error(`Nothing at "${config.items}" (the JSON has: ${keysOf(root)})`);
  const fields = config.fields ?? {};
  // a path to a list gives its items: "tags" works like "tags[]"
  const get = (item: unknown, field: FieldId) => (fields[field]?.trim() ? valuesAt(item, fields[field]).flat() : []);
  const link = (item: unknown) => {
    const template = fields.url ?? '';
    // "https://site/job/{slug}" fills in values from the offer; otherwise it's a path
    const raw = template.includes('{')
      ? template.replace(/\{([^}]+)\}/g, (_, path: string) => first(valuesAt(item, path)))
      : first(get(item, 'url'));
    return absolute(raw, url);
  };
  return { total: list.length, sample: sampleOf(list[0]), items: list.map((item) => toFound(src, item, get, link)) };
};

// ---- HTML ------------------------------------------------------------------------------------

/** "a.title" = its text, "a.title@href" = an attribute, "@data-id" = the card's own attribute */
function selectorParts(sel: string) {
  const match = sel.trim().match(/^(.*?)(?:@([\w:-]+))?$/);
  return { css: match?.[1]?.trim() ?? '', attr: match?.[2] };
}

export const parseHtmlListing: ListingParser = (body, { src, url, config }) => {
  if (!config.items?.trim()) throw new Error('Give the CSS selector of one offer');
  let cards: HTMLElement[];
  try {
    cards = parseHtml(body).querySelectorAll(config.items);
  } catch (error) {
    throw new Error(`Bad selector "${config.items}": ${message(error)}`);
  }
  if (!cards.length)
    throw new Error(`No "${config.items}" in the page (${body.length} bytes; blocked, or rendered by JavaScript?)`);
  const fields = config.fields ?? {};
  const get = (card: unknown, field: FieldId): unknown[] => {
    const sel = fields[field];
    if (!sel?.trim()) return [];
    const { css, attr } = selectorParts(sel);
    const el = card as HTMLElement;
    let found: HTMLElement[];
    try {
      found = css ? el.querySelectorAll(css) : [el];
    } catch {
      return [];
    }
    return found
      .map((element) => (attr ? (element.getAttribute(attr) ?? '') : element.text))
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  };
  const link = (card: unknown) => absolute(first(get(card, 'url')), url);
  return {
    total: cards.length,
    sample: cards[0].outerHTML.slice(0, 3000),
    items: cards.map((card) => toFound(src, card, get, link)),
  };
};

// ---- RSS / Atom ------------------------------------------------------------------------------

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? strip(match[1]) : '';
}

export const parseRss: ListingParser = (body, { src, url }) => {
  const blocks = body.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  if (!blocks.length) throw new Error('No <item> or <entry> in the feed');
  const items = blocks.map((block): Found => {
    const link = absolute(tag(block, 'link') || (block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? ''), url);
    const author = tag(block, 'dc:creator') || tag(block, 'name') || tag(block, 'author');
    return {
      src,
      id: tag(block, 'guid') || tag(block, 'id') || link,
      title: tag(block, 'title'),
      company: author || null,
      seniority: null,
      remote: /remote|zdaln/i.test(tag(block, 'title')),
      url: link,
      locations: [],
      skills: [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
        .map((match) => strip(match[1]))
        .filter(Boolean),
      sort: time(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')),
    };
  });
  return { total: blocks.length, items, sample: blocks[0]?.slice(0, 3000) };
};
