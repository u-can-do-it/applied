'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { path: '/', label: 'All offers' },
  { path: '/ai', label: 'AI filter' },
  { path: '/applied', label: 'Applied' },
  { path: '/settings', label: 'Settings' },
];

// Switching tabs keeps search / board / dates, only the page number resets.
export function Tabs() {
  const pathname = usePathname();
  const sp = new URLSearchParams(useSearchParams());
  sp.delete('page');
  const qs = sp.toString();
  return (
    <nav className="tabs" aria-label="View">
      {TABS.map((tab) => (
        <Link
          key={tab.path}
          href={qs && (tab.path === '/' || tab.path === '/ai') ? `${tab.path}?${qs}` : tab.path}
          aria-current={pathname === tab.path ? 'page' : undefined}
          className="tab"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabsFallback() {
  return (
    <nav className="tabs" aria-hidden="true">
      {TABS.map((tab) => (
        <span key={tab.path} className="tab">
          {tab.label}
        </span>
      ))}
    </nav>
  );
}
