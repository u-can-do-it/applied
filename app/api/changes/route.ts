import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE, isValidToken } from '@/server/auth';
import { dataVersion } from '@/lib/changes';

// GET /api/changes -> { v }: changes when a scrape or a Telegram command changed what the pages
// show (lib/changes.ts). AutoRefresh polls it, so it refreshes a page only when there's news.
export async function GET() {
  // proxy.ts guards this route too; check again, like /api/application
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  return NextResponse.json({ v: await dataVersion() }, { headers: { 'Cache-Control': 'no-store' } });
}
