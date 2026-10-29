import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { listAdTexts } from '@/lib/applications';
import { AUTH_COOKIE, isValidToken } from '@/server/auth';

// GET /api/ad-texts -> { texts: [{ jobId, content }] }: every application's saved ad text. The Applied
// list loads none (they're long); its search of everything (?in=all) asks for them all, once.
export async function GET() {
  // proxy.ts guards this route too; check again because it returns the saved ad texts
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  return NextResponse.json({ texts: await listAdTexts() }, { headers: { 'Cache-Control': 'no-store' } });
}
