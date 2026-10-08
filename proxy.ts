import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, authEnabled, isValidToken } from '@/server/auth';
import { env } from '@/lib/env';

// Every page and server action needs the login cookie, except the login page itself, the endpoints
// called without it (they check their own secret: the cron one, Telegram's, and the bookmarklet's,
// called from a board's page), and what the browser fetches without the cookie to install the app and
// show its notifications: the manifest, the icons and the service worker (public files, nothing private).
export async function proxy(request: NextRequest) {
  if (!authEnabled()) {
    // fail closed in production: the AI filter stores a CV, it must not end up public
    if (env.NODE_ENV === 'production') {
      return new NextResponse('APP_PASSWORD is not set. Add it in Vercel -> Settings -> Environment Variables.', {
        status: 503,
      });
    }
    return NextResponse.next(); // local dev without a password
  }

  if (await isValidToken(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();

  const login = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') login.searchParams.set('next', next);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except the login page, the cron, Telegram and bookmarklet endpoints, Next's own assets,
  // the favicon, the manifest, the icons and the service worker (test/proxy.test.ts)
  matcher: [
    '/((?!login|api/cron/|api/telegram|api/import$|_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|icons/|sw\\.js$).*)',
  ],
};
