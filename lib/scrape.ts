// Full ad text for one offer, from the board's own page.
// 5 of 6 boards publish a schema.org JobPosting (the markup Google Jobs reads); NoFluff's
// JobPosting only has the benefits, so it comes from their public API; Built In has no
// JobPosting, so its ad body is cut out of the HTML.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_CHARS = 8000; // per offer; requirements come first on every board, the rest is mostly benefits
const TIMEOUT_MS = 12_000;

export type Scraped = { status: 'ok' | 'empty'; text: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•' };
function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** HTML (possibly entity-escaped, as inside JSON-LD) -> readable plain text with line breaks and bullets */
export function htmlToText(html: unknown): string {
  let s = decodeEntities(String(html ?? '')); // "&lt;li&gt;" -> "<li>"
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const asText = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.description ?? o.value ?? o.credentialCategory ?? '');
  }
  return htmlToText(v);
};

function findJobPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== 'object') continue;
      if (Array.isArray(x)) {
        stack.push(...x);
        continue;
      }
      const o = x as Record<string, unknown>;
      if ([].concat((o['@type'] as never) ?? []).includes('JobPosting' as never)) return o;
      if (o['@graph']) stack.push(o['@graph']);
    }
  }
  return null;
}

function fromJobPosting(jp: Record<string, unknown>) {
  const parts = [
    ['Skills', asText(jp.skills)],
    ['Experience', asText(jp.experienceRequirements)],
    ['Qualifications', asText(jp.qualifications)],
    ['Responsibilities', asText(jp.responsibilities)],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return [...parts, asText(jp.description)].filter(Boolean).join('\n\n');
}

async function get(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pl,en;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function nofluff(id: string) {
  const p = await (await get(`https://nofluffjobs.com/api/posting/${encodeURIComponent(id)}`)).json();
  const list = (xs: { value?: string }[] | undefined) => (xs ?? []).map((x) => x.value).filter(Boolean).join(', ');
  const tasks = (p.specs?.dailyTasks ?? []).map((t: string) => `• ${String(t).trim()}`).join('\n');
  return [
    list(p.requirements?.musts) && `Must have: ${list(p.requirements.musts)}`,
    list(p.requirements?.nices) && `Nice to have: ${list(p.requirements.nices)}`,
    p.basics?.seniority?.length && `Seniority: ${p.basics.seniority.join(', ')}`,
    (p.requirements?.languages ?? []).length &&
      `Languages: ${p.requirements.languages.map((l: { code?: string; level?: string }) => [l.code, l.level].filter(Boolean).join(' ')).join(', ')}`,
    htmlToText(p.requirements?.description),
    tasks && `Daily tasks:\n${tasks}`,
    htmlToText(p.details?.description),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function builtinBody(html: string) {
  const i = html.search(/id="job-post-body-\d+"/);
  if (i < 0) return '';
  const start = html.indexOf('>', i) + 1;
  // the body is one block; the next section starts with another id="job-..." or a <section>
  const rest = html.slice(start);
  const end = rest.search(/<section|id="job-(?!post-body)/);
  return htmlToText(end > 0 ? rest.slice(0, end) : rest.slice(0, 60_000));
}

/** Never throws for "no description": only network / HTTP errors throw, so they can be retried later. */
export async function scrapeOffer(copy: { src: string; id: string; url: string }): Promise<Scraped> {
  let text = '';
  if (copy.src === 'nofluff') {
    text = await nofluff(copy.id);
  } else {
    const html = await (await get(copy.url)).text();
    const jp = findJobPosting(html);
    text = jp ? fromJobPosting(jp) : copy.src === 'builtin' ? builtinBody(html) : '';
  }
  text = text.trim();
  return text.length >= 80 ? { status: 'ok', text: text.slice(0, MAX_CHARS) } : { status: 'empty', text: '' };
}
