import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, authEnabled, isValidToken } from './lib/auth';

// Every page and server action needs the login cookie, except the login page itself and the two
// endpoints machines call (they check their own secret: the cron one, and Telegram's).
export async function proxy(request: NextRequest) {
  if (!authEnabled()) {
    // fail closed in production: the AI filter stores a CV, it must not end up public
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('APP_PASSWORD is not set. Add it in Vercel -> Settings -> Environment Variables.', { status: 503 });
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
  // everything except the login page, the cron + Telegram endpoints, Next's own assets and the favicon
  matcher: ['/((?!login|api/cron/|api/telegram|_next/static|_next/image|favicon.ico).*)'],
};
