import { Fragment } from 'react';

/** Text with the parts a search matched (`marks`: [start, end) pairs, in order) marked in yellow. */
export function Marked({ text, marks }: { text: string; marks?: number[] }) {
  if (!marks?.length) return text;
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
