// Shared by the server and client components: building blocks of the action schemas.
// zod/mini, not zod: the forms check what you type with these same schemas in the browser, and
// zod/mini's functions tree-shake (a form's schema costs ~16 kB gzipped; zod's chained API
// brings all of zod and its locales, ~90 kB). The server uses them as they are.
import * as z from 'zod/mini';

/** For an action that takes no input. */
export const noInput = z.void();

/** A string, '' when not sent. */
export const string = (fallback = '') => z._default(z.string(), fallback);

/** A string field as kept: trimmed and cut to `max` characters ('' when not sent). */
export const text = (max: number) =>
  z.pipe(
    string(),
    z.transform((value: string) => value.trim().slice(0, max)),
  );

/** A job's id (offers_unique.dup_key), also the id of its application. */
export const jobId = z.string().check(z.minLength(1));

/** In a transform: the input is wrong, at `path` (the field it's about; none = the whole form). */
export function problem(ctx: z.core.ParsePayload, message: string, path: PropertyKey[] = []): never {
  ctx.issues.push({ code: 'custom', message, input: ctx.value, path });
  return z.NEVER;
}
