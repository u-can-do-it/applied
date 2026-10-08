// The big search box at the top of a list (offers, applied): a magnifier and a borderless input in one
// rounded box that lights up while you type. A form (offers: it works without JS) or a plain div.

/** the box, on a <form> or a <div> */
export const searchBox =
  'flex items-center gap-2.5 rounded-[10px] border bg-card px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-accent';

/** the input inside it; its clear (×) button, the browser's own, set off from the text and with a bigger target */
export const searchInput =
  'min-w-0 flex-1 border-0 bg-transparent py-3 text-base text-foreground outline-none disabled:cursor-progress [&::-webkit-search-cancel-button]:ml-2 [&::-webkit-search-cancel-button]:cursor-pointer [&::-webkit-search-cancel-button]:p-1';
