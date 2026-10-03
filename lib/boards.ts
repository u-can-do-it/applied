// Which job board a link is on, and the offer's id there, to find it among the scraped offers.
// Shared by the server and the "Add application" window (no secrets here).

const HOSTS: [RegExp, string][] = [
  [/(^|\.)justjoin\.it$/, 'justjoin'],
  [/(^|\.)nofluffjobs\.com$/, 'nofluff'],
  [/(^|\.)solid\.jobs$/, 'solidjobs'],
  [/(^|\.)bulldogjob\.pl$/, 'bulldog'],
  [/(^|\.)czyjesteldorado\.pl$/, 'eldorado'],
  [/(^|\.)builtin\.com$/, 'builtin'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)theprotocol\.it$/, 'theprotocol'],
  [/(^|\.)pracuj\.pl$/, 'pracuj'],
  [/(^|\.)rocketjobs\.pl$/, 'rocketjobs'],
  [/(^|\.)indeed\.com$/, 'indeed'],
  [/(^|\.)olx\.pl$/, 'olx'],
];

/** suggestions for the board field; any lowercase id works */
export const BOARD_SUGGESTIONS = [
  'justjoin',
  'nofluff',
  'solidjobs',
  'bulldog',
  'eldorado',
  'builtin',
  'linkedin',
  'theprotocol',
  'pracuj',
  'rocketjobs',
  'indeed',
  'facebook',
  'email',
  'referral',
  'unknown',
];

export const BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

const parse = (link: string) => {
  try {
    const u = new URL(link.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};

export const isLink = (link: string) => Boolean(parse(link));

// two-part endings, where the name is one further left: acme.co.uk, acme.com.pl, acme.com.au
const TWO_PART = /\.(?:co|com|net|org|gov|edu|ac)\.[a-z]{2}$/;

/** justjoin, nofluff, … for a board; an employer's page opened from Eldorado counts as Eldorado;
 * other sites by their name (job-boards.greenhouse.io -> greenhouse). */
export function boardOf(link: string): string {
  const u = parse(link);
  if (!u) return 'unknown';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const [re, board] of HOSTS) if (re.test(host)) return board;
  if (/czyjesteldorado/i.test(u.search)) return 'eldorado';
  const parts = host.split('.');
  const ending = TWO_PART.test(host) && parts.length > 2 ? 2 : 1;
  const name = parts.length > ending ? parts[parts.length - ending - 1] : parts[0];
  return BOARD_RE.test(name) ? name : 'unknown';
}

/** The link without tracking: a board's own links need no query at all (but Indeed's job id is in it,
 * as LinkedIn's can be), others lose utm_* and the like. */
export function cleanLink(link: string): string {
  const u = parse(link);
  if (!u) return link.trim();
  const board = boardOf(u.toString());
  if (board === 'indeed') {
    const id = boardIdOf('indeed', u.toString());
    if (id) return `${u.origin}/viewjob?jk=${encodeURIComponent(id)}`;
  }
  if (HOSTS.some(([, b]) => b === board) && board !== 'linkedin' && board !== 'indeed') u.search = '';
  else
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|eclid$|source$|sourceId$|ref$|trk|refId$|trackingId$|position$|pageNum$)/i.test(k))
        u.searchParams.delete(k);
  u.hash = '';
  if (board === 'nofluff') u.pathname = u.pathname.replace(/^\/(?:[a-z]{2}\/)?job\//, '/pl/job/'); // the app keeps /pl/job/
  if (board === 'linkedin') {
    const id = boardIdOf('linkedin', u.toString());
    if (id) return `https://www.linkedin.com/jobs/view/${id}`;
  }
  return u.toString();
}

/** %C3%B3 -> ó, but a stray "%" (/job-offer/50%-remote) stays as it is instead of throwing */
const decodePath = (path: string) =>
  path.replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });

/** The offer's id as the scrapers store it (offers.id), when the link shows it. */
export function boardIdOf(board: string, link: string): string | null {
  const u = parse(link);
  if (!u) return null;
  const path = decodePath(u.pathname);
  if (board === 'justjoin') return path.match(/\/job-offer\/([^/?#]+)/)?.[1] ?? null;
  // NoFluff stores its posting id; the link's slug is what its API takes (match NoFluff by link)
  if (board === 'nofluff') return path.match(/\/job\/([^/?#]+)/)?.[1] ?? null;
  if (board === 'bulldog') return path.match(/\/companies\/jobs\/([^/?#]+)/)?.[1] ?? null;
  if (board === 'linkedin')
    return path.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/)?.[1] ?? u.searchParams.get('currentJobId');
  if (board === 'eldorado') return path.match(/\/praca\/(\d+)/)?.[1] ?? null;
  // viewjob?jk=…; a search page shows one job as vjk=…
  if (board === 'indeed') return u.searchParams.get('jk') || u.searchParams.get('vjk') || null;
  return null;
}
