// Reading job links, whatever the board: what a board file's link rules are built from, and what
// any other site gets. Shared by the server and the browser (no secrets here).

/** A board id as offers.src stores it: lowercase, digits, - or _. */
export const BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

/** The link as a URL, when it is an http(s) one. */
export function parseLink(link: string): URL | null {
  try {
    const url = new URL(link.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export const isLink = (link: string) => Boolean(parseLink(link));

/** The host as the boards' host patterns are written: lowercase, without "www." */
export const bareHost = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');

// two-part endings, where the name is one further left: acme.co.uk, acme.com.pl, acme.com.au
const TWO_PART = /\.(?:co|com|net|org|gov|edu|ac)\.[a-z]{2}$/;

/** A site that is not a known board, by its name (job-boards.greenhouse.io -> greenhouse). */
export function siteName(host: string): string {
  const parts = host.split('.');
  const ending = TWO_PART.test(host) && parts.length > 2 ? 2 : 1;
  const name = parts.length > ending ? parts[parts.length - ending - 1] : parts[0];
  return BOARD_RE.test(name) ? name : 'unknown';
}

/** The path, decoded (%C3%B3 -> ó), but a stray "%" (/job-offer/50%-remote) stays as it is instead of throwing. */
export const pathOf = (url: URL) =>
  url.pathname.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });

/** A board's own link: no query or hash at all. */
export function withoutQuery(url: URL): URL {
  const copy = new URL(url);
  copy.search = '';
  copy.hash = '';
  return copy;
}

const TRACKING = /^(utm_|eclid$|source$|sourceId$|ref$|trk|refId$|trackingId$|position$|pageNum$)/i;

/** Any other link keeps its query, but not utm_* and the like, nor its hash. */
export function withoutTracking(url: URL): string {
  const copy = new URL(url);
  for (const key of [...copy.searchParams.keys()]) if (TRACKING.test(key)) copy.searchParams.delete(key);
  copy.hash = '';
  return copy.toString();
}
