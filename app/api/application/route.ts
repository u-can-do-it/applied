import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getApplication } from '@/lib/applications';
import { AUTH_COOKIE, isValidToken } from '@/lib/auth';

// GET /api/application?key=<job key> -> the saved application with its complete ad text.
// The list only loads titles; the text (can be long) comes when a row is opened.
export async function GET(request: NextRequest) {
  // proxy.ts guards this route too; check again because it returns the saved ad text
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  const key = request.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  const app = await getApplication(key);
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(app, { headers: { 'Cache-Control': 'no-store' } });
}
