import 'server-only';
import { env } from './env';

// What the server sends to other sites (listing pages, offers' ads, links typed in "Add application").

/** A desktop browser's User-Agent: some boards answer bots with nothing. */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[(::1|f[cd])|metadata)/i;

/** Throws unless the link is http(s) and, in production, not the server's own network (SSRF). */
export function checkUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Not a link: ${raw.slice(0, 80)}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https links');
  // a scraper or a typed link must not read the server's own network
  if (env.NODE_ENV === 'production' && PRIVATE_HOST.test(u.hostname))
    throw new Error('Private addresses are not allowed');
}
