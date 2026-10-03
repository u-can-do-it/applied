// Shared by the server and client components.
import { z } from 'zod';

const BASE = 'http://same.origin';
/** A path on this site, or '/': read the way a browser reads it ("/\\evil.com" and "/\t/evil.com" are other sites). */
const sameOriginPath = (next: string) => {
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  try {
    return new URL(next, BASE).origin === BASE ? next : '/';
  } catch {
    return '/';
  }
};

/** The login form. */
export const loginSchema = z.object({
  password: z.string().default(''),
  // where to go after logging in: only a path on this site (not "//evil.com")
  next: z.string().default('/').transform(sameOriginPath),
});
