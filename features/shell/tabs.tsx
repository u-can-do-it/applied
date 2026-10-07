'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { path: '/', label: 'Offers' },
  { path: '/applied', label: 'Applied' },
  { path: '/activity', label: 'Activity' },
  { path: '/settings', label: 'Settings' },
];

// The app's pages, drawn like shadcn's line tabs but kept as a <nav> of links with aria-current: each one
// loads another page (a URL, middle-click, back), which is navigation, not the tablist pattern (tabs show
// panels of one page, and arrow keys move between them).
// On a phone (560px, as .wrap's) they're a bar fixed to the bottom of the screen, under the thumb: the
// tabs share its width and the line marks the page from above. The sheets and windows (z-50) cover it,
// and .wrap's bottom padding keeps the end of the page above it.
const NAV =
  'mb-3.5 -mt-1 flex gap-1 border-b ' +
  'max-[560px]:fixed max-[560px]:inset-x-0 max-[560px]:bottom-0 max-[560px]:z-40 max-[560px]:m-0 max-[560px]:gap-0 max-[560px]:border-t max-[560px]:border-b-0 max-[560px]:bg-background';
const TAB =
  '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground ' +
  'max-[560px]:-mt-px max-[560px]:mb-0 max-[560px]:flex-1 max-[560px]:border-t-2 max-[560px]:border-b-0 max-[560px]:py-3 max-[560px]:text-center';

// The Offers tab keeps the offers' search / board / dates, only the page number resets. Another page's
// query (the Applied tab's ?q=, ?status=) is that page's own: it doesn't go along.
export function Tabs() {
  const pathname = usePathname();
  const params = new URLSearchParams(useSearchParams());
  params.delete('page');
  const queryString = params.toString();
  return (
    <nav className={NAV} aria-label="View">
      {TABS.map((tab) => (
        <Link
          key={tab.path}
          href={queryString && tab.path === '/' && pathname === '/' ? `/?${queryString}` : tab.path}
          aria-current={pathname === tab.path ? 'page' : undefined}
          className={TAB}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabsFallback() {
  return (
    <nav className={NAV} aria-hidden="true">
      {TABS.map((tab) => (
        <span key={tab.path} className={TAB}>
          {tab.label}
        </span>
      ))}
    </nav>
  );
}
