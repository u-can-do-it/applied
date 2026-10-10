import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getOfferWindow } from '@/lib/offer-window';
import { AUTH_COOKIE, isValidToken } from '@/server/auth';

// GET /api/offer?jobId=<job id> -> what an offer's window shows besides what the list has: the
// complete ad with the board's details (fetched now the first time, then saved), your note and
// `fit`, the active AI profile's verdict (null if it hasn't judged it). Asked as you point at the
// window's button, so it's mostly in by the click.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // proxy.ts guards this route too; check again because it returns your note
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  const shown = await getOfferWindow(jobId);
  if (!shown) return NextResponse.json({ error: 'That offer is no longer in the database.' }, { status: 404 });
  return NextResponse.json(shown, { headers: { 'Cache-Control': 'no-store' } });
}
