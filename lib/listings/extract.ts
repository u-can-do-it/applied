// Small readers for the untyped data a listing page gives (JSON, embedded scripts, text), used by the
// boards' own parsers and the generic ones. Shared by the server and the browser.
import { decodeEntities } from '../shared/html';

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
export const nameOf = (v: unknown) => (isObj(v) ? str(v.name ?? v.title ?? v.label ?? v.value) : str(v));
export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
export const time = (v: unknown) => {
  if (typeof v === 'number') return v;
  const t = Date.parse(str(v));
  return Number.isFinite(t) ? t : undefined;
};
export const keysOf = (v: unknown) =>
  isObj(v) ? Object.keys(v).slice(0, 12).join(', ') : Array.isArray(v) ? 'a list' : typeof v;
// JSON.stringify(undefined) is undefined, whatever its type says
export const sampleOf = (v: unknown) => (JSON.stringify(v, null, 2) as string | undefined)?.slice(0, 3000);

export function json(text: string, what: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not JSON: ${text.trim().slice(0, 100)}`);
  }
}

/** HTML or a feed's text -> one line of plain text */
export const strip = (s: string) =>
  decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

// whole words, Polish letters included (\b only knows ASCII): "Staff" but not "Staffing", "Lead" but
// not "Leadership" or "Lead Generation", "Interns" but not "Internal"
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'iu');
const SENIOR = word('senior|lead(?:er)?(?!\\s+generation)|principal|staff');
const JUNIOR = word('junior|interns?|internships?|trainees?|stażyst\\p{L}*|staż|graduates?');

/** For boards without a level of their own: from the title's words. */
export const seniorityOf = (title: string) =>
  SENIOR.test(title) ? 'senior' : JUNIOR.test(title) ? 'junior' : 'unknown';

/** Angular's TransferState escapes its JSON with &q; &a; &l; &g; &s; */
export const angular = (s: string) =>
  s.replace(/&q;/g, '"').replace(/&a;/g, '&').replace(/&l;/g, '<').replace(/&g;/g, '>').replace(/&s;/g, "'");

/** The text of <script id="…">, or null when the page has none. */
export function scriptById(html: string, id: string) {
  const re = new RegExp(
    `<script[^>]*\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)</script>`,
    'i',
  );
  return html.match(re)?.[1] ?? null;
}

/**
 * Every value at a path: "data", "props.pageProps.jobs", "locations[].city" ([] = each item of a
 * list, [0] = the first one). Missing parts give nothing instead of an error.
 */
export function valuesAt(root: unknown, path: string | undefined): unknown[] {
  if (!path?.trim()) return [root];
  let cur: unknown[] = [root];
  for (const part of path.trim().split('.')) {
    const m = part.match(/^([^[\]]*)((?:\[\d*\])*)$/);
    if (!m) return [];
    if (m[1]) cur = cur.map((v) => (isObj(v) ? v[m[1]] : undefined));
    for (const b of m[2].match(/\[\d*\]/g) ?? []) {
      cur = b === '[]' ? cur.flatMap((v) => arr(v)) : cur.map((v) => arr(v)[Number(b.slice(1, -1))]);
    }
    cur = cur.filter((v) => v !== undefined && v !== null);
  }
  return cur;
}
