import uFuzzy from '@leeoniya/ufuzzy';

// The lists' search (the offers', the Applied tab's): every word of it in the title, the company or the
// note (an application's), in any order, a typo in a longer word forgiven ("devloper", "pyhton"), accents
// ignored ("lodz" finds Łódź); "quotes" for an exact phrase, -word to leave a word out. The best matches
// first (whole words, at the start, fewer typos), newest first among equal ones. A word with # + or . in
// it (C#, C++, .NET, Node.js) is looked for as it is: uFuzzy would split it at those. uFuzzy
// (https://github.com/leeoniya/uFuzzy) does the matching.

/** Where a search matched, as [start, end) pairs of character offsets, in the title, the company and the note. */
export type Marks = { title: number[]; company: number[]; note: number[] };

type Searchable = { jobId: string; title: string; company: string | null; note?: string | null };

/** The jobs it finds, best first (`ids`), and where it matched in each (`marks`, by job id). */
export type Ranked = { ids: string[]; marks: Map<string, Marks> };

// between the title, the company and the note in what's searched: a term doesn't run across it (it isn't
// a letter), the next term may follow it (`.` matches it)
const SEP = ' · ';
/** words past these aren't tried in every order: more would be up to 6! tries */
const IN_ANY_ORDER = 5;

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
  const haystack = uFuzzy.latinize(
    jobs.map((job) => job.title + SEP + (job.company ?? '') + (job.note ? SEP + job.note : '')),
  );
  const needle = uFuzzy.latinize(keepPunctuation(query));
  const [idxs, info] = uf.search(haystack, needle, IN_ANY_ORDER, Infinity);
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

/** the haystack's ranges as the title's, the company's and the note's */
function split(ranges: number[], job: Searchable): Marks {
  const marks: Marks = { title: [], company: [], note: [] };
  const company = job.title.length + SEP.length;
  const note = company + (job.company ?? '').length + SEP.length;
  for (let i = 0; i < ranges.length; i += 2) {
    const [start, end] = [ranges[i], ranges[i + 1]];
    if (end <= job.title.length) marks.title.push(start, end);
    else if (start >= company && end <= note - SEP.length) marks.company.push(start - company, end - company);
    else if (start >= note) marks.note.push(start - note, end - note);
  }
  return marks;
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
