import 'server-only';
import { parsePage, type Page } from '../dom';
import type { Ad } from './details';
import { get } from './fetch';
import { findJobPosting, fromJobPosting } from './job-posting';

/**
 * The offer's page: its JobPosting, else what `textOf` finds in the page. By default nothing: the
 * rest of a board's page is the board's own (menus, other offers), not the ad.
 */
export async function readPage(url: string, textOf: (page: Page, html: string) => string = () => ''): Promise<Ad> {
  const html = await (await get(url, 'text/html')).text();
  const page = parsePage(html);
  const jp = findJobPosting(page);
  if (jp) return fromJobPosting(jp);
  return { text: textOf(page, html), details: {} };
}
