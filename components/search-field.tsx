import { TextSearchIcon } from 'lucide-react';

// The big search box at the top of a list (offers, applied): a magnifier and a borderless input in one
// rounded box that lights up while you type. A form (offers: it works without JS) or a plain div. At its
// end, "Everything" (?in=all): the search reads the note and the ad too (lib/shared/search.ts).

/** the box, on a <form> or a <div> */
export const searchBox =
  'flex items-center gap-2.5 rounded-[10px] border bg-card px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-accent';

/** the input inside it; its clear (×) button, the browser's own, set off from the text and with a bigger target */
export const searchInput =
  'min-w-0 flex-1 border-0 bg-transparent py-3 text-base text-foreground outline-none disabled:cursor-progress [&::-webkit-search-cancel-button]:ml-2 [&::-webkit-search-cancel-button]:cursor-pointer [&::-webkit-search-cancel-button]:p-1';

/** "Everything": a checkbox drawn as a chip, at the box's end; lit while it's on */
export const everythingChip =
  'flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] text-muted-foreground select-none hover:text-foreground has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-3 has-focus-visible:ring-ring/50';

/** what the box says, searching the title and company (and an application's note) or everything */
export const searchPlaceholder = (everything: boolean, note = false) =>
  everything
    ? 'Search everything: ad, note, salary, skills…'
    : note
      ? 'Search title, company or note…'
      : 'Search title or company…';

const EVERYTHING_TITLE = 'Search your note and the ad too: its text, salary, contract, work mode, location and skills';

/** The "Everything" chip; `name`: a form's field (in=all), so a submit without JS sends it. */
export function EverythingToggle({
  checked,
  onChange,
  name,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
}) {
  return (
    <label className={everythingChip} title={EVERYTHING_TITLE}>
      <input
        type="checkbox"
        name={name}
        value="all"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <TextSearchIcon aria-hidden className="size-3.5" /> Everything
    </label>
  );
}
