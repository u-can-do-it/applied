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
const NAV = 'mb-3.5 -mt-1 flex gap-1 border-b';
const TAB =
  '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground';

// Switching tabs keeps search / board / dates, only the page number resets.
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
          href={queryString && tab.path === '/' ? `/?${queryString}` : tab.path}
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
