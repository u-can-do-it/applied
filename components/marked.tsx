import { Fragment } from 'react';

/** The marks, two with only white space between them as one: "Pretius Software" marked whole, its space too. */
function joined(text: string, marks: number[]) {
  const out: number[] = [];
  for (let i = 0; i < marks.length; i += 2) {
    const [start, end] = [marks[i], marks[i + 1]];
    if (out.length && !text.slice(out[out.length - 1], start).trim()) out[out.length - 1] = end;
    else out.push(start, end);
  }
  return out;
}

/** Text with the parts a search matched (`marks`: [start, end) pairs, in order) marked in yellow. */
export function Marked({ text, marks: found }: { text: string; marks?: number[] }) {
  if (!found?.length) return text;
  const marks = joined(text, found);
  const parts = [];
  let at = 0;
  for (let i = 0; i < marks.length; i += 2) {
    const [start, end] = [marks[i], marks[i + 1]];
    parts.push(
      <Fragment key={i}>
        {text.slice(at, start)}
        <mark className="rounded-[3px] bg-highlight px-px text-highlight-foreground">{text.slice(start, end)}</mark>
      </Fragment>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return parts;
}
