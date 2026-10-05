import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { fitOf } from '@/lib/ai/profiles';
import { getApplication } from '@/lib/applications';
import { AUTH_COOKIE, isValidToken } from '@/server/auth';

// GET /api/application?jobId=<job id> -> the saved application with its complete ad text, and
// `fit`: the active AI profile's verdict on the job (null if it hasn't judged it).
// The list only loads titles; the text (can be long) comes when a row is opened. `?key=` is the
// same: pages loaded before the key -> jobId rename ask for it. That only keeps their ad text
// loading; their actions take the old field names and fail until the page is reloaded.
export async function GET(request: NextRequest) {
  // proxy.ts guards this route too; check again because it returns the saved ad text
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const jobId = params.get('jobId') ?? params.get('key');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  const [app, fit] = await Promise.all([getApplication(jobId), fitOf(jobId).catch(() => null)]);
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...app, fit }, { headers: { 'Cache-Control': 'no-store' } });
}
