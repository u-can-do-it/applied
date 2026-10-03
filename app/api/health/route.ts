import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE, isValidToken } from '@/server/auth';
import { checkDbHealth } from '@/lib/db/health';

// GET /api/health -> { db: 'ok' | 'behind' | 'unreachable', pending: [migration names] }: whether the
// database has run every migration this deployment was built with (npm run db:migrate applies them).
// 503 unless "ok", so a monitor can tell without reading the body.
export async function GET() {
  // proxy.ts guards this route too; check again, like /api/application
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  const health = await checkDbHealth();
  return NextResponse.json(health, {
    status: health.db === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
