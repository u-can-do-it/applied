// Small readers for the untyped data a listing page gives (JSON, embedded scripts, text), used by the
// boards' own parsers and the generic ones. Shared by the server and the browser.
import { decodeEntities } from '../shared/html';

export type Obj = Record<string, unknown>;

export const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown) =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
export const nameOf = (value: unknown) =>
  isObj(value) ? str(value.name ?? value.title ?? value.label ?? value.value) : str(value);
export const num = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const time = (value: unknown) => {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(str(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const keysOf = (value: unknown) =>
  isObj(value) ? Object.keys(value).slice(0, 12).join(', ') : Array.isArray(value) ? 'a list' : typeof value;
// JSON.stringify(undefined) is undefined, whatever its type says
export const sampleOf = (value: unknown) => (JSON.stringify(value, null, 2) as string | undefined)?.slice(0, 3000);

export function json(text: string, what: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not JSON: ${text.trim().slice(0, 100)}`);
  }
}

/** HTML or a feed's text -> one line of plain text */
export const strip = (text: string) =>
  decodeEntities(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '))
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
export const angular = (text: string) =>
  text.replace(/&q;/g, '"').replace(/&a;/g, '&').replace(/&l;/g, '<').replace(/&g;/g, '>').replace(/&s;/g, "'");

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
    const match = part.match(/^([^[\]]*)((?:\[\d*\])*)$/);
    if (!match) return [];
    if (match[1]) cur = cur.map((value) => (isObj(value) ? value[match[1]] : undefined));
    for (const bracket of match[2].match(/\[\d*\]/g) ?? []) {
      cur =
        bracket === '[]'
          ? cur.flatMap((value) => arr(value))
          : cur.map((value) => arr(value)[Number(bracket.slice(1, -1))]);
    }
    cur = cur.filter((value) => value !== undefined && value !== null);
  }
  return cur;
}
