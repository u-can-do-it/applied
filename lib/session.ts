import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE, isValidToken } from './auth';

/** For server actions: proxy.ts already checks every request, but actions are public endpoints. */
export async function requireLogin() {
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) throw new Error('Not logged in');
}
