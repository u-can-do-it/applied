'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE, AUTH_MAX_AGE, authToken, isValidPassword } from '@/server/auth';
import { formAction } from '@/server/action';
import { env } from '@/lib/env';
import { loginSchema } from '@/lib/shared/schemas/auth';

export const login = formAction(
  loginSchema,
  async ({ password, next }) => {
    if (!(await isValidPassword(password))) {
      await new Promise((resolve) => setTimeout(resolve, 600)); // slow down guessing a little
      throw new Error('Wrong password.');
    }
    (await cookies()).set(AUTH_COOKIE, await authToken(), {
      httpOnly: true, // not readable from page scripts
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_MAX_AGE,
    });
    redirect(next);
  },
  { public: true },
);
