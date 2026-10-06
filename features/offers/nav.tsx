'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, use, useOptimistic, useTransition } from 'react';

// Client-side navigation state shared by the chips, search box, pager and the result list.
//
// `actual` is the query string the rendered list belongs to. `query` is what the user just
// asked for: useOptimistic sets it on the very frame of the click, and it holds until the
// router.push() transition finishes. While the two differ the list shows its skeleton, so
// the UI reacts instantly even before the server has answered (or anything was prefetched).

type Nav = {
  /** the page the list is on - links built with withParams(..., path) stay on it */
  path: string;
  query: URLSearchParams;
  pending: boolean;
  navigate: (href: string, opts?: { replace?: boolean; scrollTop?: boolean }) => void;
};

const NavContext = createContext<Nav | null>(null);

export function useNav() {
  const nav = use(NavContext);
  if (!nav) throw new Error('useNav must be used inside <NavProvider>');
  return nav;
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const actual = useSearchParams().toString();
  const [optimistic, setOptimistic] = useOptimistic(actual);
  const [pending, startTransition] = useTransition();

  const navigate: Nav['navigate'] = (href, { replace = false, scrollTop = false } = {}) => {
    const next = new URL(href, window.location.href).searchParams.toString();
    if (next === optimistic) return;
    if (scrollTop) window.scrollTo({ top: 0 });
    startTransition(() => {
      setOptimistic(next);
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };

  const nav: Nav = {
    path,
    query: new URLSearchParams(optimistic),
    pending: pending || optimistic !== actual,
    navigate,
  };

  return <NavContext value={nav}>{children}</NavContext>;
}

// A <Link> that goes through navigate(): keeps prefetching, middle-click and no-JS fallback,
// but updates the UI on the click frame instead of when the server responds.
export function NavLink({
  href,
  scrollTop,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, 'href'> & { href: string; scrollTop?: boolean }) {
  const { navigate } = useNav();
  return (
    <Link
      href={href}
      {...rest}
      onNavigate={(event) => {
        // only plain clicks reach onNavigate (not Ctrl/Cmd+click, which opens a new tab)
        event.preventDefault();
        navigate(href, { scrollTop });
      }}
    />
  );
}
