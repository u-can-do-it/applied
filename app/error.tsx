'use client';

// The last resort for a page that failed while rendering (most parts catch their own errors and
// say so in place, like the offer list; the header leaves out what it can't load). In production
// the message is generic: Next.js keeps the server's error, which may say too much, in its log,
// under this digest.
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="wrap">
      <div className="notice" role="alert">
        <strong>Something went wrong loading this page.</strong>
        {error.digest && <code>Error {error.digest} (in the server log)</code>}
        <p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </p>
      </div>
    </main>
  );
}
