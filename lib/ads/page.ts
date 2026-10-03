import 'server-only';
import { htmlToText } from '../shared/html';
import type { Ad } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';

/** A site with no known layout: the page's <main> (or <article>) as text. */
export function mainText(html: string) {
  const match = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  return match ? htmlToText(match[1]) : '';
}

/**
 * The offer's page: its JobPosting, else what `textOf` finds in the HTML. By default nothing: the
 * rest of a board's page is the board's own (menus, other offers), not the ad.
 */
export async function readPage(url: string, textOf: (html: string) => string = () => ''): Promise<Ad> {
  const html = await (await get(url, 'text/html')).text();
  const jp = findJobPosting(html);
  if (jp) return fromJobPosting(jp);
  return { text: textOf(html), details: {} };
}
