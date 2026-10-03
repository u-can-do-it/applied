'use client';

import { LoadError } from '@/components/load-error';
import { Button } from '@/components/ui/button';

// The last resort for a page that failed while rendering (most parts catch their own errors and
// say so in place, like the offer list; the header leaves out what it can't load). In production
// the message is generic: Next.js keeps the server's error, which may say too much, in its log,
// under this digest.
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="wrap">
      <LoadError
        title="Something went wrong loading this page."
        detail={error.digest && `Error ${error.digest} (in the server log)`}
      >
        <Button type="button" className="mt-2" onClick={retry}>
          Try again
        </Button>
      </LoadError>
    </main>
  );
}
