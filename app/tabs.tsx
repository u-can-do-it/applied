'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { path: '/', label: 'All offers' },
  { path: '/ai', label: 'AI filter' },
];

// Switching tabs keeps search / source / dates, only the page number resets.
export function Tabs() {
  const pathname = usePathname();
  const sp = new URLSearchParams(useSearchParams());
  sp.delete('page');
  const qs = sp.toString();
  return (
    <nav className="tabs" aria-label="View">
      {TABS.map((t) => (
        <Link key={t.path} href={qs ? `${t.path}?${qs}` : t.path} aria-current={pathname === t.path ? 'page' : undefined} className="tab">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabsFallback() {
  return (
    <nav className="tabs" aria-hidden="true">
      {TABS.map((t) => (
        <span key={t.path} className="tab">
          {t.label}
        </span>
      ))}
    </nav>
  );
}
