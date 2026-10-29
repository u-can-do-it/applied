import uFuzzy from '@leeoniya/ufuzzy';

// The lists' search (the offers', the Applied tab's): every word of it in the title, the company or the
// note (an application's), or, searching everything (the offers' ?in=all), the rest too (the ad, what the
// board says besides: salary, contract, skills), in any order, a typo in a longer word forgiven ("devloper", "pyhton") when
// nothing is found as typed ("digis" finds Digis, not digital, if there's a Digis), accents ignored ("lodz" finds Łódź); "quotes" for an exact phrase, -word to leave a word out. The best matches
// first (whole words, at the start, fewer typos), newest first among equal ones. A word with # + or . in
// it (C#, C++, .NET, Node.js) is looked for as it is: uFuzzy would split it at those. uFuzzy
// (https://github.com/leeoniya/uFuzzy) does the matching.

/** Where a search matched, as [start, end) pairs of character offsets, in the title, the company, the note and the rest. */
export type Marks = { title: number[]; company: number[]; note: number[]; more: number[] };

/** `more`: the rest of what's searched, when it's everything (the ad, the board's details) */
type Searchable = { jobId: string; title: string; company: string | null; note?: string | null; more?: string | null };

/** A piece of the note or the rest (`of`) around where the search matched in it, with its marks. */
export type Snippet = { of: 'note' | 'more'; text: string; marks: number[] };

/** The jobs it finds, best first (`ids`), and where it matched in each (`marks`, by job id). */
export type Ranked = { ids: string[]; marks: Map<string, Marks> };

// between the title, the company and the note in what's searched: a term doesn't run across it (it isn't
// a letter), the next term may follow it (`.` matches it)
export const SEP = ' · ';
/** words past these aren't tried in every order: more would be up to 6! tries */
const IN_ANY_ORDER = 5;

// as typed: the letters of a word one after another, no typo
const exact = new uFuzzy({ intraIns: 0 });
const uf = new uFuzzy({
  // one typo per word: a wrong, missing, extra or swapped letter
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- IntraMode.SingleError: a const enum, there's no value to import
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraTrn: 1,
  intraDel: 1,
});

/** "c#" for c#, -"c#" for -c#: an exact phrase, which keeps its punctuation (quoted words stay as they are) */
const keepPunctuation = (query: string) =>
  (query.match(/-?"[^"]*"?|\S+/g) ?? [])
    .map((word) => (/^-?[^"]*[#+.][^"]*$/.test(word) ? word.replace(/^(-?)(.*)$/, '$1"$2"') : word))
    .join(' ');

/** the default order, except that equal matches keep their order (the newest first) */
const sort = (info: uFuzzy.Info) =>
  info.idx
    .map((_, i) => i)
    .sort(
      (a, b) =>
        info.chars[b] - info.chars[a] ||
        info.intraIns[a] - info.intraIns[b] ||
        info.terms[b] +
          info.interLft2[b] +
          0.5 * info.interLft1[b] -
          (info.terms[a] + info.interLft2[a] + 0.5 * info.interLft1[a]) ||
        info.interIns[a] - info.interIns[b] ||
        info.start[a] - info.start[b] ||
        info.idx[a] - info.idx[b],
    );

/**
 * The jobs `query` finds among these (newest first), best first. Null when the query has nothing to
 * look for (only punctuation): the list isn't filtered then.
 */
export function rank(jobs: readonly Searchable[], query: string): Ranked | null {
  // accents are replaced one letter for one, so the offsets are the original text's
  const haystack = uFuzzy.latinize(jobs.map((job) => fieldsOf(job).text));
  const needle = uFuzzy.latinize(keepPunctuation(query));
  let [idxs, info] = exact.search(haystack, needle, IN_ANY_ORDER, Infinity);
  // found nothing as typed: a typo, then
  if (idxs?.length === 0) [idxs, info] = uf.search(haystack, needle, IN_ANY_ORDER, Infinity);
  if (!idxs) return null;
  const marks = new Map<string, Marks>();
  // more words than are tried in every order, or only words left out: no ranking, the newest first
  // (none found: no ranking either)
  if (!info?.idx) return { ids: [...idxs].sort((a, b) => a - b).map((i) => jobs[i].jobId), marks };

  const ids = sort(info).map((i) => {
    const job = jobs[info.idx[i]];
    marks.set(job.jobId, split(info.ranges[i], job));
    return job.jobId;
  });
  return { ids, marks };
}

const FIELDS = ['title', 'company', 'note', 'more'] as const;

/**
 * What's searched in a job: the title, the company (maybe empty), the note and the rest (when there are),
 * SEP between them; and where each starts in it (-1: not in it).
 */
function fieldsOf(job: Searchable) {
  let text = '';
  const starts = { title: -1, company: -1, note: -1, more: -1 };
  for (const field of FIELDS) {
    const value = job[field] ?? '';
    if (!value && field !== 'title' && field !== 'company') continue;
    if (field !== 'title') text += SEP;
    starts[field] = text.length;
    text += value;
  }
  return { text, starts };
}

/** the haystack's ranges as the title's, the company's, the note's and the rest's; one across two of them in none */
function split(ranges: number[], job: Searchable): Marks {
  const marks: Marks = { title: [], company: [], note: [], more: [] };
  const { starts } = fieldsOf(job);
  for (let i = 0; i < ranges.length; i += 2) {
    const [start, end] = [ranges[i], ranges[i + 1]];
    const field = FIELDS.find(
      (name) => starts[name] >= 0 && start >= starts[name] && end <= starts[name] + (job[name] ?? '').length,
    );
    if (field) marks[field].push(start - starts[field], end - starts[field]);
  }
  return marks;
}

/** before the first mark, about this much of the text in a snippet (from a word's start) */
const LEAD = 20;
/** a snippet's length, at most (a row shows what fits, on one line) */
const SNIPPET = 240;

/**
 * Where the search matched in the note or, if not there, in the rest, for a list that doesn't show them:
 * the text from a little before the first mark, on one line, "…" where it's cut. Undefined when it
 * matched only in the title and the company.
 */
export function snippetOf(job: Searchable, marks: Marks | undefined): Snippet | undefined {
  if (!marks) return undefined;
  const of = marks.note.length ? 'note' : marks.more.length ? 'more' : undefined;
  const text = of && job[of];
  if (!of || !text) return undefined;
  const first = marks[of][0];
  let start = Math.max(0, first - LEAD);
  // from a word's start: past the space after a cut word, if that's before the mark
  if (start > 0 && /\S/.test(text[start - 1])) {
    const space = text.slice(start, first).search(/\s/);
    if (space >= 0) start += space + 1;
  }
  while (start < first && /\s/.test(text[start])) start++;
  const end = Math.min(text.length, start + SNIPPET);
  const lead = start > 0 ? '…' : '';
  return {
    of,
    // white space as spaces, one for one, so the marks stay where they are
    text: lead + text.slice(start, end).replace(/\s/g, ' ') + (end < text.length ? '…' : ''),
    marks: marksWithin(marks[of], start, end).map((at) => at + lead.length),
  };
}

/** The marks inside text[start, end), from there: for a part of the text shown on its own (a note's first line). */
export function marksWithin(marks: number[] | undefined, start: number, end: number): number[] {
  const inside: number[] = [];
  for (let i = 0; marks && i < marks.length; i += 2) {
    const [from, to] = [Math.max(marks[i], start), Math.min(marks[i + 1], end)];
    if (from < to) inside.push(from - start, to - start);
  }
  return inside;
}
