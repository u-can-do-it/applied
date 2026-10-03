import 'server-only';
import { parse, type HTMLElement } from 'node-html-parser';
import { htmlToText } from './shared/html';

// A fetched page read with an HTML parser (node-html-parser) rather than regular expressions:
// attributes in any order and quoting, entities decoded, a script's contents kept as they are.
// Server-only, so the parser stays out of the browser's bundle.

export type Page = HTMLElement;

/**
 * The page as a tree. A tag left open is closed where its parent ends, instead of being dropped
 * with its content (the parser's default for markup it can't match up).
 */
export const parsePage = (html: string): Page => parse(html, { parseNoneClosedTags: true });

const scripts = (page: Page) => page.querySelectorAll('script');

/** The contents of every <script type="…"> of this type, in the page's order. */
export const scriptsOfType = (page: Page, type: string): string[] =>
  scripts(page)
    .filter((script) => script.getAttribute('type')?.trim().toLowerCase() === type)
    .map((script) => script.rawText);

/** The contents of <script id="…">, or null when the page has none. */
export const scriptById = (page: Page, id: string): string | null =>
  scripts(page).find((script) => script.id === id)?.rawText ?? null;

/** The page's <title> as one line of text ('' without one). */
export const pageTitle = (page: Page): string =>
  (page.querySelector('head title') ?? page.querySelector('title'))?.text.replace(/\s+/g, ' ').trim() ?? '';

/** Where the start tag at `from` ends: past its ">", a ">" inside a quoted attribute value skipped. */
function afterStartTag(html: string, from: number): number {
  let quote = '';
  for (let at = from; at < html.length; at++) {
    const char = html[at];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return at + 1;
  }
  return html.length;
}

/**
 * A site with no known layout: the page's <main> (or <article>) as text. The parser finds the
 * element; its content is what the source has between its start tag and its own end tag, so a tag
 * left open inside it doesn't make it run on past </main> (into the footer).
 */
export function mainText(html: string): string {
  const page = parsePage(html);
  const main = page.querySelector('main') ?? page.querySelector('article');
  if (!main) return '';
  const open = afterStartTag(html, main.range[0]);
  const close = html.toLowerCase().indexOf(`</${main.rawTagName.toLowerCase()}`, open);
  return htmlToText(close >= 0 ? html.slice(open, close) : main.innerHTML);
}
