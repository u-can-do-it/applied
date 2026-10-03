'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

// TanStack Query, for the few reads the browser repeats on its own (an application's ad text while
// it's being fetched, AutoRefresh's "anything new?"). Everything else is server components and
// server actions. Each query says when it asks again; nothing refetches on focus or reconnect by
// default, and a failed read isn't retried (it shows, and the next scheduled read tries again).
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // one client for the visit (state, so a re-render doesn't make another one)
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
